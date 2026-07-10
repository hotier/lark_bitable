'use client';

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Workflow } from '@/types';
import { useWorkflowEditorStore } from '@/lib/workflow-engine/editor-store';

type SaveHandler = (wf: Workflow) => Promise<void>;

interface GuardContextValue {
  /** 跳转：若有未保存修改则弹窗确认，否则直接路由 */
  navigate: (href: string) => void;
  /** 注册当前页面的保存实现（供弹窗「保存」调用） */
  registerSaveHandler: (fn: SaveHandler | null) => void;
  /** 注册当前页面的丢弃实现（供弹窗「取消」时恢复未更改状态并离开） */
  registerDiscardHandler: (fn: (() => void) | null) => void;
}

const GuardContext = createContext<GuardContextValue>({
  navigate: () => {},
  registerSaveHandler: () => {},
  registerDiscardHandler: () => {},
});

export const useNavigationGuard = () => useContext(GuardContext);

/** 受保护的链接：点击时若工作流有未保存修改则弹窗确认，否则正常路由 */
export function GuardedLink({
  href, children, className, style, title, onClick,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const { navigate } = useNavigationGuard();
  return (
    <Link
      href={href}
      className={className}
      style={style}
      title={title}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        // 允许中键 / 组合键在新标签打开
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </Link>
  );
}

export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isDirty = useWorkflowEditorStore((s) => s.isDirty);
  const markSaved = useWorkflowEditorStore((s) => s.markSaved);
  const saveHandlerRef = useRef<SaveHandler | null>(null);
  const discardHandlerRef = useRef<(() => void) | null>(null);

  // 浏览器关闭 / 刷新时提示（原生对话框）
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const navigate = useCallback((href: string) => {
    if (isDirty) setPendingHref(href);
    else router.push(href);
  }, [isDirty, router]);

  const registerSaveHandler = useCallback((fn: SaveHandler | null) => {
    saveHandlerRef.current = fn;
  }, []);

  const registerDiscardHandler = useCallback((fn: (() => void) | null) => {
    discardHandlerRef.current = fn;
  }, []);

  const handleSaveAndLeave = async () => {
    setSaving(true);
    try {
      const wf = useWorkflowEditorStore.getState().getWorkflow();
      if (saveHandlerRef.current) await saveHandlerRef.current(wf);
      markSaved();
      const target = pendingHref;
      setPendingHref(null);
      if (target) router.push(target);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    // 取消：恢复为未更改的状态（从存储.reload），并离开当前编辑页
    if (discardHandlerRef.current) discardHandlerRef.current();
    const target = pendingHref;
    setPendingHref(null);
    if (target) router.push(target);
  };

  return (
    <GuardContext.Provider value={{ navigate, registerSaveHandler, registerDiscardHandler }}>
      {children}

      {pendingHref !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm dark:bg-black/60">
          <div className="w-[360px] max-w-[90vw] rounded-xl bg-white shadow-2xl p-5 dark:bg-neutral-900">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">未保存的更改</h3>
            <p className="mt-2 text-xs text-neutral-500 leading-relaxed dark:text-neutral-400">
              你有尚未保存的修改，离开后这些修改将会丢失。是否先保存再离开？
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-xs rounded-lg text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/15"
              >
                取消
              </button>
              <button
                onClick={handleSaveAndLeave}
                disabled={saving}
                className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white transition-colors hover:[background-image:linear-gradient(rgba(0,0,0,0.12),rgba(0,0,0,0.12))] disabled:opacity-50 dark:bg-blue-500 dark:hover:[background-image:linear-gradient(rgba(0,0,0,0.18),rgba(0,0,0,0.18))] flex items-center gap-1.5"
              >
                {saving && (
                  <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin dark:border-neutral-400 dark:border-t-neutral-700" />
                )}
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </GuardContext.Provider>
  );
}
