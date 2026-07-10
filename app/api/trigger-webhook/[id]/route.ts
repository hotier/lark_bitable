/**
 * POST /api/trigger-webhook/[id] — Webhook 接收端 (v3)
 *
 * 外部系统 POST 到此地址触发自动化流程：
 *   1. 根据 webhookUrl 查找对应的工作流
 *   2. 校验 secretToken（可选：配置了才校验，留空则不校验）
 *   3. 解析请求体中的 content 字段（兼容 JSON / 表单 / multipart）
 *   4. 使用 DAG 执行引擎按拓扑序执行所有节点
 *
 * 安全增强（相对 v2）：
 *   - secretToken 校验改用恒定时间比较（timingSafeEqual），防时序攻击
 *   - 入参经 zod 校验 + 原型链污染防护（parseWebhookBody）
 *   - 日志统一走 logger，生产环境不输出 webhook 请求体等敏感信息
 */

import { NextResponse } from 'next/server';
import { findWorkflowByWebhookUrl } from '@/lib/workflow-store';
import { bitableService } from '@/services/feishu-bitable';
import { executeWorkflow } from '@/lib/workflow-engine/executor';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from '@/lib/crypto';
import {
  flattenKeys,
  getNestedValue,
  safeStringify,
  parseMultipartManual,
  type ManualPart,
} from '@/lib/webhook-utils';
import {
  parseSecretToken,
  parseWebhookBody,
  webhookTriggerConfigSchema,
} from '@/lib/validation';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  logger.debug(`[webhook] 收到请求 id=${id}`);

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
    logger.debug(`[webhook] 匹配工作流: "${workflow.name}" (${workflow.id})`);

    // 校验触发器配置（取代 any，给出类型与边界）
    const cfg = webhookTriggerConfigSchema.safeParse(triggerNode.triggerConfig ?? {});
    if (!cfg.success) {
      return NextResponse.json(
        { code: 1, msg: 'trigger config invalid' },
        { status: 400 },
      );
    }
    const bodyTemplate = cfg.data.webhookBodyTemplate;

    // 2. 校验 Token（可选：仅当配置了 secretToken 才校验）
    const secretToken = parseSecretToken(cfg.data.secretToken);
    if (secretToken) {
      const token = request.headers.get('X-Webhook-Token') ?? '';
      if (!timingSafeEqual(token, secretToken)) {
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
    try {
      if (contentType.includes('multipart/form-data')) {
        // 读取原始字节（request.body 只能消费一次，后面需重建请求或手动解析）
        const rawBuf = Buffer.from(await request.arrayBuffer());
        // 用原始字节重建请求再解析（原 request 的 body 已被消费）
        const rebuilt = new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body: rawBuf,
        });
        // 表单 / 文件上传（如 iOS 快捷指令传图片）：文件转 base64 data URL 注入 content
        let formEntries: [string, unknown][] = [];
        try {
          const form = await rebuilt.formData();
          for (const [k, v] of form.entries()) formEntries.push([k, v]);
        } catch (e) {
          logger.warn('[webhook] request.formData() 抛错，将改用手动解析:', e);
        }
        // 兜底：标准解析为空但 body 有内容时，手动按 boundary 拆分（兼容 iOS 非标准 multipart）
        if (formEntries.length === 0 && rawBuf.length > 0) {
          logger.debug('[webhook] formData() 解析为空，改用手动 multipart 解析');
          formEntries = parseMultipartManual(rawBuf, contentType) as [string, unknown][];
        }
        const textFields: Record<string, unknown> = {};
        const fileFields: Record<string, unknown> = {};
        const unnamedFiles: string[] = []; // iOS 可能以空字段名发送文件，作为兜底
        for (const [k, v] of formEntries) {
          if (typeof v === 'string') {
            if (k) textFields[k] = v;
            logger.debug(`[webhook] 收到文本字段「${k || '(空)'}」: ${v.slice(0, 40)}`);
          } else if (v && typeof v === 'object' && '__file' in v) {
            const part = v as Extract<ManualPart, object>;
            const dataUrl = `data:${part.mime};base64,${part.data.toString('base64')}`;
            logger.debug(
              `[webhook] 收到文件字段「${k || '(空)'}」: mime=${part.mime}, ${(part.data.length / 1024).toFixed(1)}KB`,
            );
            if (k) fileFields[k] = dataUrl;
            else unnamedFiles.push(dataUrl);
          } else if (v && typeof v === 'object' && 'arrayBuffer' in v) {
            // 来自标准 formData() 的 File 对象
            const f = v as { arrayBuffer: () => Promise<ArrayBuffer>; type?: string };
            const buf = Buffer.from(await f.arrayBuffer());
            const mime = f.type || 'application/octet-stream';
            const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
            logger.debug(
              `[webhook] 收到文件字段「${k || '(空)'}」: mime=${mime}, ${(buf.length / 1024).toFixed(1)}KB`,
            );
            if (k) fileFields[k] = dataUrl;
            else unnamedFiles.push(dataUrl);
          }
        }
        // 兜底：没有任何命名字段时，把未命名文件当作 image（兼容 iOS 空字段名的情况）
        if (Object.keys(fileFields).length === 0 && unnamedFiles.length > 0) {
          fileFields['image'] = unnamedFiles[0];
          logger.debug(
            `[webhook] 未发现命名字段，将 ${unnamedFiles.length} 个未命名文件兜底映射为 image`,
          );
        }
        // 合并后整体做一次原型污染防护（表单字段名亦可能含 __proto__ 等）
        webhookContent = parseWebhookBody({ ...textFields, ...fileFields });
        rawBody = webhookContent;
        logger.debug(
          `[webhook] 解析 multipart 表单：文本字段 ${Object.keys(textFields).join(',') || '无'}，文件字段 ${Object.keys(fileFields).join(',') || '无'}`,
        );
      } else {
        const parsed = await request.json();
        rawBody = parseWebhookBody(parsed);
        const isObj = !!rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody);
        // 有 content 字段则取 content，否则把整包 body 当作内容（兼容两种传参方式）
        webhookContent = isObj && 'content' in rawBody
          ? (parseWebhookBody((rawBody.content as Record<string, unknown>) || {}) ?? {})
          : isObj
            ? rawBody
            : {};
      }
    } catch {
      // 请求体为空或非预期格式，使用空 content
    }

    // 4b. 如果 trigger 配置了 webhookBodyTemplate，用它重新解析 JSON
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
          webhookContent = parseWebhookBody(reParsed);
          logger.debug(`[webhook] 根据模板重解析 content，keys: ${templateKeys.join(', ')}`);
        }
      } catch (err) {
        logger.warn('[webhook] 模板解析失败，使用原始 content:', err);
      }
    }
    logger.debug(`[webhook] content:`, safeStringify(webhookContent));

    // 5. 使用 DAG 执行引擎按拓扑序执行节点
    const result = await executeWorkflow(workflow, webhookContent, secretToken, webhookPath);
    logger.debug(`[webhook] 执行结果:`, result.data?.results);
    return NextResponse.json(result);
  } catch (error) {
    logger.error('[webhook] 内部错误:', error);
    return NextResponse.json(
      { code: 99, msg: error instanceof Error ? error.message : 'internal error' },
      { status: 500 },
    );
  }
}
