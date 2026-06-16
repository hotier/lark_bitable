/**
 * Next.js 服务端 instrumentation — 启动时自动建表
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('@/lib/db');
    try {
      await runMigrations();
      console.log('[instrumentation] 数据库迁移完成');
    } catch (err) {
      console.error('[instrumentation] 数据库迁移失败:', err);
    }
  }
}
