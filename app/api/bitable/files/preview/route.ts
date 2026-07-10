import { NextResponse } from 'next/server';
import { decrypt } from '@/lib/crypto';
import { proxyFeishuFile } from '@/lib/preview-proxy';
import { logger } from '@/lib/logger';

/**
 * GET /api/bitable/files/preview?t=<encrypted_token>
 * 代理飞书文件内容（旧格式，保留兼容）
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const encryptedToken = searchParams.get('t');

    let fileToken: string;
    let tableId: string | undefined;
    let fieldId: string | undefined;
    let recordId: string | undefined;
    let fileName: string;

    if (encryptedToken) {
      const data = decrypt(encryptedToken);
      fileToken = data.ft as string;
      tableId = data.tid as string | undefined;
      fieldId = data.fid as string | undefined;
      recordId = data.rid as string | undefined;
      fileName = (data.n as string) || fileToken || 'file';
    } else {
      fileToken = searchParams.get('file_token') || '';
      tableId = searchParams.get('table_id') || undefined;
      fieldId = searchParams.get('field_id') || undefined;
      recordId = searchParams.get('record_id') || undefined;
      fileName = searchParams.get('name') || fileToken || 'file';
    }

    if (!fileToken) {
      return NextResponse.json({ error: '缺少参数: file_token' }, { status: 400 });
    }

    return proxyFeishuFile({ fileToken, tableId, fieldId, recordId, fileName });
  } catch (error) {
    logger.error('[FilePreview] 预览异常:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '预览失败' },
      { status: 500 }
    );
  }
}
