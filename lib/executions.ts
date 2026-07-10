/**
 * 执行日志前端数据访问层
 *
 * 封装对 GET /api/executions 的调用，统一返回分页 + 统计结构。
 * 与 lib/api.ts 分离，避免与多维表格业务耦合。
 */

import type { Execution } from '@/types';

export interface FetchExecutionsParams {
  workflowId?: string;
  status?: 'success' | 'failure';
  limit?: number;
  offset?: number;
  /** 绕过服务端缓存，强制读库（自动刷新时使用） */
  refresh?: boolean;
}

export interface ExecutionsResult {
  total: number;
  successCount: number;
  failureCount: number;
  executions: Execution[];
  hasMore: boolean;
}

export async function fetchExecutions(params: FetchExecutionsParams = {}): Promise<ExecutionsResult> {
  const qs = new URLSearchParams();
  if (params.workflowId) qs.set('workflowId', params.workflowId);
  if (params.status) qs.set('status', params.status);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  if (params.refresh) qs.set('refresh', '1');

  const res = await fetch(`/api/executions?${qs.toString()}`, { cache: 'no-store' });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.error || '获取执行日志失败');
  }
  return json.data as ExecutionsResult;
}

/** 获取单条完整执行记录（含 steps / request_summary），供详情钻取 */
export async function fetchExecutionById(id: string): Promise<Execution> {
  const res = await fetch(`/api/executions?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.error || '获取执行详情失败');
  }
  return json.data as Execution;
}
