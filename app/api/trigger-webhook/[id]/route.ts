/**
 * POST /api/trigger-webhook/[id] — Webhook 接收端 (v2)
 *
 * 外部系统 POST 到此地址触发自动化流程：
 *   1. 根据 webhookUrl 查找对应的工作流
 *   2. 校验 secretToken（如果配置了）
 *   3. 解析请求体中的 content 字段
 *   4. 使用 DAG 执行引擎按拓扑序执行所有节点
 */

import { NextResponse } from 'next/server';
import { findWorkflowByWebhookUrl } from '@/lib/workflow-store';
import { bitableService } from '@/services/feishu-bitable';
import { executeWorkflow } from '@/lib/workflow-engine/executor';

/** 递归扁平化对象 key：{a:{b:1}, c:2} → ["a.b","c"] */
function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const record = obj as Record<string, unknown>;
  const keys: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/** 按点号路径从嵌套对象取值 */
function getNestedValue(obj: Record<string, unknown>, dottedKey: string): unknown {
  const parts = dottedKey.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 序列化时裁剪超长字符串（避免 base64 图片撑爆日志） */
function safeStringify(obj: unknown, max = 120): string {
  try {
    return JSON.stringify(obj, (_k, v) =>
      typeof v === 'string' && v.length > max ? `${v.slice(0, max)}…(${v.length}字节)` : v,
    );
  } catch {
    return String(obj);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  console.log(`[webhook] 收到请求 id=${id}`);

  try {
    // 1. 查找工作流
    const webhookPath = `/api/trigger-webhook/${id}`;
    const found = await findWorkflowByWebhookUrl(webhookPath);
    if (!found) {
      return NextResponse.json(
        { code: 1, msg: 'webhook not found' },
        { status: 404 },
      );
    }

    const { workflow, triggerNode } = found;
    console.log(`[webhook] 匹配工作流: "${workflow.name}" (${workflow.id})`);

    // 2. 校验 Token
    const secretToken = triggerNode.triggerConfig?.secretToken;
    if (secretToken) {
      const token = request.headers.get('X-Webhook-Token');
      if (token !== secretToken) {
        return NextResponse.json(
          { code: 2, msg: 'invalid token' },
          { status: 403 },
        );
      }
    }

    // 3. 确保用户 Token 可用（自动尝试刷新）
    const authOk = await bitableService.ensureAuth();
    if (!authOk) {
      return NextResponse.json(
        { code: 3, msg: '用户未授权，请先在界面完成飞书登录' },
        { status: 401 },
      );
    }

    // 4. 解析请求体（兼容 JSON / 表单 / multipart）
    let rawBody: Record<string, unknown> = {};
    let webhookContent: Record<string, unknown> = {};
    const contentType = request.headers.get('content-type') || '';
    // 诊断变量（仅 multipart 时填充，回传到 _debug 便于跨环境排查）
    let diagSize: number | undefined;
    let diagCt: string | undefined;
    let diagCl: string | undefined;
    let diagTe: string | undefined;
    let diagRawHead: string | undefined;
    try {
      if (contentType.includes('multipart/form-data')) {
        // === 诊断：抓取 iOS 原始请求体，看清它到底发了什么 ===
        const rawBuf = Buffer.from(await request.arrayBuffer());
        diagSize = rawBuf.length;
        diagCt = request.headers.get('content-type') || '';
        diagCl = request.headers.get('content-length') || '(无)';
        diagTe = request.headers.get('transfer-encoding') || '(无)';
        diagRawHead = rawBuf.slice(0, 800).toString('latin1');
        console.log(`[diag] multipart 原始大小=${rawBuf.length} 字节, content-type=${diagCt}, content-length=${diagCl}, transfer-encoding=${diagTe}`);
        console.log(`[diag] 原始头 800 字节=\n${diagRawHead}`);
        try { require('fs').writeFileSync('last_ios_body.bin', rawBuf); console.log('[diag] 已写出 last_ios_body.bin'); } catch {}
        // 用原始字节重建请求再解析（原 request 的 body 已被消费）
        const rebuilt = new Request(request.url, { method: 'POST', headers: request.headers, body: rawBuf });
        // 表单 / 文件上传（如 iOS 快捷指令传图片）：文件转 base64 data URL 注入 content
        const form = await rebuilt.formData();
        const textFields: Record<string, unknown> = {};
        const fileFields: Record<string, unknown> = {};
        const unnamedFiles: string[] = []; // iOS 可能以空字段名发送文件，作为兜底
        for (const [k, v] of form.entries()) {
          if (typeof v === 'string') {
            if (k) textFields[k] = v;
            console.log(`[webhook] 收到文本字段「${k || '(空)'}」: ${(v as string).slice(0, 40)}`);
          } else {
            const buf = Buffer.from(await v.arrayBuffer());
            const mime = v.type || 'application/octet-stream';
            const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
            console.log(`[webhook] 收到文件字段「${k || '(空)'}」: mime=${mime}, ${(buf.length / 1024).toFixed(1)}KB`);
            if (k) fileFields[k] = dataUrl;
            else unnamedFiles.push(dataUrl);
          }
        }
        // 兜底：没有任何命名字段时，把未命名文件当作 image（兼容 iOS 空字段名的情况）
        if (Object.keys(fileFields).length === 0 && unnamedFiles.length > 0) {
          fileFields['image'] = unnamedFiles[0];
          console.log(`[webhook] 未发现命名字段，将 ${unnamedFiles.length} 个未命名文件兜底映射为 image`);
        }
        webhookContent = { ...textFields, ...fileFields };
        rawBody = webhookContent;
        console.log(`[webhook] 解析 multipart 表单：文本字段 ${Object.keys(textFields).join(',') || '无'}，文件字段 ${Object.keys(fileFields).join(',') || '无'}`);
      } else {
        rawBody = await request.json();
        const isObj = !!rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody);
        // 有 content 字段则取 content，否则把整包 body 当作内容（兼容两种传参方式）
        webhookContent = isObj && 'content' in rawBody
          ? ((rawBody.content as Record<string, unknown>) || {})
          : isObj
            ? rawBody
            : {};
      }
    } catch {
      // 请求体为空或非预期格式，使用空 content
    }

    // 4b. 如果 trigger 配置了 webhookBodyTemplate，用它重新解析 JSON
    const bodyTemplate = triggerNode.triggerConfig?.webhookBodyTemplate;
    if (bodyTemplate) {
      try {
        const templateObj = JSON.parse(bodyTemplate);
        const templateContent =
          (templateObj.content as Record<string, unknown>) ?? templateObj;
        const templateKeys = flattenKeys(templateContent);

        if (templateKeys.length > 0) {
          // 从原始 body 中提取匹配的 key 值（在 rawBody 和 rawBody.content 中查找）
          const reParsed: Record<string, unknown> = {};
          for (const key of templateKeys) {
            // 优先从 rawBody 顶层取值，其次从 rawBody.content 取值
            reParsed[key] =
              getNestedValue(rawBody, key) !== undefined
                ? getNestedValue(rawBody, key)
                : getNestedValue(webhookContent, key) !== undefined
                  ? getNestedValue(webhookContent, key)
                  : getNestedValue(templateContent, key); // 最后回退到模板默认值
          }
          webhookContent = reParsed;
          console.log(`[webhook] 根据模板重解析 content，keys: ${templateKeys.join(', ')}`);
        }
      } catch (err) {
        console.warn('[webhook] 模板解析失败，使用原始 content:', err);
      }
    }
    console.log(`[webhook] content:`, safeStringify(webhookContent));

    // 5. 使用 DAG 执行引擎按拓扑序执行节点
    const result = await executeWorkflow(workflow, webhookContent, secretToken);
    console.log(`[webhook] 执行结果:`, result.data?.results);
    const receivedKeys = Object.keys(webhookContent);
    return NextResponse.json({
      ...result,
      _debug: {
        contentType,
        receivedKeys,
        imageValueType: typeof webhookContent['image'],
        testValueType: typeof webhookContent['test'],
        diagSize,
        diagHeaders: { 'content-type': diagCt, 'content-length': diagCl, 'transfer-encoding': diagTe },
        diagRawHead,
        hint:
          receivedKeys.length === 0
            ? (contentType.includes('multipart')
                ? '已收到 multipart 表单但无字段。请检查 iOS「获取 URL 内容」的表单：每个字段的「字段名称」需填写(如 image/test)，且字段「值」必须真正连接照片变量/文本——iOS 会跳过值为空的字段不发送。'
                : '未收到任何字段。请确认 iOS「获取 URL 内容」的请求体设为「表单」(Form) 而非 JSON，并添加字段名称=image 的文件字段。JSON 模式无法直接发送二进制图片。')
            : undefined,
      },
    });
  } catch (error: any) {
    console.error('[webhook] 内部错误:', error);
    return NextResponse.json(
      { code: 99, msg: error.message || 'internal error' },
      { status: 500 },
    );
  }
}
