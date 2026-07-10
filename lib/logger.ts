/**
 * 结构化日志工具
 *
 * 设计原则：
 * - debug / info 仅在非生产环境输出，避免生产环境泄露 webhook 请求体等敏感数据。
 * - warn / error 始终输出（含生产），便于线上排障，但调用方不应传入敏感载荷。
 * - 统一前缀，便于日志检索。
 */

const isProd = process.env.NODE_ENV === 'production';

function fmt(prefix: string, args: unknown[]): unknown[] {
  return [`%c${prefix}`, ...args];
}

export const logger = {
  /** 调试细节（含请求体解析等），仅非生产环境输出 */
  debug: (...args: unknown[]): void => {
    if (isProd) return;
    console.debug(...fmt('[debug]', args));
  },
  /** 一般信息，仅非生产环境输出 */
  info: (...args: unknown[]): void => {
    if (isProd) return;
    console.info(...fmt('[info]', args));
  },
  /** 警告，始终输出 */
  warn: (...args: unknown[]): void => {
    console.warn(...fmt('[warn]', args));
  },
  /** 错误，始终输出 */
  error: (...args: unknown[]): void => {
    console.error(...fmt('[error]', args));
  },
};
