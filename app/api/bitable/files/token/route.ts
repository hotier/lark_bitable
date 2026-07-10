import { NextResponse } from 'next/server';
import { savePreviewToken } from '@/lib/preview-token-store';
import { logger } from '@/lib/logger';

/**
 * POST /api/bitable/files/token
 * 将附件预览参数存储并返回一个短 ID
 * Body: { file_token, table_id?, field_id?, record_id?, name? }
 * Response: { id: "abc123de" }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { file_token, table_id, field_id, record_id, name } = body || {};

    if (!file_token) {
      return NextResponse.json({ error: '缺少参数: file_token' }, { status: 400 });
    }

    const id = await savePreviewToken({
      fileToken: file_token,
      tableId: table_id || undefined,
      fieldId: field_id || undefined,
      recordId: record_id || undefined,
      fileName: name || file_token || 'file',
    });

    return NextResponse.json({ id });
  } catch (error) {
    logger.error('[FileToken] 生成失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '生成失败' },
      { status: 500 }
    );
  }
}
