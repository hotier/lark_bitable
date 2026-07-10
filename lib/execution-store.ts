/**
 * 执行日志持久化存储（Neon PostgreSQL）
 *
 * 保留最近 500 条执行记录，通过概率清理机制自动删除旧数据。
 *
 * 优化要点：
 * - 概率清理：仅 10% 的写入触发清理（代替每次写入都扫描全表）
 * - 联合索引：利用 idx_executions_wf_time 加速按工作流筛选 + 时间排序的查询
 */

import { sql } from '@/lib/db';
import type { Execution, ExecutionStep } from '@/types';

const MAX_EXECUTIONS = 500;
const CLEANUP_PROBABILITY = 0.1; // 10% 概率触发清理
const RETENTION_DAYS = 30; // 超过该天数的日志自动删除，避免无序增长

/**
 * 单字段最大保留长度。超出（典型是 webhook 上传的图片 base64 data URL，
 * 动辄数 MB）会被截断，避免单条执行记录膨胀导致列表/详情查询超时或超 64MB 上限。
 */
const MAX_FIELD_LEN = 2000;

/** 递归裁剪超大字符串，base64 data URL 直接替换为占位说明，避免撑爆日志 */
function deepTruncate(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:') && value.includes(';base64,')) {
      const comma = value.indexOf(',');
      const header = comma >= 0 ? value.slice(0, comma) : 'data:';
      return `[base64 数据已省略，约 ${Math.round(value.length / 1024)} KB] ${header}`;
    }
    if (value.length > MAX_FIELD_LEN) {
      return `${value.slice(0, MAX_FIELD_LEN)}…[已截断，原始 ${value.length} 字符]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepTruncate);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepTruncate(v);
    }
    return out;
  }
  return value;
}

/**
 * 读取执行记录摘要列表（按时间倒序，可选按 workflowId 过滤）。
 * 关键优化：列表不 SELECT 完整的 steps / request_summary（体积可能极大，
 * 易触发 Neon 64MB 响应上限），仅返回元数据 + step_count，完整数据按需按 id 获取。
 */
export async function getExecutions(workflowId?: string): Promise<Execution[]> {
  let rows;
  if (workflowId) {
    rows = await sql()`
      SELECT id, workflow_id, workflow_name, status, trigger_time,
             duration_ms, trigger_kind, jsonb_array_length(steps) AS step_count
      FROM executions
      WHERE workflow_id = ${workflowId}
      ORDER BY trigger_time DESC
      LIMIT ${MAX_EXECUTIONS}
    `;
  } else {
    rows = await sql()`
      SELECT id, workflow_id, workflow_name, status, trigger_time,
             duration_ms, trigger_kind, jsonb_array_length(steps) AS step_count
      FROM executions
      ORDER BY trigger_time DESC
      LIMIT ${MAX_EXECUTIONS}
    `;
  }

  return rows.map((r) => ({
    id: r.id as string,
    workflowId: r.workflow_id as string,
    workflowName: r.workflow_name as string,
    status: r.status as Execution['status'],
    triggerTime: r.trigger_time as string,
    durationMs: r.duration_ms as number,
    requestSummary: { content: {} },
    steps: [],
    stepCount: Number(r.step_count) || 0,
    triggerKind: (r.trigger_kind as Execution['triggerKind']) || 'webhook',
  }));
}

/**
 * 按 id 读取单条完整执行记录（含 steps 与 request_summary），供详情钻取使用。
 */
export async function getExecutionById(id: string): Promise<Execution | null> {
  const rows = await sql()`
    SELECT id, workflow_id, workflow_name, status, trigger_time,
           duration_ms, request_summary, steps, trigger_kind, trigger_detail
    FROM executions
    WHERE id = ${id}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  const triggerKind = (r.trigger_kind as Execution['triggerKind']) || 'webhook';
  const triggerDetail = (r.trigger_detail as Record<string, unknown>) || {};

  // 回填：历史记录若未存 webhook 地址，从工作流触发器配置中补取（仅 webhook 类型）
  if (triggerKind === 'webhook' && !triggerDetail.webhookUrl) {
    try {
      const wf = await sql()`
        SELECT nodes FROM workflows WHERE id = ${r.workflow_id}
      `;
      const nodes = (wf[0]?.nodes as Array<{ type: string; triggerConfig?: { webhookUrl?: string } }>) || [];
      const triggerNode = nodes.find((n) => n.type === 'trigger');
      const url = triggerNode?.triggerConfig?.webhookUrl;
      if (url) triggerDetail.webhookUrl = url;
    } catch {
      /* 回填失败不影响主流程 */
    }
  }

  return {
    id: r.id as string,
    workflowId: r.workflow_id as string,
    workflowName: r.workflow_name as string,
    status: r.status as Execution['status'],
    triggerTime: r.trigger_time as string,
    durationMs: r.duration_ms as number,
    requestSummary: deepTruncate(r.request_summary) as Execution['requestSummary'] || { content: {} },
    steps: deepTruncate(r.steps) as ExecutionStep[] || [],
    triggerKind,
    triggerDetail,
  };
}

/** 新增一条执行记录，并概率性地清理旧数据 */
export async function appendExecution(exec: Execution): Promise<void> {
  // 写入前裁剪超大字段，避免单条记录体积失控（图片 base64 / 超长文本）
  const safeSummary = deepTruncate(exec.requestSummary) as Execution['requestSummary'];
  const safeSteps = deepTruncate(exec.steps) as ExecutionStep[];

  await sql()`
    INSERT INTO executions
      (id, workflow_id, workflow_name, status, trigger_time, duration_ms,
       request_summary, steps, trigger_kind, trigger_detail)
    VALUES
      (${exec.id}, ${exec.workflowId}, ${exec.workflowName}, ${exec.status},
       ${exec.triggerTime}, ${exec.durationMs},
       ${JSON.stringify(safeSummary)}::jsonb,
       ${JSON.stringify(safeSteps)}::jsonb,
       ${exec.triggerKind ?? 'webhook'},
       ${JSON.stringify(exec.triggerDetail ?? {})}::jsonb)
  `;

  // 概率性清理：仅 10% 的写入触发，减少数据库开销
  if (Math.random() < CLEANUP_PROBABILITY) {
    await cleanupExcess();
    await cleanupOld();
  }
}

/** 清理超出数量限制的旧记录 */
async function cleanupExcess(): Promise<void> {
  await sql()`
    DELETE FROM executions
    WHERE id NOT IN (
      SELECT id FROM executions
      ORDER BY trigger_time DESC
      LIMIT ${MAX_EXECUTIONS}
    )
  `;
}

/**
 * 删除超过保留期（RETENTION_DAYS）的旧记录，避免日志无序增长。
 * 利用 trigger_time 上的索引高效定位，仅删除 30 天前的记录。
 */
async function cleanupOld(): Promise<void> {
  await sql()`
    DELETE FROM executions
    WHERE trigger_time < NOW() - (${RETENTION_DAYS} * INTERVAL '1 day')
  `;
}
