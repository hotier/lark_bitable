'use client';

import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

type Theme = 'system' | 'light' | 'dark';

function getStoredTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    if (t === 'dark') return 'dark';
    if (t === 'light') return 'light';
  } catch {
    /* 忽略 */
  }
  return 'system';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && preferDark);
  root.classList.toggle('dark', isDark);
  try {
    if (theme === 'system') {
      localStorage.removeItem('theme');
    } else {
      localStorage.setItem('theme', theme);
    }
  } catch {
    /* 忽略 */
  }
}

const cycle: Theme[] = ['system', 'light', 'dark'];

const icons: Record<Theme, { Icon: typeof Sun; label: string }> = {
  system: { Icon: Monitor, label: '跟随系统' },
  light: { Icon: Sun, label: '浅色模式' },
  dark: { Icon: Moon, label: '暗色模式' },
};

/**
 * 深浅色模式切换按钮（三态：跟随系统 → 浅色 → 暗色）。
 * 首屏防闪烁脚本见 app/layout.tsx。
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [pending, setPending] = useState(false);

  // 客户端挂载后读取 localStorage 中的真实状态
  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  // 监听系统主题变更：仅在「跟随系统」模式下自动响应
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (getStoredTheme() === 'system') {
        applyTheme('system');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (pending) return;
    setPending(true);
    const idx = cycle.indexOf(theme);
    const next = cycle[(idx + 1) % cycle.length];
    setTheme(next);

    const apply = () => applyTheme(next);
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(apply).finished.then(() => setPending(false));
    } else {
      document.documentElement.classList.add('theme-transition');
      apply();
      window.setTimeout(() => {
        document.documentElement.classList.remove('theme-transition');
        setPending(false);
      }, 450);
    }
  }, [pending, theme]);

  const { Icon, label } = icons[theme];

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`当前：${label}，点击切换`}
      title={`当前：${label}`}
      className="flex items-center justify-center w-8 h-8 rounded-md transition-colors hover:bg-[var(--surface-hover)]"
      style={{ color: 'var(--text-tertiary)' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
