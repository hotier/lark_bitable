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
const LATEST_VERSION = 3;

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
      CREATE TABLE IF NOT EXISTS preview_tokens (
        id          TEXT PRIMARY KEY,
        file_token  TEXT NOT NULL DEFAULT '',
        table_id    TEXT,
        field_id    TEXT,
        record_id   TEXT,
        file_name   TEXT NOT NULL DEFAULT '',
        created_at  BIGINT NOT NULL DEFAULT 0
      )
    `;
    await s`
      CREATE INDEX IF NOT EXISTS idx_preview_tokens_file_token
      ON preview_tokens (file_token)
    `;

    await s`
      INSERT INTO schema_migrations (version, applied_at)
      VALUES (3, ${new Date().toISOString()})
    `;
    console.log('[db] V3 迁移完成（user_tokens + preview_tokens 表）');
  }
}
