import { NextRequest, NextResponse } from 'next/server';
import { feishuService } from '@/services/feishu';
import { logger } from '@/lib/logger';
import { TOKEN_COOKIE, EXPIRE_COOKIE } from '@/lib/auth-constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONTENT_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

export async function POST(request: NextRequest) {
  try {
    // 会话有效性
    const cookieToken = request.cookies.get(TOKEN_COOKIE)?.value || null;
    const expireStr = request.cookies.get(EXPIRE_COOKIE)?.value || '0';
    const sessionValid = cookieToken !== null && Date.now() < (parseInt(expireStr) || 0);
    if (!sessionValid) {
      return NextResponse.json(
        { error: '未登录或会话已过期', needLogin: true },
        { status: 401 },
      );
    }

    // drive 导出必须以用户身份执行
    const authed = await feishuService.ensureAuth();
    if (!authed) {
      return NextResponse.json(
        { error: '登录已失效，请重新授权', needLogin: true },
        { status: 401 },
      );
    }

    const body = await request.json();
    const appToken = body.appToken as string | undefined;
    const format = body.format === 'csv' ? 'csv' : 'xlsx';
    const tableId = body.tableId as string | undefined;
    const tableName = body.tableName as string | undefined;

    if (!appToken) {
      return NextResponse.json({ error: '缺少参数: appToken' }, { status: 400 });
    }

    const result = await feishuService.exportBitableNative(appToken, format, tableId, tableName);

    const encoded = encodeURIComponent(result.fileName);
    return new NextResponse(result.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES[format],
        'Content-Disposition': `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    logger.error('[ExportBitableNative] 导出异常:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '飞书原生导出失败' },
      { status: 500 },
    );
  }
}
