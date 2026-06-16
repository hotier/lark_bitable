import { NextResponse } from 'next/server';
import { getPreviewToken } from '@/lib/preview-token-store';
import { proxyFeishuFile } from '@/lib/preview-proxy';

/**
 * GET /p/<short_id>
 * 短链接预览：根据短 ID 查找文件参数并代理飞书文件内容
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const entry = await getPreviewToken(token);
  if (!entry) {
    return NextResponse.json(
      { error: '预览链接已过期或不存在，请刷新页面后重试' },
      { status: 404 }
    );
  }

  return proxyFeishuFile({
    fileToken: entry.fileToken,
    tableId: entry.tableId,
    fieldId: entry.fieldId,
    recordId: entry.recordId,
    fileName: entry.fileName,
  });
}
