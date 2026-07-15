'use client';

import { useState } from 'react';
import { LogOut, AlertTriangle } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import { useFeishuConnection } from '@/lib/useFeishuConnection';

interface OAuthLoginProps {
  isAuthenticated: boolean;
  oauthUrl: string;
  isLoading: boolean;
  onFetchApps: () => void;
  onLogout: () => void;
  hideLogin?: boolean;
}

export default function OAuthLogin({
  isAuthenticated, oauthUrl, isLoading, onFetchApps, onLogout, hideLogin = false,
}: OAuthLoginProps) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  // 真实飞书连接状态（取数能力），由 authStatus 校验结果驱动
  const feishuConnected = useFeishuConnection();

  if (!isAuthenticated && hideLogin) return null;

  if (!isAuthenticated) {
    return (
      <a
        href={oauthUrl}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
        style={{ background: 'var(--accent)', boxShadow: '0 4px 24px -6px rgba(191,91,10,0.25)' }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
        飞书授权登录
      </a>
    );
  }

  // 飞书连接已失效（会话还在，但飞书 token 无法恢复，如 refresh_token 过期）
  // → 显示告警态，点击重新授权。
  if (feishuConnected === false) {
    return (
      <div className="flex items-center gap-4">
        <a
          href={oauthUrl}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50/80 border border-amber-200/60 transition-all duration-200 hover:bg-amber-100/80"
          title="飞书连接已失效，点击重新授权"
        >
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-xs font-semibold text-amber-700">飞书连接已失效 · 重新授权</span>
        </a>

        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200"
        >
          <LogOut className="w-3 h-3" />
          退出登录
        </button>

        <ConfirmDialog
          open={showLogoutConfirm}
          title="退出登录"
          message="确定要退出登录吗？退出后需要重新授权才能访问飞书数据。"
          confirmLabel="退出登录"
          cancelLabel="取消"
          variant="danger"
          onConfirm={async () => {
            await onLogout();
            setShowLogoutConfirm(false);
          }}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={onFetchApps} disabled={isLoading}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50/80 border border-emerald-200/50 transition-all duration-200 disabled:cursor-not-allowed hover:bg-emerald-100/80"
        title="点击同步飞书数据"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: isLoading ? '#9ca3af' : '#34d399' }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: isLoading ? '#9ca3af' : '#10b981' }} />
        </span>
        <span className="text-xs font-semibold text-emerald-700">
          {isLoading ? '同步中...' : '已连接飞书'}
        </span>
      </button>

      <button
        onClick={() => setShowLogoutConfirm(true)}
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200"
      >
        <LogOut className="w-3 h-3" />
        退出登录
      </button>

      <ConfirmDialog
        open={showLogoutConfirm}
        title="退出登录"
        message="确定要退出登录吗？退出后需要重新授权才能访问飞书数据。"
        confirmLabel="退出登录"
        cancelLabel="取消"
        variant="danger"
        onConfirm={async () => {
          await onLogout();
          setShowLogoutConfirm(false);
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
}
