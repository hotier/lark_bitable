'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

function getSnapshot() {
  return document.documentElement.classList.contains('dark');
}

function getServerSnapshot() {
  return false;
}

/**
 * 暗色模式切换按钮。
 * 主题状态由 <html class="dark"> 与 localStorage('theme') 维护，
 * 首屏防闪烁脚本见 app/layout.tsx。
 * 用 useSyncExternalStore 读取主题，避免在 effect 中同步 setState（并规避 hydration 不一致）。
 */
export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* localStorage 不可用时忽略 */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? '切换到浅色模式' : '切换到暗色模式'}
      title={dark ? '切换到浅色模式' : '切换到暗色模式'}
      className="flex items-center justify-center w-8 h-8 rounded-md transition-colors hover:bg-[var(--surface-hover)]"
      style={{ color: 'var(--text-tertiary)' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
