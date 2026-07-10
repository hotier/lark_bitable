/**
 * Next.js 服务端 instrumentation — 启动时自动建表
 *
 * 注意：部署在 Vercel serverless 上时，函数实例是临时的，
 * 不适合用 setInterval 做定时保活。飞书 token 的定时刷新请改用
 * Vercel Cron（见 vercel.json 中的 crons 配置，命中 /api/bitable/keepalive）。
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
