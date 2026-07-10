'use client';

import type { ReactNode } from 'react';
import OAuthLogin from './OAuthLogin';

interface TopBarProps {
  /** 左侧内容：标题、图标或面包屑 */
  children: ReactNode;
  /** 右侧操作区（在账户控件之前），如「新建」按钮 */
  actions?: ReactNode;
  isAuthenticated: boolean;
  isLoading: boolean;
  onFetchApps: () => void;
  onLogout: () => void;
  oauthUrl?: string;
}

/**
 * 各业务页面共用的顶部导航栏。
 * 统一样式（sticky / h-14 / px-6 / 底边框）与右侧飞书账户控件，
 * 左侧内容由各页面自行传入（标题或面包屑）。
 */
export default function TopBar({
  children,
  actions,
  isAuthenticated,
  isLoading,
  onFetchApps,
  onLogout,
  oauthUrl = '',
}: TopBarProps) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between h-14 pl-14 pr-6 lg:pl-6 flex-shrink-0"
      style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
    >
      {children}
      <div className="flex items-center gap-3">
        {actions}
        <OAuthLogin
          isAuthenticated={isAuthenticated}
          oauthUrl={oauthUrl}
          isLoading={isLoading}
          onFetchApps={onFetchApps}
          onLogout={onLogout}
          hideLogin
        />
      </div>
    </header>
  );
}
