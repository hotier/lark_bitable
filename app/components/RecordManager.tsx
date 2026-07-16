'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Type, Hash, Calendar, CircleDot, CheckSquare, Check, User, Phone, Mail, Link, Paperclip, Sigma, Search, Clock, UserPlus, History, Download, Loader2 } from 'lucide-react';
import type { Field, FieldType, FeishuRecord } from '@/types';
import { exportBitable, exportBitableNative } from '@/lib/api';
import { formatFieldValue } from '@/lib/field-format';
import ConfirmDialog from '@/app/components/ConfirmDialog';

const TYPE_ICONS: Record<FieldType, React.ComponentType<{ className?: string }>> = {
  text: Type, number: Hash, date: Calendar, single_select: CircleDot,
  multi_select: CheckSquare, checkbox: Check, person: User, phone: Phone,
  email: Mail, url: Link, file: Paperclip, formula: Sigma, lookup: Search,
  created_time: Clock, created_by: UserPlus, updated_time: History, updated_by: User,
};

interface RecordManagerProps {
  appToken: string;
  tableId: string;
  appName: string;
  tableName: string;
  fields: Field[];
  records: FeishuRecord[];
  isLoading: boolean;
  onSwitchToTables: () => void;
  onDeleteRecord: (recordId: string) => Promise<void>;
  /** 是否正在后台静默预热全量记录（展示加载进度动画） */
  warming?: boolean;
  /** 已加载到本地的记录数（配合 total 显示预热进度） */
  loadedCount?: number;
  // 翻页
  currentPage: number;
  total: number;
  pageSize: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  onGoToPage: (page: number) => void;
  // 服务端排序：当前排序列与方向，以及点击表头触发回调
  sortFieldId: string | null;
  sortOrder: 'asc' | 'desc';
  onSort: (fieldId: string) => void;
  /** 可选：仅展示这些字段列（不传则展示全部 fields） */
  displayFields?: Field[];
  /** 导出成功/失败时触发 toast 回调（飞书官方导出使用） */
  onExportToast?: (type: 'success' | 'error', text: string) => void;
}

/** 未选择表时的空状态 */
function NoTableSelected({ onSwitchToTables }: { onSwitchToTables: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-24 h-24 rounded-lg bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center mb-6 shadow-inner">
        <svg className="w-12 h-12 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-neutral-700 mb-2">请先选择数据表</h3>
      <p className="text-sm text-neutral-400 mb-6">在「数据表管理」中选择一个数据表</p>
      <button
        onClick={onSwitchToTables}
        className="px-5 py-2.5 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-all duration-300 font-semibold text-sm shadow-sm"
      >
        选择数据表
      </button>
    </div>
  );
}

/** 无字段时的空状态 */
function NoFields() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-20 h-20 rounded-lg bg-gradient-to-br from-neutral-100 to-neutral-200 flex items-center justify-center mb-5 shadow-inner">
        <svg className="w-10 h-10 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-neutral-700 mb-1">暂无字段</h3>
      <p className="text-sm text-neutral-400">该数据表未定义任何字段</p>
    </div>
  );
}

/** 从记录中安全获取字段值 — 兼容 field_id 和字段名称两种 key 格式 */
export function getRecordFieldValue(record: FeishuRecord, field: Field): unknown {
  if (!record?.fields) return undefined;
  // 优先 field_id（SDK 使用 field_name_type:'field_id'），回退 field name
  if (field.field_id in record.fields) return record.fields[field.field_id];
  if (field.name in record.fields) return record.fields[field.name];
  return undefined;
}

/** 渲染记录的字段值（薄封装，格式规则见共享模块 @/lib/field-format）。
 * 前端空值展示「—」，与导出（空串）的唯一差异通过 emptyText 参数吸收。
 * @param optionMap 选项 id → 显示文字 的全局映射，用于把公式/单选返回的 optxxx 还原为文字。
 */
function renderFieldValue(value: unknown, fieldType: FieldType, optionMap?: Record<string, string>): string {
  return formatFieldValue(value, fieldType, { optionMap, emptyText: '—' });
}

type FeishuAttachment = { file_token?: string; token?: string; name?: string; type?: string; size?: number };

/** 兼容飞书附件字段两种键名：记录字段多为 token，drive 接口用 file_token */
function getFileToken(f: FeishuAttachment): string | undefined {
  return f.file_token || f.token;
}

