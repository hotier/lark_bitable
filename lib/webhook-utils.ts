/**
 * Webhook 请求解析相关的纯函数工具集（与框架/运行时无关，便于单元测试）。
 *
 * 这些函数原先内联在 API 路由中，抽离出来后既可复用，也能被 Vitest 直接覆盖。
 */

/** 递归扁平化对象 key：{a:{b:1}, c:2} → ["a.b","c"] */
export function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const record = obj as Record<string, unknown>;
  const keys: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/** 按点号路径从嵌套对象取值 */
export function getNestedValue(obj: Record<string, unknown>, dottedKey: string): unknown {
  const parts = dottedKey.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 序列化时裁剪超长字符串（避免 base64 图片撑爆日志） */
export function safeStringify(obj: unknown, max = 120): string {
  try {
    return JSON.stringify(obj, (_k, v) =>
      typeof v === 'string' && v.length > max ? `${v.slice(0, max)}…(${v.length}字节)` : v,
    );
  } catch {
    return String(obj);
  }
}

/** 手动解析 multipart/form-data 的单个部件类型 */
export type ManualPart = string | { __file: true; mime: string; data: Buffer };

/**
 * 手动解析 multipart/form-data，作为 request.formData() 的兜底。
 * 兼容 iOS 等非常规格式：缺结尾 '--'、换行符为 \n 而非 \r\n 等。
 * 返回 [字段名, 值]，值类型为 string（文本）或 {__file,mime,data}（文件）。
 */
export function parseMultipartManual(buf: Buffer, ct: string): [string, ManualPart][] {
  const bm = /boundary=("?)([^";]+)\1/i.exec(ct);
  if (!bm) return [];
  const boundary = bm[2];
  const delim = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = buf.indexOf(delim);
  if (start === -1) return [];
  start += delim.length;
  while (start < buf.length) {
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    let end = buf.indexOf(delim, start);
    if (end === -1) end = buf.length;
    // 结尾边界（--boundary--）则停止
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    const part = buf.slice(start, end);
    let pEnd = part.length;
    if (part[pEnd - 1] === 0x0a) pEnd--;
    if (part[pEnd - 1] === 0x0d) pEnd--;
    if (pEnd > 0) parts.push(part.slice(0, pEnd));
    start = end + delim.length;
  }
  const result: [string, ManualPart][] = [];
  for (const part of parts) {
    const sep1 = part.indexOf('\r\n\r\n');
    let headerEnd: number;
    let bodyStart: number;
    if (sep1 !== -1) {
      headerEnd = sep1;
      bodyStart = sep1 + 4;
    } else {
      const sep2 = part.indexOf('\n\n');
      if (sep2 === -1) continue;
      headerEnd = sep2;
      bodyStart = sep2 + 2;
    }
    const headerStr = part.slice(0, headerEnd).toString('latin1');
    const body = part.slice(bodyStart);
    const nameM = /name="([^"]*)"/i.exec(headerStr);
    const fileM = /filename="([^"]*)"/i.exec(headerStr);
    const typeM = /content-type:\s*([^\r\n]+)/i.exec(headerStr);
    const name = nameM ? nameM[1] : '';
    if (fileM) {
      const mime = typeM ? typeM[1].trim() : 'application/octet-stream';
      result.push([name, { __file: true, mime, data: body }]);
    } else {
      result.push([name, body.toString('utf8')]);
    }
  }
  return result;
}

/**
 * 递归去除可能导致原型链污染的危险 key（__proto__ / constructor / prototype）。
 * 返回深拷贝后的安全对象；非对象原样返回。
 */
export function sanitizeAgainstPrototypePollution<T>(input: T): T {
  if (!input || typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.map((v) => sanitizeAgainstPrototypePollution(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = sanitizeAgainstPrototypePollution(v);
  }
  return out as T;
}
