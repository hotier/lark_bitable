'use client';

import { useState } from 'react';
import NotFound from '@/app/components/NotFound';
import NotFoundToggle from '@/app/components/NotFoundToggle';

/** 客户端随机选择展示 v1 或 v2 404 页面，避免 SSR 水合不匹配 */
export default function NotFoundRandom() {
  const [version] = useState(() => Math.random() < 0.5 ? 1 : 2);

  if (version === 2) {
    return <NotFoundToggle />;
  }

  return <NotFound showHome />;
}
