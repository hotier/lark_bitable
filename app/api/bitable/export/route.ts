import { NextRequest, NextResponse } from 'next/server';
import { bitableService } from '@/services/feishu-bitable';
import { logger } from '@/lib/logger';

// 导出涉及文件流，必须使用 Node.js 运行时
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

/**
 * POST /api/bitable/export
 * body: { appToken: string, format?: 'xlsx' | 'csv' }
 * 导出整个多维表格为 Excel/CSV 并触发下载
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const appToken = body.appToken as string | undefined;
    const format = body.format === 'csv' ? 'csv' : 'xlsx';

    if (!appToken) {
      return NextResponse.json({ error: '缺少参数: appToken' }, { status: 400 });
    }

    const { buffer, fileName } = await bitableService.exportBitable(appToken, format);

    const safeName = (fileName || `bitable_export.${format}`).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
    const encoded = encodeURIComponent(safeName);

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES[format],
        'Content-Disposition': `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('[ExportBitable] 导出异常:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导出失败' },
      { status: 500 },
    );
  }
}
