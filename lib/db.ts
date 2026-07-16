/**
 * Neon PostgreSQL 数据库客户端
 *
 * 连接池通过 DATABASE_URL 环境变量配置。
 * 单例模式 + 版本化迁移，服务启动时自动执行。
 */

import { neon } from '@neondatabase/serverless';
import type { NeonQueryFunction } from '@neondatabase/serverless';

let _sql: NeonQueryFunction<false, false> | null = null;

/** 获取 SQL 查询函数（懒初始化，运行时读取环境变量） */
export function sql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL 环境变量未配置');
    }
    _sql = neon(dbUrl);
  }
  return _sql;
}

/** 健康检查 — 测试数据库连接是否正常 */
export async function healthCheck(): Promise<boolean> {
  try {
    const s = sql();
    await s`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * 版本化迁移脚本 — 服务启动时调用一次
 *
 * 每个迁移版本是一个独立步骤，通过 schema_migrations 表追踪已执行的版本。
 * 新增迁移只需在高位追加步骤 + 更新 LATEST_VERSION。
 */
const LATEST_VERSION = 6;

/**
 * 惰性迁移 — 仅在「已应用版本 < LATEST_VERSION」时执行（Vercel serverless 每次冷启动重置）。
 * 改用版本号而非布尔量，确保 LATEST_VERSION 升级后（即便模块被 HMR 缓存）也能重新跑迁移。
 */
let appliedVersion = 0;
let lastFailureAt = 0;
// 迁移失败后的重试冷却期：避免每个请求都去尝试连接一个不可达的 DB
// （每次约 10s 超时）。冷却期内直接跳过，DB 恢复后会在冷却结束后自动重试一次。
const MIGRATION_RETRY_COOLDOWN = 5 * 60 * 1000;

export async function ensureMigrations(): Promise<void> {
  if (appliedVersion >= LATEST_VERSION) return;
  // 上次迁移失败且在冷却期内：直接跳过，避免「每次 API 请求都卡 10s」
  if (lastFailureAt && Date.now() - lastFailureAt < MIGRATION_RETRY_COOLDOWN) return;
  try {
    await runMigrations();
    appliedVersion = LATEST_VERSION;
  } catch (err: any) {
    lastFailureAt = Date.now();
    console.warn('[db] 数据库迁移失败（DB 未配置或连接异常）:', err?.message || String(err));
    // 不阻塞业务——迁移失败不影响 API 代理等核心功能
  }
}

export async function runMigrations(): Promise<void> {
  const s = sql();

  // 迁移版本追踪表
  await s`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT ''
    )
  `;

  const result = await s`SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations`;
  const currentVersion = Number(result[0]?.v ?? 0);

  // ── V1: 初始表结构 ──
  if (currentVersion < 1) {
    await s`
      CREATE TABLE IF NOT EXISTS workflows (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL DEFAULT '',
        nodes       JSONB NOT NULL DEFAULT '[]'::jsonb,
        status      TEXT NOT NULL DEFAULT 'draft',
        created_at  TEXT NOT NULL DEFAULT '',
        updated_at  TEXT NOT NULL DEFAULT ''
      )
    `;
    await s`
      CREATE TABLE IF NOT EXISTS executions (
        id              TEXT PRIMARY KEY,
        workflow_id     TEXT NOT NULL,
        workflow_name   TEXT NOT NULL DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'success',
        trigger_time    TEXT NOT NULL DEFAULT '',
        duration_ms     INTEGER NOT NULL DEFAULT 0,
        request_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        steps           JSONB NOT NULL DEFAULT '[]'::jsonb
      )
    `;
    await s`
      CREATE INDEX IF NOT EXISTS idx_executions_workflow_id
      ON executions (workflow_id)
    `;
    await s`
      CREATE INDEX IF NOT EXISTS idx_executions_trigger_time
      ON executions (trigger_time DESC)
    `;

    await s`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (1, ${new Date().toISOString()})
    `;
    console.log('[db] V1 迁移完成');
  }

  // ── V2: GIN索引 + 联合索引 ──
  if (currentVersion < 2) {
    await s`CREATE INDEX IF NOT EXISTS idx_workflows_nodes_gin ON workflows USING GIN (nodes)`;

    await s`
      CREATE INDEX IF NOT EXISTS idx_executions_wf_time
      ON executions (workflow_id, trigger_time DESC)
    `;

    await s`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (2, ${new Date().toISOString()})
    `;
    console.log('[db] V2 迁移完成（GIN索引 + 联合索引）');
  }

  // ── V3: token 持久化表（替代文件存储，兼容 Vercel serverless） ──
  if (currentVersion < 3) {
    await s`
      CREATE TABLE IF NOT EXISTS user_tokens (
        id                     TEXT PRIMARY KEY DEFAULT 'default',
        access_token           TEXT NOT NULL DEFAULT '',
        access_token_expire_at BIGINT NOT NULL DEFAULT 0,
        refresh_token          TEXT NOT NULL DEFAULT '',
        refresh_token_expire_at BIGINT NOT NULL DEFAULT 0,
        updated_at             TEXT NOT NULL DEFAULT ''
      )
    `;

    await s`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (3, ${new Date().toISOString()})
    `;
    console.log('[db] V3 迁移完成（user_tokens 表）');
  }

  // V4 已废弃（原 preview_tokens 索引，短链方案已移除）

  // ── V5: executions 记录触发器类型与快照（用于动态展示触发来源） ──
  if (currentVersion < 5) {
    await s`
      ALTER TABLE executions
        ADD COLUMN IF NOT EXISTS trigger_kind  TEXT NOT NULL DEFAULT 'webhook',
        ADD COLUMN IF NOT EXISTS trigger_detail JSONB NOT NULL DEFAULT '{}'::jsonb
    `;

    await s`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (5, ${new Date().toISOString()})
    `;
    console.log('[db] V5 迁移完成（executions.trigger_kind / trigger_detail）');
  }

  // ── V6: 工作流删除墓碑（跨设备删除传播，避免整组覆盖互删） ──
  if (currentVersion < 6) {
    await s`
      CREATE TABLE IF NOT EXISTS workflow_tombstones (
        id          TEXT PRIMARY KEY,
        deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await s`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (6, ${new Date().toISOString()})
    `;
    console.log('[db] V6 迁移完成（workflow_tombstones 表）');
  }
}
