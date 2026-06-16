/**
 * POST /api/trigger-webhook/[id] — Webhook 接收端
 *
 * 外部系统 POST 到此地址触发自动化流程：
 *   1. 根据 webhookUrl 查找对应的工作流
 *   2. 校验 secretToken（如果配置了）
 *   3. 解析请求体中的 content 字段
 *   4. 依次执行所有节点（支持 action / filter / delay / http_request / im_message）
 */

import { NextResponse } from 'next/server';
import { findWorkflowByWebhookUrl } from '@/lib/workflow-store';
import { appendExecution } from '@/lib/execution-store';
import { bitableService } from '@/services/feishu-bitable';
import type { WorkflowNode, Execution, ExecutionStep } from '@/types';

/** 解析上一节点变量引用（prev:{nodeId}:{path...}） */
function resolveVariable(
  variableKey: string,
  prevOutputs: Record<string, unknown>,
): unknown {
  // 格式: prev:{nodeId}:{segment}:{segment}...
  const parts = variableKey.split(':');
  if (parts[0] !== 'prev' || parts.length < 3) return undefined;
  const nodeId = parts[1];
  const root = prevOutputs[nodeId];
  if (root === undefined) return undefined;

  // 如果是 prev:{nodeId}:record，返回整个对象
  if (parts.length === 3 && parts[2] === 'record') return root;

  // 否则按路径逐级访问
  let current: any = root;
  for (let i = 2; i < parts.length; i++) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[parts[i]];
  }
  return current;
}

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

