/**
 * 工作流持久化存储（Neon PostgreSQL）
 *
 * - UPSERT 替代 DELETE+INSERT：先插入后删除残留，避免"删除-插入"之间数据丢失
 * - JSONB 索引查询：webhook URL 查找直接在数据库层完成，利用 GIN 索引
 */

import { sql } from '@/lib/db';
import type { Workflow, WorkflowNode, WorkflowSummary } from '@/types';

/** 缓存 key 与 TTL（与 app/api/workflows 路由共享） */
export const WF_CACHE_KEY = 'api:workflows';
export const WF_LIST_CACHE_KEY = 'api:workflows:list';
export const WF_TTL = 15_000;          // 节点缓存：写即失效 + 15s 兜底
export const WF_LIST_TTL = 5 * 60_000; // 列表缓存：事件失效 + 5min 兜底

/** 读取所有工作流 */
export async function loadWorkflows(): Promise<Workflow[]> {
  const rows = await sql()`
    SELECT id, name, nodes, status, created_at, updated_at
    FROM workflows
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    nodes: (r.nodes as WorkflowNode[]) || [],
    status: r.status as Workflow['status'],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

/** 读取工作流摘要列表（列表卡片用，不加载 nodes 内容） */
export async function loadWorkflowSummaries(): Promise<WorkflowSummary[]> {
  const rows = await sql()`
    SELECT id, name, status, created_at, updated_at,
           jsonb_array_length(COALESCE(nodes, '[]'::jsonb)) AS node_count
    FROM workflows
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    status: r.status as Workflow['status'],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    nodeCount: Number(r.node_count) || 0,
  }));
}

/**
 * 保存所有工作流（全量同步）
 *
 * 使用 UPSERT 而非 DELETE+INSERT：
 * - 先做 INSERT … ON CONFLICT DO UPDATE，已有数据不会被删除
 * - 再清理不在当前列表中的残留记录（best-effort）
 *
 * 相比旧版 DELETE→INSERT 的优势：
 * - 即使客户端中途崩溃，已有工作流不丢失
 * - 每条 UPSERT 是幂等的
 */
export async function saveWorkflows(workflows: Workflow[]): Promise<void> {
  const s = sql();

  // Step 1: UPSERT 每条工作流（幂等，失败不影响已有数据）
  for (const w of workflows) {
    await s`
      INSERT INTO workflows (id, name, nodes, status, created_at, updated_at)
      VALUES (
        ${w.id},
        ${w.name},
        ${JSON.stringify(w.nodes)}::jsonb,
        ${w.status},
        ${w.createdAt},
        ${w.updatedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        name       = EXCLUDED.name,
        nodes      = EXCLUDED.nodes,
        status     = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at
    `;
  }

  // Step 2: 清理不再属于当前列表的工作流（用户删除的工作流）
  if (workflows.length > 0) {
    const keepIds = new Set(workflows.map((w) => w.id));
    const existing = await s`SELECT id FROM workflows`;
    const staleIds = existing
      .map((r) => r.id as string)
      .filter((id) => !keepIds.has(id));

    for (const id of staleIds) {
      await s`DELETE FROM workflows WHERE id = ${id}`;
    }
  } else {
    await s`DELETE FROM workflows`;
  }
}

/**
 * 根据 webhook URL 路径查找工作流和触发节点
 *
 * 使用 JSONB @> 包含运算符 + GIN 索引在数据库层直接过滤，
 * 不再全表拉回应用层遍历。
 */
export async function findWorkflowByWebhookUrl(webhookPath: string): Promise<{
  workflow: Workflow;
  triggerNode: WorkflowNode;
} | null> {
  // 构造 JSONB 包含模式：查找 nodes 数组中包含 {type: "trigger", triggerConfig: {webhookUrl: "xxx"}} 的文档
  const pattern = JSON.stringify([
    { type: 'trigger', triggerConfig: { webhookUrl: webhookPath } },
  ]);

  const rows = await sql()`
    SELECT id, name, nodes, status, created_at, updated_at
    FROM workflows
    WHERE nodes @> ${pattern}::jsonb
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const r = rows[0];
  const workflow: Workflow = {
    id: r.id as string,
    name: r.name as string,
    nodes: (r.nodes as WorkflowNode[]) || [],
    status: r.status as Workflow['status'],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };

  // 从匹配的 workflow 中找到具体的 trigger 节点
  for (const node of workflow.nodes) {
    if (node.type === 'trigger' && node.triggerConfig?.webhookUrl === webhookPath) {
      return { workflow, triggerNode: node };
    }
  }

  return null;
}
