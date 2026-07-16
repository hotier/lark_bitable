import { NextResponse } from 'next/server';
import { proxyFeishuFile } from '@/lib/preview-proxy';
import { logger } from '@/lib/logger';

/**
 * GET /api/feishu/files/preview?ft=<file_token>&tid=<table_id>&fid=<field_id>&rid=<record_id>&n=<name>
 * 代理飞书文件内容（无状态，不依赖数据库）
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const fileToken = searchParams.get('ft') || '';
    const tableId = searchParams.get('tid') || undefined;
    const fieldId = searchParams.get('fid') || undefined;
    const recordId = searchParams.get('rid') || undefined;
    const fileName = searchParams.get('n') || fileToken || 'file';

    if (!fileToken) {
      return NextResponse.json({ error: '缺少参数: ft' }, { status: 400 });
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
