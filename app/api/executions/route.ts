import { NextResponse } from 'next/server';
import { getExecutions } from '@/lib/execution-store';
import { withCache, cacheKey, DEFAULT_TTL } from '@/lib/cache';

/**
 * GET /api/executions — 获取执行日志列表（按时间倒序）
 * 可选 query: workflowId 过滤指定工作流
 *
 * 带内存缓存：同一 workflowId 的查询结果缓存 DEFAULT_TTL（默认30s），
 * 减少数据库往返，加速前端频繁轮询。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const workflowId = url.searchParams.get('workflowId') || undefined;

  const execKey = cacheKey('api', 'executions', workflowId || 'all');

  const executions = await withCache(
    execKey,
    () => getExecutions(workflowId),
    DEFAULT_TTL,
  );

  return NextResponse.json({
    code: 0,
    data: {
      total: executions.length,
      executions,
    },
  });
}
