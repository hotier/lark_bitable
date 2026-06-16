'use client';

import { useState, useEffect, useRef } from 'react';
import { Type, Hash, Calendar, CircleDot, CheckSquare, Check, User, Phone, Mail, Link, Paperclip, Sigma, Search, Clock, UserPlus, History } from 'lucide-react';
import type { Field, FieldType, BitableRecord } from '@/types';
import ConfirmDialog from '@/app/components/ConfirmDialog';

const TYPE_LABELS: Record<FieldType, string> = {
  text: '文本', number: '数字', date: '日期', single_select: '单选',
  multi_select: '多选', checkbox: '复选框', person: '人员',
  phone: '电话', email: '邮箱', url: '链接', file: '文件',
  formula: '公式', lookup: '查找引用', created_time: '创建时间',
  created_by: '创建人', updated_time: '更新时间', updated_by: '更新人',
};

const TYPE_COLORS: Record<FieldType, string> = {
  text: 'bg-neutral-50 text-amber-600 border-blue-100',
  number: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  date: 'bg-amber-50 text-amber-600 border-amber-100',
  single_select: 'bg-amber-50 text-amber-600 border-amber-100',
  multi_select: 'bg-violet-50 text-violet-600 border-violet-100',
  checkbox: 'bg-cyan-50 text-cyan-600 border-cyan-100',
  person: 'bg-pink-50 text-pink-600 border-pink-100',
  phone: 'bg-teal-50 text-teal-600 border-teal-100',
  email: 'bg-rose-50 text-rose-600 border-rose-100',
  url: 'bg-amber-50 text-amber-600 border-amber-100',
  file: 'bg-orange-50 text-orange-600 border-orange-100',
  formula: 'bg-neutral-50 text-neutral-600 border-neutral-100',
  lookup: 'bg-lime-50 text-lime-600 border-lime-100',
  created_time: 'bg-neutral-50 text-neutral-600 border-neutral-100',
  created_by: 'bg-yellow-50 text-yellow-600 border-yellow-100',
  updated_time: 'bg-neutral-50 text-neutral-600 border-neutral-100',
  updated_by: 'bg-yellow-50 text-yellow-600 border-yellow-100',
};

const TYPE_ICONS: Record<FieldType, React.ComponentType<{ className?: string }>> = {
  text: Type, number: Hash, date: Calendar, single_select: CircleDot,
  multi_select: CheckSquare, checkbox: Check, person: User, phone: Phone,
  email: Mail, url: Link, file: Paperclip, formula: Sigma, lookup: Search,
  created_time: Clock, created_by: UserPlus, updated_time: History, updated_by: User,
};

// 不需要填写值的系统字段类型
const READONLY_FIELD_TYPES: FieldType[] = [
  'formula', 'lookup', 'created_time', 'created_by', 'updated_time', 'updated_by', 'file',
];

