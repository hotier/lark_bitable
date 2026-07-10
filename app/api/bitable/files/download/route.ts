import { NextResponse } from 'next/server';
import { bitableService } from '@/services/feishu-bitable';
import { logger } from '@/lib/logger';

/**
 * GET /api/bitable/files/download?file_token=xxx&table_id=xxx&field_id=xxx&record_id=xxx
 * 获取飞书素材临时下载链接（24小时有效，支持高级权限表格）
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileToken = searchParams.get('file_token');
    const tableId = searchParams.get('table_id');
    const fieldId = searchParams.get('field_id');
    const recordId = searchParams.get('record_id');

    if (!fileToken) {
      return NextResponse.json({ error: '缺少参数: file_token' }, { status: 400 });
    }

    const tmpUrl = await bitableService.getTmpDownloadUrl(
      fileToken,
      tableId || undefined,
      fieldId || undefined,
      recordId || undefined,
    );

    if (!tmpUrl) {
      return NextResponse.json(
        { error: '获取下载链接失败，请确认已授权登录' },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: tmpUrl });
  } catch (error) {
    logger.error('[FileSigned] 签发链接异常:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '签发失败' },
      { status: 500 }
    );
  }
}
