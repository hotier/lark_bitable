import { NextResponse } from 'next/server';
import { getExecutions, getExecutionById } from '@/lib/execution-store';
import { ensureMigrations } from '@/lib/db';
import { withCache, cacheKey, DEFAULT_TTL } from '@/lib/cache';
import { logger } from '@/lib/logger';

/**
 * GET /api/executions — 获取执行日志
 *
 * 两种模式：
 *  1) 单条详情：?id=xxx  → 返回完整记录（含 steps / request_summary）
 *  2) 列表：?workflowId / ?status / ?limit / ?offset / ?refresh=1
 *            → 返回元数据摘要（不含完整 steps，避免响应过大）
 *
 * 列表返回：{ code, data: { total, successCount, failureCount, executions, hasMore } }
 *   - total / successCount / failureCount 基于「未分页、未状态过滤」的全量集合统计
 *   - executions 为应用状态过滤 + 分页后的结果
 */

export async function GET(request: Request) {
 try {
  // 惰性迁移：确保 executions 表结构（含 trigger_kind 等）已就绪
  await ensureMigrations();

  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  // 模式 1：单条完整记录
  if (id) {
    const execution = await getExecutionById(id);
    if (!execution) {
      return NextResponse.json({ code: 1, msg: 'execution not found' }, { status: 404 });
    }
    return NextResponse.json({ code: 0, data: execution });
  }

  // 模式 2：列表摘要
  const workflowId = url.searchParams.get('workflowId') || undefined;
  const status = url.searchParams.get('status') || undefined;
  const refresh = url.searchParams.get('refresh') === '1';

  const limitRaw = Number(url.searchParams.get('limit') || '50');
  const offsetRaw = Number(url.searchParams.get('offset') || '0');
  const limit = Math.min(Math.max(limitRaw || 50, 1), 500);
  const offset = Math.max(offsetRaw || 0, 0);

  const baseKey = cacheKey('api', 'executions', workflowId || 'all');

  // 统计与分页都基于同一份全量集合（避免重复读库）
  const all = refresh
    ? await getExecutions(workflowId)
    : await withCache(baseKey, () => getExecutions(workflowId), DEFAULT_TTL);

  const total = all.length;
  const successCount = all.filter((e) => e.status === 'success').length;
  const failureCount = all.filter((e) => e.status === 'failure').length;

  const filtered = status ? all.filter((e) => e.status === status) : all;
  const executions = filtered.slice(offset, offset + limit);

  return NextResponse.json({
    code: 0,
    data: {
      total,
      successCount,
      failureCount,
      executions,
      hasMore: offset + limit < filtered.length,
    },
  });
 } catch (error) {
   logger.error('[api/executions] 读取失败:', error);
   const message = error instanceof Error ? error.message : '读取失败';
   return NextResponse.json({ code: 1, msg: message }, { status: 500 });
 }
}
