'use client';

import { useEffect, useRef, useState } from 'react';
import LoadingScreen from './LoadingScreen';
import { checkAuthStatus, invalidateAuthCache, POST_LOGIN_REDIRECT_KEY } from '@/lib/api';

// 首屏加载动画最短展示时长，避免校验过快时 LoadingScreen 一闪而过
const MIN_DURATION = 600;

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const start = Date.now();
    checkAuthStatus()
      .then((valid) => {
        if (!valid) {
          invalidateAuthCache();
          // 记录当前访问路径，登录成功后回跳到该页面
          try {
            sessionStorage.setItem(
              POST_LOGIN_REDIRECT_KEY,
              window.location.pathname + window.location.search + window.location.hash,
            );
          } catch { /* sessionStorage 不可用时忽略 */ }
          window.location.replace('/');
          return;
        }
        // 已登录：回跳目标已通过 OAuth 回调消费，清除避免残留过期路径
        try { sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY); } catch { /* 忽略 */ }
        const elapsed = Date.now() - start;
        // 仅当本次是「真实网络校验」（耗时较长）时才保底最短展示；
        // 命中会话内缓存（瞬时返回）则直接放行，避免与 RouteTransition 的
        // 600ms 叠加，造成首页 ↔ 子页面切换时明显的双重延迟。
        const artificial = elapsed < 60 ? 0 : Math.max(0, MIN_DURATION - elapsed);
        setTimeout(() => setReady(true), artificial);
      });
  }, []);

  if (!ready) {
    // 直接刷新/首次进入时显示全屏加载动画，与站内跳转（RouteTransition）视觉统一
    return <LoadingScreen label="Lark Workspace" accent="amber" fullScreen />;
  }

  return <>{children}</>;
}
