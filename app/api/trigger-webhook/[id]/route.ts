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

    // 4. 解析请求体
    let rawBody: Record<string, unknown> = {};
    let webhookContent: Record<string, unknown> = {};
    try {
      rawBody = await request.json();
      const isObj = !!rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody);
      // 有 content 字段则取 content，否则把整包 body 当作内容（兼容两种传参方式）
      webhookContent = isObj && 'content' in rawBody
        ? ((rawBody.content as Record<string, unknown>) || {})
        : isObj
          ? rawBody
          : {};
    } catch {
      // 请求体为空或非 JSON，使用空 content
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
    console.log(`[webhook] content:`, JSON.stringify(webhookContent));

    // 5. 使用 DAG 执行引擎按拓扑序执行节点
    const result = await executeWorkflow(workflow, webhookContent, secretToken);
    console.log(`[webhook] 执行结果:`, result.data?.results);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[webhook] 内部错误:', error);
    return NextResponse.json(
      { code: 99, msg: error.message || 'internal error' },
      { status: 500 },
    );
  }
}
