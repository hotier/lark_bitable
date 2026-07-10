import { NextResponse } from 'next/server';

/**
 * 统一的 API 响应构造器。
 *
 * 项目内目前存在多套响应信封：
 *   - /api/bitable       → { success, error, data }
 *   - /api/workflows、oauth → { error }
 *   - /api/executions    → { code, msg }
 * 前端对各端点的解析方式强耦合，因此这里只提供构造工具，**不强制统一字段名**，
 * 以免破坏既有调用方。后续若统一信封，再逐步迁移各路由调用此构造器即可。
 */

/** 成功响应（默认带上 success:true，便于前端 request() 统一判断） */
export function okResponse<T>(data: T, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: true, data, ...extra });
}

/** 错误响应（默认 success:false + 500；可附加 needLogin / feishuCode 等字段） */
export function errorResponse(
  message: string,
  status = 500,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}
