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
    containerBg: 'bg-red-100',
    icon: ShieldAlert,
    iconColor: 'text-red-500',
    confirmBg: 'bg-red-500 hover:bg-red-600',
    confirmShadow: 'shadow-sm shadow-red-500/20',
  },
  warning: {
    containerBg: 'bg-amber-100',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    confirmBg: 'bg-amber-500 hover:bg-amber-600',
    confirmShadow: 'shadow-sm shadow-amber-500/20',
  },
  info: {
    containerBg: 'bg-blue-100',
    icon: Info,
    iconColor: 'text-blue-500',
    confirmBg: 'bg-blue-500 hover:bg-blue-600',
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
        className="fixed inset-0 bg-black/40 z-50 animate-fade-in"
        onClick={onCancel}
      />

      {/* 弹窗 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-[420px] p-6 animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 图标 + 标题 + 内容 */}
          <div className="flex items-start gap-4">
            <div className={`w-11 h-11 rounded-xl ${cfg.containerBg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-5.5 h-5.5 ${cfg.iconColor}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-neutral-800">{title}</h3>
              <div className="text-sm text-neutral-500 mt-1.5 leading-relaxed">
                {message}
              </div>
            </div>
          </div>

          {/* 按钮 */}
          <div className="flex gap-3 justify-end mt-6 pt-5 border-t border-neutral-100">
            <button
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2.5 text-sm font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 rounded-xl transition-colors disabled:opacity-50"
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