/** 附件单元格：通过签名 API 获取带有效期的预览链接 */
function AttachmentsCell({
  value,
  tableId,
  fieldId,
  recordId,
}: {
  value: unknown;
  tableId: string;
  fieldId: string;
  recordId: string;
}) {
  // fileToken → signed URL 的映射缓存
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  // 已预取的链接 key，避免 hover 重复预取
  const prefetchedRef = useRef<Set<string>>(new Set());

  const prefetch = (url: string, key: string) => {
    if (prefetchedRef.current.has(key)) return;
    prefetchedRef.current.add(key);
    fetch(url, { cache: 'force-cache' }).catch(() => {});
  };

  useEffect(() => {
    if (!Array.isArray(value) || value.length === 0) return;

    const files = (value as FeishuAttachment[]).filter((f) => getFileToken(f));
    if (files.length === 0) return;

    let cancelled = false;

    fetch('/api/feishu/files/preview-sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableId,
        fieldId,
        recordId,
        files: files.map((f) => ({
          fileToken: getFileToken(f)!,
          fileName: f.name,
        })),
      }),
    })
      .then((res) => res.json())
      .then((data: { urls?: { fileToken: string; url: string }[] }) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        (data.urls || []).forEach((u) => {
          map[u.fileToken] = u.url;
        });
        setUrlMap(map);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true); // 失败也标记为已加载，回退到不可点击状态
      });

    return () => { cancelled = true; };
  }, [tableId, fieldId, recordId, JSON.stringify(value)]);

  if (!Array.isArray(value) || value.length === 0) return <span className="text-neutral-300">—</span>;

  const files = value as FeishuAttachment[];

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      {files.map((file, i) => {
        const ft = getFileToken(file);
        const name = file.name || ft || '?';
        const previewUrl = ft ? urlMap[ft] : null;

        return (
          <a
            key={ft || `__idx_${i}`}
            href={previewUrl || '#'}
            target={previewUrl ? '_blank' : undefined}
            rel="noopener noreferrer"
            onMouseEnter={() => { if (previewUrl) prefetch(previewUrl, ft || `i_${i}`); }}
            className={`inline-flex items-center gap-1 text-xs truncate max-w-full ${
              previewUrl
                ? 'text-blue-600 hover:text-blue-800 hover:underline'
                : loaded && ft
                  ? 'text-neutral-400 cursor-not-allowed'
                  : 'text-neutral-400'
            }`}
            title={loaded || !ft ? name : `${name}（加载中…）`}
          >
            <Paperclip className="w-3 h-3 shrink-0" />
            <span className="truncate">{name}</span>
          </a>
        );
      })}
    </div>
  );
}

