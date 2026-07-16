import { feishuService } from '@/services/feishu';
import type { DecryptedPreviewParams } from '@/lib/sign-url';
import { logger } from '@/lib/logger';

/**
 * 代理飞书文件内容，返回浏览器可预览的 Response
 * 调用前调用方应已完成 token 解密与签名校验
 */
export async function proxyFeishuFile(params: DecryptedPreviewParams) {
  const { fileToken, tableId, fieldId, recordId, fileName } = params;

  const tmpUrl = await feishuService.getTmpDownloadUrl(
    fileToken,
    tableId,
    fieldId,
    recordId,
  );

  if (!tmpUrl) {
    logger.warn('[PreviewProxy] 获取飞书临时下载链接失败');
    return Response.json(
      { error: '获取下载链接失败，请确认已授权登录' },
      { status: 500 },
    );
  }

  const fileRes = await fetch(tmpUrl);
  if (!fileRes.ok) {
    logger.warn(`[PreviewProxy] 代理文件失败: HTTP ${fileRes.status}`);
    return Response.json(
      { error: `代理文件失败: ${fileRes.status}` },
      { status: 502 },
    );
  }

  const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
  const contentLength = fileRes.headers.get('content-length');
  const buffer = await fileRes.arrayBuffer();

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    'Cache-Control': 'public, max-age=3600',
  };
  if (contentLength) {
    headers['Content-Length'] = contentLength;
  }

  return new Response(buffer, { status: 200, headers });
}
