'use client';

import { useEffect, useState } from 'react';
import { getFeishuConnection, subscribeFeishuConnection } from '@/lib/api';

/**
 * 订阅「真实飞书连接状态」（取数能力），供前端 badge 显示：
 * - true：飞书 token 可用，数据接口正常
 * - false：飞书 token 已失效（如 refresh_token 过期），需重新授权
 * - null：尚未校验 / 校验中（乐观视为已连接，避免健康用户刷新时闪烁）
 */
export function useFeishuConnection(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(getFeishuConnection());
  useEffect(() => subscribeFeishuConnection(setConnected), []);
  return connected;
}