/** 按点号路径从嵌套对象取值：getNestedValue({a:{b:1}},"a.b") → 1 */
function getNestedValue(obj: Record<string, unknown>, dottedKey: string): unknown {
  const parts = dottedKey.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 将字段映射解析为飞书 API 用的 fields */
function resolveFieldValues(
  node: WorkflowNode,
  webhookContent: Record<string, unknown>,
  prevOutputs: Record<string, unknown>,
): Record<string, unknown> | null {
  const mappings = node.actionConfig?.fieldMappings;
  if (!mappings || mappings.length === 0) return null;

  const fields: Record<string, unknown> = {};
  for (const m of mappings) {
    if (m.source === 'manual') {
      fields[m.fieldName] = m.manualValue;
    } else if (m.source === 'webhook') {
      const key = m.webhookKey.startsWith('content.') ? m.webhookKey.slice('content.'.length) : m.webhookKey;
      fields[m.fieldName] = webhookContent[key] ?? '';
    } else if (m.source === 'variable') {
      const val = resolveVariable(m.variableKey, prevOutputs);
      fields[m.fieldName] = val !== undefined ? val : '';
    }
  }
  return fields;
}

/** 从 webhookContent 或手动输入中解析字符串值 */
function resolveStringValue(source: 'manual' | 'webhook', manualValue: string, webhookKey: string, webhookContent: Record<string, unknown>): string {
  if (source === 'webhook') {
    const key = webhookKey.startsWith('content.') ? webhookKey.slice('content.'.length) : webhookKey;
    return String(webhookContent[key] ?? '');
  }
  return manualValue;
}

/** 执行单个节点 */
async function executeNode(
  node: WorkflowNode,
  webhookContent: Record<string, unknown>,
  prevOutputs: Record<string, unknown>,
): Promise<ExecutionStep> {
  const stepStart = Date.now();
  const mkStep = (success: boolean, message: string, output?: Record<string, unknown>): ExecutionStep => ({
    title: node.title,
    action: node.type,
    success,
    message,
    durationMs: Date.now() - stepStart,
    output,
  });

  try {
    // ---- action: CRUD 操作 ----
    if (node.type === 'action') {
      const cfg = node.actionConfig;
      if (!cfg || !cfg.targetAppToken || !cfg.targetTableId) {
        return mkStep(false, '未配置目标数据表');
      }

      switch (cfg.action) {
        case 'create_record': {
          const fields = resolveFieldValues(node, webhookContent, prevOutputs);
          if (!fields || Object.keys(fields).length === 0) return mkStep(false, '无字段映射');
          const rec = await bitableService.createRecord(cfg.targetAppToken, cfg.targetTableId, fields);
          return mkStep(true, `记录已创建 (${rec.record_id})`, {
            record_id: rec.record_id,
            fields: rec.fields as Record<string, unknown>,
            created_time: rec.created_time,
          });
        }

        case 'read_records': {
          const data = await bitableService.listRecords(cfg.targetAppToken, cfg.targetTableId, 100, '');
          const recordList = (data.records ?? []);
          const first = recordList[0] as { record_id?: string; fields?: Record<string, unknown> } | undefined;
          return mkStep(true, `查询完成 — ${data.total ?? '?'} 条`, {
            records: recordList as unknown as Record<string, unknown>,
            total_count: data.total ?? 0,
            first_record_id: first?.record_id ?? '',
            first_record: first as unknown as Record<string, unknown>,
          });
        }

        case 'update_record': {
          const fields = resolveFieldValues(node, webhookContent, prevOutputs);
          if (!fields || Object.keys(fields).length === 0) return mkStep(false, '无字段映射');
          let recordId: string | null = null;
          if (cfg.filters.length > 0) {
            recordId = await bitableService.findRecordByFilters(
              cfg.targetAppToken, cfg.targetTableId,
              cfg.filters as Array<{ fieldName: string; operator: string; value: string }>,
            );
          } else {
            const listData = await bitableService.listRecords(cfg.targetAppToken, cfg.targetTableId, 1, '');
            const records = listData?.records ?? [];
            recordId = records.length > 0 ? records[0].record_id : null;
          }
          if (!recordId) return mkStep(false, '无匹配记录');
          const rec = await bitableService.updateRecord(cfg.targetAppToken, cfg.targetTableId, recordId, fields);
          return mkStep(true, '记录已更新', {
            record_id: recordId,
            fields: rec.fields as Record<string, unknown>,
            updated_time: rec.updated_time,
          });
        }

        case 'delete_record': {
          let recordId: string | null = null;
          if (cfg.filters.length > 0) {
            recordId = await bitableService.findRecordByFilters(
              cfg.targetAppToken, cfg.targetTableId,
              cfg.filters as Array<{ fieldName: string; operator: string; value: string }>,
            );
          } else {
            const listData = await bitableService.listRecords(cfg.targetAppToken, cfg.targetTableId, 1, '');
            const records = listData?.records ?? [];
            recordId = records.length > 0 ? records[0].record_id : null;
          }
          if (!recordId) return mkStep(false, '无匹配记录');
          await bitableService.deleteRecord(cfg.targetAppToken, cfg.targetTableId, recordId);
          return mkStep(true, '记录已删除', { record_id: recordId });
        }

        default:
          return mkStep(false, `不支持的动作类型: ${cfg.action}`);
      }
    }

    // ---- filter: 条件筛选 ----
    if (node.type === 'filter') {
      const cfg = node.filterConfig;
      if (!cfg || cfg.conditions.length === 0) return mkStep(false, '未配置筛选条件');

      const content = webhookContent;
      const results = cfg.conditions.map((c) => {
        const fieldValue = String(content[c.fieldName] ?? '');
        switch (c.operator) {
          case 'eq':       return fieldValue === c.value;
          case 'ne':       return fieldValue !== c.value;
          case 'contains': return fieldValue.includes(c.value);
          case 'gt':       return Number(fieldValue) > Number(c.value);
          case 'lt':       return Number(fieldValue) < Number(c.value);
          case 'gte':      return Number(fieldValue) >= Number(c.value);
          case 'lte':      return Number(fieldValue) <= Number(c.value);
          default:         return false;
        }
      });

      const passed = cfg.matchMode === 'all'
        ? results.every(Boolean)
        : results.some(Boolean);

      return mkStep(passed, passed ? '条件通过' : '条件不通过 — 流程终止');
    }

    // ---- delay: 延时执行 ----
    if (node.type === 'delay') {
      const cfg = node.delayConfig;
      if (!cfg) return mkStep(false, '未配置延时');

      const msMap: Record<string, number> = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
      const ms = cfg.duration * (msMap[cfg.unit] || 1000);

      // 限制最大延迟 5 分钟（Next.js serverless 超时限制）
      const maxDelay = 300_000;
      const actualMs = Math.min(ms, maxDelay);

      await new Promise((resolve) => setTimeout(resolve, actualMs));
      const msg = ms > maxDelay ? `延时 ${cfg.duration} ${cfg.unit}（实际最大 ${maxDelay / 1000}s）` : `延时 ${cfg.duration} ${cfg.unit}`;
      return mkStep(true, msg);
    }

    // ---- http_request: HTTP 请求 ----
    if (node.type === 'http_request') {
      const cfg = node.httpRequestConfig;
      if (!cfg || !cfg.url) return mkStep(false, '未配置请求 URL');

      const headers: Record<string, string> = {};
      for (const h of cfg.headers) {
        if (h.key) headers[h.key] = h.value;
      }

      let body: string | undefined;
      if (['POST', 'PUT', 'PATCH'].includes(cfg.method)) {
        body = cfg.bodySource === 'manual' ? cfg.body : JSON.stringify(webhookContent);
      }

      const fetchOptions: RequestInit = {
        method: cfg.method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body ? { body } : {}),
      };

      const res = await fetch(cfg.url, fetchOptions);
      let responseData: unknown;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        responseData = await res.json();
      } else {
        responseData = await res.text();
      }

      const success = res.ok;
      return mkStep(success, `${res.status} ${res.statusText}`, success ? { status: res.status, response: responseData as Record<string, unknown> } : undefined);
    }

    // ---- im_message: 发送飞书消息 ----
    if (node.type === 'im_message') {
      const cfg = node.imConfig;
      if (!cfg) return mkStep(false, '未配置 IM 消息');

      const receiveId = resolveStringValue(
        cfg.receiveIdSource, cfg.receiveId, cfg.receiveIdWebhookKey, webhookContent,
      );
      if (!receiveId) return mkStep(false, '未指定接收人');

      if (cfg.msgType === 'text') {
        const text = resolveStringValue(cfg.textSource, cfg.textContent, '', webhookContent);
        if (!text) return mkStep(false, '消息内容为空');
        const result = await bitableService.sendImTextMessage(cfg.receiveIdType as 'email' | 'open_id' | 'user_id' | 'union_id' | 'chat_id', receiveId, text);
        return mkStep(true, `文本消息已发送 (${result.messageId})`, result as unknown as Record<string, unknown>);
      }

      if (cfg.msgType === 'card') {
        const card = resolveStringValue(cfg.cardSource, cfg.cardJson, '', webhookContent);
        if (!card) return mkStep(false, '卡片内容为空');
        const result = await bitableService.sendImCardMessage(cfg.receiveIdType as 'email' | 'open_id' | 'user_id' | 'union_id' | 'chat_id', receiveId, card);
        return mkStep(true, `卡片消息已发送 (${result.messageId})`, result as unknown as Record<string, unknown>);
      }

      return mkStep(false, `不支持的消息类型: ${cfg.msgType}`);
    }

    return mkStep(false, `不支持的节点类型: ${node.type}`);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    return mkStep(false, msg);
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

    // 4. 解析请求体
    let rawBody: Record<string, unknown> = {};
    let webhookContent: Record<string, unknown> = {};
    try {
      rawBody = await request.json();
      webhookContent = (rawBody.content as Record<string, unknown>) || {};
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

    // 5. 依次执行每个节点（支持所有节点类型）
    const steps: ExecutionStep[] = [];
    const startTime = Date.now();
    let hasFailure = false;
    let stopped = false; // filter 条件不通过时可提前终止
    const prevOutputs: Record<string, unknown> = {};

    for (const node of workflow.nodes) {
      if (stopped) break;
      if (node.type === 'trigger' || node.type === 'end') continue;

      const step = await executeNode(node, webhookContent, prevOutputs);
      steps.push(step);

      // 将本节点输出存入 prevOutputs，供后续节点引用
      if (step.output) {
        prevOutputs[node.id] = step.output;
      }

      if (!step.success) {
        hasFailure = true;
        // filter 不通过时终止执行
        if (node.type === 'filter') {
          stopped = true;
        }
      }
    }

    const totalDuration = Date.now() - startTime;

    // 6. 写入执行日志
    const execution: Execution = {
      id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: hasFailure ? 'failure' : 'success',
      triggerTime: new Date().toISOString(),
      durationMs: totalDuration,
      requestSummary: {
        content: webhookContent,
        token: secretToken || undefined,
      },
      steps,
    };
    await appendExecution(execution);

    const results = steps.map((s) => `${s.success ? '✓' : '✗'} ${s.title}: ${s.message}`);
    console.log(`[webhook] 执行结果:`, results);
    return NextResponse.json({
      code: 0,
      msg: hasFailure ? '部分步骤失败' : 'ok',
      data: { workflowName: workflow.name, results },
    });
  } catch (error: any) {
    console.error('[webhook] 内部错误:', error);
    return NextResponse.json(
      { code: 99, msg: error.message || 'internal error' },
      { status: 500 },
    );
  }
}
