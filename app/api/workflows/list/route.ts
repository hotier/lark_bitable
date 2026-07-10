/**
 * GET /api/workflows/list — 读取工作流摘要列表（卡片用，不含 nodes）
 *
 * 事件缓存：POST /api/workflows 保存后会立即 cacheDel，
 * 由新建/删除/改名/启停/保存等事件驱动失效；TTL 仅作兜底。
 */
import { NextResponse } from 'next/server';
import { loadWorkflowSummaries, WF_LIST_CACHE_KEY, WF_LIST_TTL } from '@/lib/workflow-store';
import { withCache } from '@/lib/cache';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const list = await withCache(
      WF_LIST_CACHE_KEY,
      () => loadWorkflowSummaries(),
      WF_LIST_TTL,
    );
    return NextResponse.json({ workflows: list });
  } catch (error) {
    logger.error('[api/workflows/list] 读取失败:', error);
    const message = error instanceof Error ? error.message : '读取失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
