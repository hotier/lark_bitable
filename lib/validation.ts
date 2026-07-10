/**
 * 入参校验（zod）
 *
 * 用于 API 路由的入参边界控制，替代 `any`，既防注入/越界，也给出清晰错误。
 * 当前聚焦 Webhook 触发器配置与请求体解析。
 */
import { z } from 'zod';
import { sanitizeAgainstPrototypePollution } from '@/lib/webhook-utils';

/** secretToken 校验：可选，留空表示不校验；非空时限制长度 */
export const secretTokenSchema = z
  .string()
  .max(512, 'secretToken 不得超过 512 字符')
  .optional();

/**
 * 归一化 secretToken：校验通过则返回去除首尾空白的字符串，否则返回空串（即不校验）。
 */
export function parseSecretToken(value: unknown): string {
  const r = secretTokenSchema.safeParse(value);
  return r.success && r.data ? r.data.trim() : '';
}

/** 路由实际使用的触发器配置子集（取代 any，给出类型与边界） */
export const webhookTriggerConfigSchema = z
  .object({
    secretToken: secretTokenSchema,
    webhookUrl: z.string().optional(),
    webhookBodyTemplate: z.string().max(10000, '模板过长').optional(),
  })
  .passthrough();

export type WebhookTriggerConfig = z.infer<typeof webhookTriggerConfigSchema>;

/**
 * 安全解析 webhook 请求体：
 * - 必须是对象（数组 / 基本类型按空对象处理）
 * - 递归去除 __proto__ 等危险 key，避免原型链污染
 */
export function parseWebhookBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return sanitizeAgainstPrototypePollution(body as Record<string, unknown>);
}

// ====== /api/bitable 入参校验 ======
// 用 zod 取代原先散落在路由各 case 中的 `if (!xxx) throw new Error` 粗校验，
// 让「参数错误」以清晰的 400 返回，而不是被 catch 兜底成 500。

const requiredStr = (name: string) =>
  z.string({ error: `缺少参数: ${name}` }).min(1, { error: `缺少参数: ${name}` });

const optionalStr = z.string().optional();
const optionalPageSize = z.union([z.number(), z.string()]).optional();
const requiredFields = z
  .any()
  .refine((v) => v !== undefined && v !== null, { error: '缺少参数: fields' });

/** 每个 action 对应的字段 schema（仅约束必填项，其余字段 passthrough 透传） */
export const bitableActionSchemas: Record<string, z.ZodTypeAny> = {
  getOAuthUrl: z.object({}).passthrough(),
  authStatus: z.object({}).passthrough(),
  exchangeAuthCode: z.object({}).passthrough(),
  logout: z.object({}).passthrough(),
  listApps: z.object({ pageSize: optionalPageSize, pageToken: optionalStr, folderToken: optionalStr }).passthrough(),
  createApp: z.object({ appName: requiredStr('appName') }).passthrough(),
  listDocs: z.object({ pageSize: optionalPageSize, pageToken: optionalStr, folderToken: optionalStr }).passthrough(),
  createDoc: z.object({ appName: requiredStr('appName') }).passthrough(),
  listSheets: z.object({ pageSize: optionalPageSize, pageToken: optionalStr, folderToken: optionalStr }).passthrough(),
  createSheet: z.object({ appName: requiredStr('appName') }).passthrough(),
  deleteFile: z.object({ fileToken: requiredStr('fileToken'), fileType: requiredStr('fileType') }).passthrough(),
  listTables: z.object({ appToken: requiredStr('appToken') }).passthrough(),
  createTable: z.object({ appToken: requiredStr('appToken'), tableName: requiredStr('tableName'), fields: requiredFields }).passthrough(),
  deleteTable: z.object({ appToken: requiredStr('appToken'), tableId: requiredStr('tableId') }).passthrough(),
  listFields: z.object({ appToken: requiredStr('appToken'), tableId: requiredStr('tableId') }).passthrough(),
  list: z.object({ appToken: requiredStr('appToken'), tableId: requiredStr('tableId') }).passthrough(),
  read: z.object({ appToken: requiredStr('appToken'), tableId: requiredStr('tableId'), recordId: requiredStr('recordId') }).passthrough(),
  create: z.object({ appToken: requiredStr('appToken'), tableId: requiredStr('tableId'), fields: requiredFields }).passthrough(),
  update: z.object({ appToken: requiredStr('appToken'), tableId: requiredStr('tableId'), recordId: requiredStr('recordId'), fields: requiredFields }).passthrough(),
  delete: z.object({ appToken: requiredStr('appToken'), tableId: requiredStr('tableId'), recordId: requiredStr('recordId') }).passthrough(),
};

export const bitableActionNames = Object.keys(bitableActionSchemas);

/**
 * 校验 /api/bitable 请求体。
 * @returns 错误字符串（调用方应映射为 HTTP 400）；null 表示校验通过。
 */
export function validateBitableBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return '请求体格式错误';
  }
  const b = body as Record<string, unknown>;
  const action = b.action;
  if (action === undefined || action === null) {
    return '缺少必要参数: action';
  }
  if (typeof action !== 'string' || !bitableActionNames.includes(action)) {
    return `不支持的操作类型: ${typeof action === 'string' ? action : ''}`;
  }
  const result = bitableActionSchemas[action].safeParse(b);
  if (!result.success) {
    return result.error.issues[0]?.message ?? '参数校验失败';
  }
  return null;
}
