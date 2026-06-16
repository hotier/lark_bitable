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

/** 读取执行记录（按时间倒序，可选按 workflowId 过滤） */
export async function getExecutions(workflowId?: string): Promise<Execution[]> {
  let rows;
  if (workflowId) {
    rows = await sql()`
      SELECT id, workflow_id, workflow_name, status, trigger_time,
             duration_ms, request_summary, steps
      FROM executions
      WHERE workflow_id = ${workflowId}
      ORDER BY trigger_time DESC
      LIMIT ${MAX_EXECUTIONS}
    `;
  } else {
    rows = await sql()`
      SELECT id, workflow_id, workflow_name, status, trigger_time,
             duration_ms, request_summary, steps
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
    requestSummary: (r.request_summary as Execution['requestSummary']) || { content: {} },
    steps: (r.steps as ExecutionStep[]) || [],
  }));
}

/** 新增一条执行记录，并概率性地清理旧数据 */
export async function appendExecution(exec: Execution): Promise<void> {
  await sql()`
    INSERT INTO executions
      (id, workflow_id, workflow_name, status, trigger_time, duration_ms, request_summary, steps)
    VALUES
      (${exec.id}, ${exec.workflowId}, ${exec.workflowName}, ${exec.status},
       ${exec.triggerTime}, ${exec.durationMs},
       ${JSON.stringify(exec.requestSummary)}::jsonb,
       ${JSON.stringify(exec.steps)}::jsonb)
  `;

  // 概率性清理：仅 10% 的写入触发，减少数据库开销
  if (Math.random() < CLEANUP_PROBABILITY) {
    await cleanupExcess();
  }
}

/** 清理超出限制的旧记录 */
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
