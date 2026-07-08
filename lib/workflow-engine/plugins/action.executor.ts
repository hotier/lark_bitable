/**
 * Action 节点执行器（服务端专用）
 *
 * 与 action.plugin.ts 分离以避免客户端 bundle 引入 @larksuiteoapi/node-sdk。
 */

import { createRequire } from 'module';
import type { WorkflowNode, ExecutionStep } from '@/types';
import type { ExecutionContext, NodeExecutor } from '../node-registry';

/**
 * 延迟导入 bitableService，仅在执行时加载（服务端）。
 * 此文件不会被客户端 bundle 引用。
 */
async function getBitableService() {
  const { bitableService } = await import('@/services/feishu-bitable');
  return bitableService;
}

// ---- 共享工具（与 action.plugin.ts 中的逻辑一致）----

async function resolveFieldValues(
  node: WorkflowNode,
  ctx: ExecutionContext,
): Promise<Record<string, unknown> | null> {
  const mappings = node.actionConfig?.fieldMappings;
  if (!mappings || mappings.length === 0) return null;

  const appToken = node.actionConfig?.targetAppToken || '';
  const fields: Record<string, unknown> = {};
  for (const m of mappings) {
      if (m.source === 'manual') {
        // 附件字段：手动值为空时跳过，避免写入空字符串触发飞书 AttachFieldConvFail
        if (m.fieldType === 'file' && (!m.manualValue || String(m.manualValue).length === 0)) {
          console.warn(`[webhook] 附件字段「${m.fieldName}」: 手动值为空，已跳过`);
          continue;
        }
        fields[m.fieldName] = m.manualValue;
      } else if (m.source === 'webhook') {
      const key = m.webhookKey.startsWith('content.') ? m.webhookKey.slice('content.'.length) : m.webhookKey;
      const raw = ctx.webhookContent[key];

      // 附件字段：把 webhook 传来的图片/文件写入多维表格
      if (m.fieldType === 'file') {
        if (typeof raw === 'string' && raw.length > 0) {
          try {
            if (raw.startsWith('http://') || raw.startsWith('https://')) {
              // 公网 URL 直传附件（无需上传）
              fields[m.fieldName] = [{ url: raw }];
              console.log(`[webhook] 附件字段「${m.fieldName}」: 使用公网 URL (${raw.length} 字符)`);
              continue;
            }
            if (raw.startsWith('data:')) {
              const mime = raw.match(/data:([^;]+)/)?.[1] || 'unknown';
              const b64len = raw.includes(',') ? raw.length - raw.indexOf(',') - 1 : raw.length;
              const approxKb = (b64len * 3 / 4 / 1024).toFixed(1);
              console.log(`[webhook] 附件字段「${m.fieldName}」: base64 图片, mime=${mime}, 约 ${approxKb}KB`);
              const bitableService = await getBitableService();
              // 统一转换为 webp：扩展名统一、体积更小、飞书预览更稳
              let uploadDataUrl = raw;
              let ext = 'webp';
              if (mime.startsWith('image/') && mime !== 'image/webp') {
                try {
                  // Next 16 Turbopack 会把一切能静态解析出 'sharp' 说明符的
                  // import/require 调用错误地 external 成 sharp-<hash> 而找不到。
                  // 用 new Function 隔离加载逻辑，使其成为不透明字符串，
                  // Turbopack 不静态分析，运行时由 node 直接 require 真实 sharp 包。
                  const require = createRequire(import.meta.url);
                  const sharp = new Function('require', 'return require("sharp");')(require);
                  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
                  const webpBuf = await sharp(Buffer.from(base64, 'base64')).webp().toBuffer();
                  uploadDataUrl = `data:image/webp;base64,${webpBuf.toString('base64')}`;
                  console.log(`[webhook] 附件字段「${m.fieldName}」: 已转 webp, ${(webpBuf.length / 1024).toFixed(1)}KB (原 ${approxKb}KB)`);
                } catch (e) {
                  console.warn(`[webhook] 附件字段「${m.fieldName}」: webp 转换失败，回退原格式(${mime})`, e);
                  ext = mime.includes('/') ? mime.split('/')[1] : 'bin';
                  uploadDataUrl = raw;
                }
              } else if (!mime.startsWith('image/')) {
                // 非图片（如 pdf）保持原扩展名
                ext = mime.includes('/') ? mime.split('/')[1] : 'bin';
              }
              const fileToken = await bitableService.uploadFileToBitable({
                fileName: `${m.fieldName || 'file'}.${ext}`,
                appToken,
                dataUrl: uploadDataUrl,
              });
              fields[m.fieldName] = [{ file_token: fileToken }];
              console.log(`[webhook] 附件字段「${m.fieldName}」: 上传成功, file_token=${fileToken}`);
              continue;
            }
            // 其他字符串（如普通文本）无法作为附件，跳过避免飞书报错
            console.warn(`[webhook] 附件字段「${m.fieldName}」: 收到非预期字符串(${raw.slice(0, 24)}…)，已跳过`);
            continue;
          } catch (err) {
            console.error(`[webhook] 附件上传失败 (字段 ${m.fieldName}):`, err);
            throw new Error(`附件字段「${m.fieldName}」上传失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          // 未收到有效附件值：跳过该字段，避免写入空字符串触发飞书 AttachFieldConvFail
          console.warn(`[webhook] 附件字段「${m.fieldName}」: 未收到有效值 (webhookKey=${m.webhookKey}, 实际类型=${typeof raw})，已跳过`);
          continue;
        }
      }

      fields[m.fieldName] = raw ?? '';
    } else if (m.source === 'variable') {
      const parts = m.variableKey.split(':');
      const root = ctx.nodeOutputs.get(parts[1]);
      fields[m.fieldName] = root ?? '';
    }
  }
  return fields;
}

function mkStep(
  title: string, action: string,
  success: boolean, message: string,
  output?: Record<string, unknown>,
  startTime?: number,
): ExecutionStep {
  return { title, action, success, message, durationMs: startTime ? Date.now() - startTime : undefined, output };
}

function requireConfig(node: WorkflowNode) {
  const cfg = node.actionConfig;
  if (!cfg || !cfg.targetAppToken || !cfg.targetTableId) {
    return { cfg: null, err: mkStep(node.title, 'action', false, '未配置目标数据表') };
  }
  return { cfg, err: null };
}

// ---- Executor ----

export const actionExecutor: NodeExecutor = async (node, ctx) => {
  const bitableService = await getBitableService();
  const stepStart = Date.now();
  const { cfg, err } = requireConfig(node);
  if (err) return err;
  if (!cfg) return mkStep(node.title, 'action', false, '未配置目标数据表', undefined, stepStart);

  const actionType = node.actionConfig?.action || 'read_records';

  try {
    switch (actionType) {
      case 'create_record': {
        const fields = await resolveFieldValues(node, ctx);
        if (!fields || Object.keys(fields).length === 0) {
          return mkStep(node.title, 'create_record', false, '无字段映射', undefined, stepStart);
        }
        const rec = await bitableService.createRecord(cfg.targetAppToken, cfg.targetTableId, fields);
        return mkStep(node.title, 'create_record', true, `记录已创建 (${rec.record_id})`, {
          record_id: rec.record_id,
          fields: rec.fields as Record<string, unknown>,
          created_time: rec.created_time,
        }, stepStart);
      }
      case 'read_records': {
        const data = await bitableService.listRecords(cfg.targetAppToken, cfg.targetTableId, 100, '');
        const records = data.records ?? [];
        const first = records[0] as { record_id?: string; fields?: Record<string, unknown> } | undefined;
        return mkStep(node.title, 'read_records', true, `查询完成 — ${data.total ?? '?'} 条`, {
          records: records as unknown as Record<string, unknown>,
          total_count: data.total ?? 0,
          first_record_id: first?.record_id ?? '',
          first_record: first as unknown as Record<string, unknown>,
        }, stepStart);
      }
      case 'update_record': {
        const fields = await resolveFieldValues(node, ctx);
        if (!fields || Object.keys(fields).length === 0) {
          return mkStep(node.title, 'update_record', false, '无字段映射', undefined, stepStart);
        }
        let recordId: string | null = null;
        if (cfg.filters && cfg.filters.length > 0) {
          recordId = await bitableService.findRecordByFilters(
            cfg.targetAppToken, cfg.targetTableId,
            cfg.filters as Array<{ fieldName: string; operator: string; value: string }>,
          );
        } else {
          const listData = await bitableService.listRecords(cfg.targetAppToken, cfg.targetTableId, 1, '');
          recordId = (listData?.records ?? [])[0]?.record_id ?? null;
        }
        if (!recordId) return mkStep(node.title, 'update_record', false, '无匹配记录', undefined, stepStart);
        const rec = await bitableService.updateRecord(cfg.targetAppToken, cfg.targetTableId, recordId, fields);
        return mkStep(node.title, 'update_record', true, '记录已更新', {
          record_id: recordId,
          fields: rec.fields as Record<string, unknown>,
          updated_time: rec.updated_time,
        }, stepStart);
      }
      case 'delete_record': {
        let recordId: string | null = null;
        if (cfg.filters && cfg.filters.length > 0) {
          recordId = await bitableService.findRecordByFilters(
            cfg.targetAppToken, cfg.targetTableId,
            cfg.filters as Array<{ fieldName: string; operator: string; value: string }>,
          );
        } else {
          const listData = await bitableService.listRecords(cfg.targetAppToken, cfg.targetTableId, 1, '');
          recordId = (listData?.records ?? [])[0]?.record_id ?? null;
        }
        if (!recordId) return mkStep(node.title, 'delete_record', false, '无匹配记录', undefined, stepStart);
        await bitableService.deleteRecord(cfg.targetAppToken, cfg.targetTableId, recordId);
        return mkStep(node.title, 'delete_record', true, '记录已删除', { record_id: recordId }, stepStart);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return mkStep(node.title, actionType, false, msg, undefined, stepStart);
  }

  return mkStep(node.title, actionType, false, `不支持的操作: ${actionType}`, undefined, stepStart);
};
