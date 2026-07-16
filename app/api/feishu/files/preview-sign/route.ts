import { NextResponse } from 'next/server';
import { signPreviewUrl } from '@/lib/sign-url';
import { logger } from '@/lib/logger';

/**
 * POST /api/feishu/files/preview-sign
 * 为附件生成带有效期签名的预览 URL
 *
 * Body:
 * {
 *   tableId?: string,
 *   fieldId?: string,
 *   recordId?: string,
 *   files: [{ fileToken: string, fileName?: string }],
 *   durationSeconds?: number  // 可选，默认 6 小时
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.files) || body.files.length === 0) {
      return NextResponse.json({ error: '缺少参数: files' }, { status: 400 });
    }

    const { tableId, fieldId, recordId, files, durationSeconds } = body as {
      tableId?: string;
      fieldId?: string;
      recordId?: string;
      files: { fileToken: string; fileName?: string }[];
      durationSeconds?: number;
    };

    const results = files.map((f) => {
      const signed = signPreviewUrl({
        fileToken: f.fileToken,
        tableId,
        fieldId,
        recordId,
        fileName: f.fileName,
        durationSeconds,
      });
      return {
        fileToken: f.fileToken,
        url: signed.url,
        expiresAt: signed.expiresAt,
      };
    });

    return NextResponse.json({ urls: results });
  } catch (error) {
    logger.error('[PreviewSign] 生成签名链接失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '生成失败' },
      { status: 500 },
    );
  }
}
