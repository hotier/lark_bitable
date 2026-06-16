/**
 * POST /api/workflows — 前端同步工作流到服务端
 * GET  /api/workflows — 读取工作流列表（带内存缓存，写操作后自动失效）
 *
 * 前端每次持久化后调用此接口，将工作流写入数据库，
 * 供 webhook 接收端读取执行。
 */

import { NextResponse } from 'next/server';
import { saveWorkflows, loadWorkflows } from '@/lib/workflow-store';
import { withCache, cacheKey, cacheDel } from '@/lib/cache';

const WF_CACHE_KEY = cacheKey('api', 'workflows');
const WF_TTL = 15_000; // 15 秒缓存

export async function POST(request: Request) {
  try {
    const { workflows } = await request.json();
    if (!Array.isArray(workflows)) {
      return NextResponse.json({ error: '缺少参数: workflows' }, { status: 400 });
    }
    await saveWorkflows(workflows);
    // 写操作后立即失效缓存，确保下次 GET 读到最新数据
    cacheDel(WF_CACHE_KEY);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[api/workflows] 保存失败:', error);
    return NextResponse.json({ error: error.message || '保存失败' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const workflows = await withCache(
      WF_CACHE_KEY,
      () => loadWorkflows(),
      WF_TTL,
    );
    return NextResponse.json({ workflows });
  } catch (error: any) {
    console.error('[api/workflows] 读取失败:', error);
    return NextResponse.json({ error: error.message || '读取失败' }, { status: 500 });
  }
}
