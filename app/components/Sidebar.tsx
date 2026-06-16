'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Table2, Workflow, FileText, Grid3X3, Sparkles } from 'lucide-react';

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
    label: '机器人指令',
    icon: Workflow,
    match: (path: string) => path.startsWith('/flow'),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 flex flex-col"
      style={{ width: 'var(--sidebar-width)', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}
    >
      {/* Logo — 与首页保持一致的品牌标识，点击返回首页 */}
      <Link
        href="/"
        className="flex items-center gap-3 h-14 px-5 hover:opacity-80 transition-opacity"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center flex-shrink-0 shadow shadow-amber-500/25">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-neutral-900 tracking-tight">飞书工作台</span>
          <span className="text-[10px] text-neutral-300 tracking-wider">WORKSPACE</span>
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
              style={{
                color: isActive ? 'var(--text)' : 'var(--text-tertiary)',
                background: isActive ? 'var(--surface)' : 'transparent',
                boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
              }}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
        <Link
          href="/"
          className="flex items-center gap-2 text-xs font-medium text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回首页
        </Link>
      </div>
    </aside>
  );
}