interface RecordManagerProps {
  appToken: string;
  tableId: string;
  fields: Field[];
  records: BitableRecord[];
  isLoading: boolean;
  onSwitchToTables: () => void;
  onCreateRecord: (fields: Record<string, unknown>) => Promise<void>;
  onDeleteRecord: (recordId: string) => Promise<void>;
  onRefreshRecords: () => void;
  // 翻页
  currentPage: number;
  hasMore: boolean;
  total: number;
  pageSize: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  onGoToPage: (page: number) => void;
  /** 可选：仅展示这些字段列（不传则展示全部 fields） */
  displayFields?: Field[];
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

/** 格式化时间戳为可读日期 */
function formatDateTime(raw: number | string): string {
  const ms = typeof raw === 'string' ? Number(raw) : raw;
  if (!ms || ms <= 0 || Number.isNaN(ms)) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 判断是否为日期类字段 */
function isDateField(type: FieldType): boolean {
  return type === 'date' || type === 'created_time' || type === 'updated_time';
}

/** 尝试将值转为日期（字符串或数字时间戳） */
function tryFormatDate(value: unknown): string | null {
  if (typeof value === 'number') return formatDateTime(value);
  if (typeof value === 'string') {
    const n = Number(value);
    // 合理的毫秒时间戳范围：> 946684800000（2000-01-01）
    if (!Number.isNaN(n) && n > 946684800000) return formatDateTime(n);
  }
  return null;
}

/** 从记录中安全获取字段值 — 兼容 field_id 和字段名称两种 key 格式 */
function getRecordFieldValue(record: BitableRecord, field: Field): unknown {
  if (!record?.fields) return undefined;
  // 优先 field_id（SDK 使用 field_name_type:'field_id'），回退 field name
  if (field.field_id in record.fields) return record.fields[field.field_id];
  if (field.name in record.fields) return record.fields[field.name];
  return undefined;
}

/** 渲染记录的字段值 */
function renderFieldValue(value: unknown, fieldType: FieldType): string {
  if (value === null || value === undefined) return '—';
  // 日期类字段（飞书返回毫秒时间戳，可能是 number 或 string）
  if (isDateField(fieldType)) {
    const formatted = tryFormatDate(value);
    if (formatted) return formatted;
  }
  if (fieldType === 'url' && typeof value === 'object') {
    const u = value as { link?: string; text?: string };
    return u.text || u.link || '—';
  }
  if (Array.isArray(value)) {
    // 附件文件对象数组
    if (fieldType === 'file') {
      return value
        .map((v) => (typeof v === 'object' && v !== null ? (v as { name?: string }).name || '' : ''))
        .filter(Boolean)
        .join(', ');
    }
    return value
      .map((v) => (typeof v === 'object' ? (v as { text?: string }).text || JSON.stringify(v) : String(v)))
      .join(', ');
  }
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  return String(value);
}

/** 新增记录表单组件 */
function AddRecordForm({
  fields,
  onCreateRecord,
  onClose,
}: {
  fields: Field[];
  onCreateRecord: (fields: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const editableFields = fields.filter((f) => !READONLY_FIELD_TYPES.includes(f.type));
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  const setValue = (fieldId: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async () => {
    // 过滤掉空值
    const cleanValues: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(formValues)) {
      if (val === '' || val === null || val === undefined) continue;
      cleanValues[key] = val;
    }
    if (Object.keys(cleanValues).length === 0) return;
    setSubmitting(true);
    try {
      await onCreateRecord(cleanValues);
      setFormValues({});
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-neutral-50/80 rounded-md border border-neutral-100 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-neutral-700">新增记录</h3>
        <button onClick={onClose} className="p-1 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {editableFields.map((field) => (
          <FieldInput
            key={field.field_id}
            field={field}
            value={formValues[field.field_id]}
            onChange={(v) => setValue(field.field_id, v)}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 mt-5 pt-4 border-t border-neutral-200/60">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-5 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-all duration-300 font-semibold text-sm shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? '提交中...' : '创建记录'}
        </button>
        <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition-colors">
          取消
        </button>
      </div>
    </div>
  );
}

/** 单个字段输入组件 */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const baseInputClass =
    'w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-700 placeholder:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all';

  const stringValue = value === null || value === undefined ? '' : String(value);

  // URL 字段：双输入（链接 + 文本）
  if (field.type === 'url') {
    const urlObj = (typeof value === 'object' && value !== null ? value : { link: '', text: '' }) as {
      link?: string;
      text?: string;
    };
    return (
      <div>
        <label className="block text-xs font-semibold text-neutral-500 mb-1.5">
          <Link className="w-3.5 h-3.5 inline-block" /> {field.name} <span className="font-normal text-neutral-300">链接</span>
        </label>
        <div className="space-y-2">
          <input
            type="url"
            placeholder="https://example.com"
            value={urlObj.link || ''}
            onChange={(e) => onChange({ link: e.target.value, text: urlObj.text || '' })}
            className={baseInputClass}
          />
          <input
            type="text"
            placeholder="链接显示文字"
            value={urlObj.text || ''}
            onChange={(e) => onChange({ link: urlObj.link || '', text: e.target.value })}
            className={baseInputClass}
          />
        </div>
      </div>
    );
  }

  // 数字字段
  if (field.type === 'number') {
    return (
      <div>
        <label className="block text-xs font-semibold text-neutral-500 mb-1.5">
          123 {field.name} <span className="font-normal text-neutral-300">数字</span>
        </label>
        <input
          type="number"
          placeholder="输入数字"
          value={stringValue}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={baseInputClass}
        />
      </div>
    );
  }

  // 复选框
  if (field.type === 'checkbox') {
    return (
      <div className="flex items-center gap-3 pt-5">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 rounded border-neutral-300 text-amber-500 focus:ring-amber-500/20"
        />
        <label className="text-xs font-semibold text-neutral-500">
          <Check className="w-3.5 h-3.5 inline-block" /> {field.name} <span className="font-normal text-neutral-300">复选框</span>
        </label>
      </div>
    );
  }

  // 默认：文本输入
  const placeholderMap: Partial<Record<FieldType, string>> = {
    phone: '输入电话号码',
    email: 'name@example.com',
    text: '输入文本',
    single_select: '输入选项名',
    multi_select: '选项A, 选项B',
    person: '输入人员ID (ou_xxx)',
    date: 'YYYY-MM-DD 或时间戳',
  };

  return (
    <div>
      <label className="block text-xs font-semibold text-neutral-500 mb-1.5">
        {(() => { const Icon = TYPE_ICONS[field.type]; return Icon ? <Icon className="w-3.5 h-3.5 inline-block" /> : '?'; })()} {field.name}{' '}
        <span className="font-normal text-neutral-300">{TYPE_LABELS[field.type] || field.type}</span>
      </label>
      <input
        type="text"
        placeholder={placeholderMap[field.type] || `输入${TYPE_LABELS[field.type] || ''}`}
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        className={baseInputClass}
      />
    </div>
  );
}

type FeishuAttachment = { file_token?: string; name?: string; type?: string; size?: number };

/** 附件单元格：获取加密短 token，展示为可点击超链接 */
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
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    if (!Array.isArray(value) || value.length === 0) return;

    const files = value as FeishuAttachment[];
    const validFiles = files.filter((f) => f.file_token);
    if (validFiles.length === 0) return;

    fetchedRef.current = true;

    // 批量获取所有文件的加密 token
    Promise.all(
      validFiles.map(async (file) => {
        try {
          const res = await fetch('/api/bitable/files/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file_token: file.file_token,
              table_id: tableId,
              field_id: fieldId,
              record_id: recordId,
              name: file.name,
            }),
          });
          if (!res.ok) return null;
          const data = await res.json();
          return { key: file.file_token!, token: data.id as string };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      const map: Record<string, string> = {};
      for (const r of results) {
        if (r) map[r.key] = r.token;
      }
      setTokens(map);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!Array.isArray(value) || value.length === 0) return <span className="text-neutral-300">—</span>;

  const files = value as FeishuAttachment[];

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      {files.map((file, i) => {
        const ft = file.file_token || `__idx_${i}`;
        const name = file.name || file.file_token || '?';
        const token = file.file_token ? tokens[file.file_token] : undefined;
        const previewUrl = token ? `/p/${encodeURIComponent(token)}` : null;

        return (
          <a
            key={ft}
            href={previewUrl || '#'}
            target={previewUrl ? '_blank' : undefined}
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1 text-xs truncate max-w-full ${
              previewUrl ? 'text-blue-600 hover:text-blue-800 hover:underline' : 'text-neutral-400'
            }`}
            title={name}
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
  appToken: _appToken,
  tableId: _tableId,
  fields,
  records,
  isLoading,
  onSwitchToTables,
  onCreateRecord,
  onDeleteRecord,
  onRefreshRecords,
  currentPage,
  hasMore,
  total,
  pageSize,
  onNextPage,
  onPrevPage,
  onGoToPage,
  displayFields,
}: RecordManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  // 表格展示使用的字段列
  const tableColumns = displayFields ?? fields;

  if (!_appToken || !_tableId) {
    return <NoTableSelected onSwitchToTables={onSwitchToTables} />;
  }

  if (fields.length === 0) {
    return <NoFields />;
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
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
            <p className="text-xs text-neutral-400">{total} 条记录</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefreshRecords}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-neutral-600 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {isLoading ? '加载中...' : '刷新'}
          </button>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-md hover:from-emerald-600 hover:to-teal-700 transition-all duration-300 font-semibold text-sm shadow-lg shadow-emerald-500/20"
            >
              + 新增记录
            </button>
          )}
        </div>
      </div>

      {/* 新增记录表单 */}
      {showForm && (
        <AddRecordForm
          fields={fields}
          onCreateRecord={async (values) => {
            await onCreateRecord(values);
            setShowForm(false);
          }}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* 字段类型概览 */}
      <div className="flex flex-wrap gap-2 mb-5">
        {tableColumns.slice(0, 8).map((f) => (
          <span
            key={f.field_id}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border ${TYPE_COLORS[f.type] || 'bg-neutral-50 text-neutral-500 border-neutral-100'}`}
          >
            {(() => { const Icon = TYPE_ICONS[f.type]; return Icon ? <Icon className="w-3 h-3" /> : <span>?</span>; })()}
            {f.name}
          </span>
        ))}
        {tableColumns.length > 8 && (
          <span className="text-xs text-neutral-400 px-2 py-1">+{tableColumns.length - 8}</span>
        )}
      </div>

      {/* 表格 —— 滑动条内联在表体内 */}
      {records.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col rounded-md border border-neutral-100">
          {/* 表头 */}
          <div className="flex items-center gap-3 px-4 py-3 bg-neutral-100 text-xs font-semibold text-neutral-400 uppercase tracking-wider min-w-max flex-shrink-0"
            style={{ minWidth: `${48 + tableColumns.length * 120 + 80 + (tableColumns.length + 2) * 12}px` }}>
            <span className="w-8 shrink-0 text-left">#</span>
            {tableColumns.map((f) => (
              <span key={f.field_id} title={f.field_id} className="w-[120px] shrink-0">
                {(() => { const Icon = TYPE_ICONS[f.type]; return Icon ? <Icon className="w-3 h-3 inline" /> : '?'; })()} {f.name}
              </span>
            ))}
            <span className="w-20 shrink-0 text-right">操作</span>
          </div>

          {/* 表体 —— 自带滚动条 */}
          <div className="flex-1 min-h-0 overflow-auto">
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
                    <span key={f.field_id} className="w-[120px] shrink-0 text-sm truncate" title={renderFieldValue(val, f.type)}>
                      {f.type === 'url' ? (
                        <a
                          href={(val as { link?: string })?.link || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-600 hover:text-amber-700 underline truncate block"
                        >
                          {renderFieldValue(val, f.type)}
                        </a>
                      ) : f.type === 'file' ? (
                        <AttachmentsCell
                          value={val}
                          tableId={_tableId}
                          fieldId={f.field_id}
                          recordId={record.record_id}
                        />
                      ) : (
                        <span className="text-neutral-700">{renderFieldValue(val, f.type)}</span>
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
        </div>
      )}

      {/* 无记录空状态 */}
      {records.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
          <svg className="w-12 h-12 mb-3 text-neutral-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-sm">暂无记录，点击「新增记录」开始</p>
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
                disabled={!hasMore || isLoading}
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