export default function RecordManager({
  appToken,
  tableId: _tableId,
  appName,
  tableName,
  fields,
  records,
  isLoading,
  onSwitchToTables,
  onDeleteRecord,
  warming = false,
  loadedCount = 0,
  currentPage,
  total,
  pageSize,
  onNextPage,
  onPrevPage,
  onGoToPage,
  onSort,
  sortFieldId,
  sortOrder,
  displayFields,
  onExportToast,
}: RecordManagerProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [showExportPicker, setShowExportPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // 点击弹窗外关闭
  useEffect(() => {
    if (!showExportPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowExportPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportPicker]);

  // 放大（全屏）模式下按 Esc 退出
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // 表格展示使用的字段列
  const tableColumns = displayFields ?? fields;

  // 所有单选/多选字段的选项 id → 显示文字 映射，用于把公式/单选返回的 optxxx 还原为可读文字
  const optionTextById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of fields) {
      for (const o of f.options || []) {
        if (o.id) map[o.id] = o.text;
      }
    }
    return map;
  }, [fields]);

  if (!appToken || !_tableId) {
    return <NoTableSelected onSwitchToTables={onSwitchToTables} />;
  }

  if (fields.length === 0) {
    return <NoFields />;
  }

  return (
    <div className={`flex flex-col min-h-0 h-full ${expanded ? 'fixed inset-0 z-50 bg-white p-4 md:p-6 shadow-2xl' : ''}`}>
      {/* 头部操作栏 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-neutral-800">记录管理</h2>
            <p className="text-xs text-neutral-400">
              {warming ? (
                <span className="inline-flex items-center gap-1 text-amber-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  正在加载全部记录 {loadedCount}{total > 0 ? ` / ${total}` : ''} 条…
                </span>
              ) : (
                `${total} 条记录`
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* 导出按钮 + 选项弹窗 */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setShowExportPicker((v) => !v)}
              title="导出数据"
              className="p-2 text-neutral-500 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
            </button>

            {showExportPicker && (
              <div className="absolute right-0 top-full mt-1 w-auto bg-white rounded-lg shadow-lg border border-neutral-200 z-50 overflow-hidden">
                <p className="text-xs text-neutral-400 px-4 pt-3 pb-1.5 font-medium">选择导出方式</p>
                <div className="p-1.5 space-y-0.5">
                  {/* 飞书官方导出 */}
                  <button
                    onClick={async () => {
                      setShowExportPicker(false);
                      if (exporting || !appToken || !_tableId) return;
                      setExporting(true);
                      try {
                        await exportBitableNative(appToken, 'xlsx', _tableId, tableName);
                        onExportToast?.('success', '导出成功');
                      } catch (err) {
                        onExportToast?.('error', `导出失败：${err instanceof Error ? err.message : '未知错误'}`);
                      } finally {
                        setExporting(false);
                      }
                    }}
                    disabled={exporting}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-amber-50 transition-colors disabled:opacity-50 group"
                  >
                    <div className="flex items-center gap-2.5">
                      <Download className="w-4 h-4 text-amber-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-700 group-hover:text-amber-700 whitespace-nowrap">飞书官方</p>
                      </div>
                    </div>
                  </button>

                  {/* 自建导出 */}
                  <button
                    onClick={async () => {
                      setShowExportPicker(false);
                      if (exporting || !appToken || !_tableId) return;
                      setExporting(true);
                      setExportMsg(null);
                      try {
                        await exportBitable(appToken, 'xlsx', _tableId, appName, tableName);
                      } catch (err) {
                        setExportMsg({ type: 'error', text: `导出失败：${err instanceof Error ? err.message : '未知错误'}` });
                        setTimeout(() => setExportMsg(null), 5000);
                      } finally {
                        setExporting(false);
                      }
                    }}
                    disabled={exporting}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-blue-50 transition-colors disabled:opacity-50 group"
                  >
                    <div className="flex items-center gap-2.5">
                      <Download className="w-4 h-4 text-blue-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-700 group-hover:text-blue-700 whitespace-nowrap">站内解析</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>

          {exportMsg && (
            <span className={`text-xs ${exportMsg.type === 'error' ? 'text-red-500' : 'text-emerald-600'}`}>
              {exportMsg.text}
            </span>
          )}

          {/* 放大 / 关闭表格 */}
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? '关闭' : '放大表格'}
            className="p-2 text-neutral-500 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors"
          >
            {expanded ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* 后台静默预热全量记录时的进度动画 */}
      {warming && (
        <div className="progress-track h-1 w-full rounded-full mb-4" role="progressbar" aria-label="正在加载全部记录">
          <div className="progress-bar" />
        </div>
      )}

      {/* 表格 —— 滑动条内联在表体内 */}
      {records.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col rounded-md border border-neutral-100 overflow-auto theme-no-transition">
          {/* 表头 */}
          <div className="flex items-center gap-3 px-4 py-3 bg-neutral-100 text-xs font-semibold text-neutral-400 uppercase tracking-wider min-w-max sticky top-0 z-10 flex-shrink-0"
            style={{ minWidth: `${48 + tableColumns.length * 120 + 80 + (tableColumns.length + 2) * 12}px` }}>
            <span className="w-8 shrink-0 text-left">#</span>
            {tableColumns.map((f) => {
              const active = sortFieldId === f.field_id;
              return (
                <button
                  key={f.field_id}
                  type="button"
                  onClick={() => onSort(f.field_id)}
                  title={`按「${f.name}」排序`}
                  className={`w-[120px] shrink-0 flex items-center gap-1 text-left hover:text-neutral-600 transition-colors ${active ? 'text-neutral-700' : ''}`}
                >
                  <span className="inline-flex items-center gap-1 truncate">
                    {(() => { const Icon = TYPE_ICONS[f.type]; return Icon ? <Icon className="w-3 h-3" /> : <span>?</span>; })()}
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="ml-auto text-[10px] leading-none">
                    {active ? (sortOrder === 'asc' ? '▲' : '▼') : <span className="opacity-30">↕</span>}
                  </span>
                </button>
              );
            })}
            <span className="w-20 shrink-0 text-right">操作</span>
          </div>

          {/* 表体 */}
          <div className="divide-y divide-neutral-50 min-w-max"
              style={{ minWidth: `${48 + tableColumns.length * 120 + 80 + (tableColumns.length + 2) * 12}px` }}>
              {records.map((record, idx) => (
                <div
                  key={record.record_id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50/50 transition-colors duration-150"
                >
                  <span className="w-8 shrink-0 text-xs font-bold text-neutral-300 tabular-nums text-left">
                    {String((currentPage - 1) * pageSize + idx + 1).padStart(2, '0')}
                  </span>
                  {tableColumns.map((f) => {
                    const val = getRecordFieldValue(record, f);
                    return (
                    <span key={f.field_id} className="w-[120px] shrink-0 text-sm truncate" title={renderFieldValue(val, f.type, optionTextById)}>
                      {f.type === 'url' ? (
                        <a
                          href={(val as { link?: string })?.link || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-600 hover:text-amber-700 underline truncate block"
                        >
                          {renderFieldValue(val, f.type, optionTextById)}
                        </a>
                      ) : f.type === 'file' ? (
                        <AttachmentsCell
                          value={val}
                          tableId={_tableId}
                          fieldId={f.field_id}
                          recordId={record.record_id}
                        />
                      ) : (
                        <span className="text-neutral-700">{renderFieldValue(val, f.type, optionTextById)}</span>
                      )}
                    </span>
                    );
                  })}
                  <div className="w-20 shrink-0 flex justify-end">
                    <button
                      onClick={() => setDeleteTarget(record.record_id)}
                      className="p-1.5 rounded-lg text-neutral-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="删除记录"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
        </div>
      )}

      {/* 无记录空状态 */}
      {records.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
          <svg className="w-12 h-12 mb-3 text-neutral-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-sm">暂无记录</p>
        </div>
      )}

      {/* 翻页控件 */}
      {records.length > 0 && (() => {
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        /** 生成带省略号的页码数组 */
        function getPageNumbers(current: number, total: number): (number | '...')[] {
          if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
          const pages: (number | '...')[] = [1];
          const delta = 2; // 当前页前后各显示 2 个
          const left = Math.max(2, current - delta);
          const right = Math.min(total - 1, current + delta);

          if (left > 2) pages.push('...');

          for (let i = left; i <= right; i++) pages.push(i);

          if (right < total - 1) pages.push('...');

          pages.push(total);
          return pages;
        }

        const pageNumbers = getPageNumbers(currentPage, totalPages);
        const btnBase = 'inline-flex items-center justify-center min-w-[32px] h-8 px-1 text-xs font-medium rounded-md transition-colors tabular-nums';

        return (
          <div className="flex items-center justify-between mt-4 px-1">
            <span className="text-xs text-neutral-400">
              第 {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, total)} 条，共 {total} 条
            </span>
            <div className="flex items-center gap-0.5">
              {/* 上一页 */}
              <button
                onClick={onPrevPage}
                disabled={currentPage <= 1 || isLoading}
                className={`${btnBase} text-neutral-600 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                ‹
              </button>

              {pageNumbers.map((item, i) =>
                item === '...' ? (
                  <span key={`ellipsis-${i}`} className={`${btnBase} text-neutral-300 cursor-default`}>
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    onClick={() => onGoToPage(item)}
                    disabled={isLoading}
                    className={
                      item === currentPage
                        ? `${btnBase} bg-amber-50 text-amber-700 border border-amber-100 font-bold cursor-default`
                        : `${btnBase} text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700`
                    }
                  >
                    {item}
                  </button>
                )
              )}

              {/* 下一页 */}
              <button
                onClick={onNextPage}
                disabled={currentPage >= totalPages || isLoading}
                className={`${btnBase} text-neutral-600 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                ›
              </button>
            </div>
          </div>
        );
      })()}

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除记录"
        message={<>确定要删除记录 <span className="font-mono text-xs text-neutral-600 bg-neutral-100 px-1.5 py-0.5 rounded">{deleteTarget?.slice(-8)}</span> 吗？此操作不可恢复。</>}
        confirmLabel="删除"
        onConfirm={async () => {
          if (deleteTarget) {
            await onDeleteRecord(deleteTarget);
            setDeleteTarget(null);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
