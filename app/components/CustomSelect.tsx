'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/** 统一的主选择器外框样式：等宽（w-full + min-w-0）+ 文字溢出省略号（truncate） */
export const SELECT_CLS =
  'w-full min-w-0 truncate rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300';

export interface SelectOption {
  id: string;
  name: string;
}

/**
 * 自定义下拉选择器（替代原生 <select>，确保框 + 展开列表均等宽 + 省略号）。
 * 选中项高亮，弹层带缩放动画，点击外部自动关闭。
 */
export function CustomSelect({
  value,
  onChange,
  options = [],
  placeholder = '请选择',
  disabled = false,
  loading = false,
  disabledOptions = [],
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  disabledOptions?: string[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((o) => o.id === value)?.name || '';

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`${SELECT_CLS} text-left flex items-center justify-between gap-1 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className="truncate flex-1 text-left">{selectedLabel || placeholder}</span>
        {loading ? (
          <svg className="w-3 h-3 animate-spin text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-full max-h-48 overflow-y-auto bg-white rounded-lg border border-neutral-200 shadow-xl z-20 py-1 animate-scale-in origin-top">
            {options.length === 0 && !loading && (
              <div className="text-xs text-neutral-400 px-3 py-2">{placeholder === '请选择' ? '暂无数据' : placeholder}</div>
            )}
            {options.map((opt) => {
              const isDisabled = disabledOptions.includes(opt.id);
              const isSelected = opt.id === value;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => { if (!isDisabled) { onChange(opt.id); setOpen(false); } }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                    isDisabled
                      ? 'text-neutral-300 cursor-not-allowed'
                      : isSelected
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  <span className="truncate block">{opt.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
