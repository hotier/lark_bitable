'use client';

import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  /** 弹窗标题 */
  title?: string;
  /** 提示内容，支持 ReactNode */
  message: ReactNode;
  /** 确认按钮文字 */
  confirmLabel?: string;
  /** 取消按钮文字 */
  cancelLabel?: string;
  /** 风格变体 */
  variant?: 'danger' | 'warning' | 'info';
  /** 确认按钮 loading 状态 */
  loading?: boolean;
  /** 确认回调 */
  onConfirm: () => void;
  /** 取消/关闭回调 */
  onCancel: () => void;
}

const variantConfig = {
  danger: {
    containerBg: 'bg-red-100 dark:bg-red-500/15',
    icon: ShieldAlert,
    iconColor: 'text-red-500 dark:text-red-400',
    confirmBg: 'bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500',
    confirmShadow: 'shadow-sm shadow-red-500/20',
  },
  warning: {
    containerBg: 'bg-amber-100 dark:bg-amber-500/15',
    icon: AlertTriangle,
    iconColor: 'text-amber-500 dark:text-amber-400',
    confirmBg: 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500',
    confirmShadow: 'shadow-sm shadow-amber-500/20',
  },
  info: {
    containerBg: 'bg-blue-100 dark:bg-blue-500/15',
    icon: Info,
    iconColor: 'text-blue-500 dark:text-blue-400',
    confirmBg: 'bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500',
    confirmShadow: 'shadow-sm shadow-blue-500/20',
  },
};

export default function ConfirmDialog({
  open,
  title = '确认操作',
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  const cfg = variantConfig[variant];
  const Icon = cfg.icon;

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50 animate-fade-in"
        onClick={onCancel}
      />

      {/* 弹窗 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-full max-w-[420px] p-6 animate-scale-in ring-1 ring-black/5 dark:ring-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 图标 + 标题 + 内容 */}
          <div className="flex items-start gap-4">
            <div className={`w-11 h-11 rounded-xl ${cfg.containerBg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-5.5 h-5.5 ${cfg.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-neutral-800 dark:text-neutral-100">{title}</h3>
              <div className="text-sm text-neutral-500 mt-1.5 leading-relaxed dark:text-neutral-400 [&_span]:dark:text-neutral-100">
                {message}
              </div>
            </div>
          </div>

          {/* 按钮 */}
          <div className="flex gap-3 justify-end mt-6 pt-5 border-t border-neutral-100 dark:border-neutral-800">
            <button
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2.5 text-sm font-medium text-red-600 border border-red-200 rounded-xl transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/15"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className={`px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-all ${cfg.confirmBg} ${cfg.confirmShadow} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {loading ? '处理中...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
