'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Table2, Workflow, FileText, Grid3X3, Sparkles, Menu, X } from 'lucide-react';
import { GuardedLink } from '@/app/components/NavigationGuard';
import ThemeToggle from '@/app/components/ThemeToggle';

const NAV_ITEMS = [
  {
    href: '/bitable',
    label: '多维表格',
    icon: Table2,
    match: (path: string) => path.startsWith('/bitable'),
  },
  {
    href: '/docs',
    label: '云文档',
    icon: FileText,
    match: (path: string) => path.startsWith('/docs'),
  },
  {
    href: '/sheets',
    label: '在线表格',
    icon: Grid3X3,
    match: (path: string) => path.startsWith('/sheets'),
  },
  {
    href: '/flow',
    label: '工作流',
    icon: Workflow,
    match: (path: string) => path.startsWith('/flow'),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // 抽屉打开时锁定背景滚动，关闭后恢复
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <>
      {/* 移动端菜单按钮：仅小屏（<lg）显示，固定在左上角，打开抽屉 */}
      <button
        type="button"
        aria-label="打开导航菜单"
        onClick={() => setOpen(true)}
        className={`fixed top-3 left-3 z-50 flex items-center justify-center w-10 h-10 rounded-lg lg:hidden ${
          open ? 'hidden' : 'flex'
        }`}
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* 抽屉打开时的遮罩层，点击关闭 */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 flex flex-col transition-transform duration-200 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
        style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}
      >
        {/* Logo — 与首页保持一致的品牌标识，点击返回首页；小屏提供关闭按钮 */}
        <div
          className="relative flex items-center h-14"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <GuardedLink
            href="/"
            className="flex items-center gap-3 px-5 hover:opacity-80 transition-opacity flex-1"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center flex-shrink-0 shadow shadow-amber-500/25">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-neutral-900 tracking-tight">飞书工作台</span>
              <span className="text-[10px] text-neutral-300 tracking-wider">WORKSPACE</span>
            </div>
          </GuardedLink>
          <button
            type="button"
            aria-label="关闭菜单"
            onClick={() => setOpen(false)}
            className="absolute right-3 flex items-center justify-center w-8 h-8 rounded-md lg:hidden hover:bg-black/5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = item.match(pathname);
            return (
              <GuardedLink
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                style={{
                  color: isActive ? 'var(--text)' : 'var(--text-tertiary)',
                  background: isActive ? 'var(--surface)' : 'transparent',
                  boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
                }}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </GuardedLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
          <GuardedLink
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 text-xs font-medium text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回首页
          </GuardedLink>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
