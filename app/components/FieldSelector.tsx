'use client';

import React, { useState, useMemo } from 'react';
import { Table2, ClipboardList, Type, Hash, CircleDot, CheckSquare, Calendar, Check, User, Link, Paperclip, Phone, Mail, Sigma, Search, Clock, UserPlus, History } from 'lucide-react';
import type { App, Table, Field } from '@/types';
import { getFileDisplayName } from '@/lib/api';
import { fuzzySort } from '@/lib/search';

/* ====== 字段类型图标 ====== */
const FIELD_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  text: Type,
  number: Hash,
  single_select: CircleDot,
  multi_select: CheckSquare,
  date: Calendar,
  checkbox: Check,
  person: User,
  url: Link,
  file: Paperclip,
  phone: Phone,
  email: Mail,
  formula: Sigma,
  lookup: Search,
  created_time: Clock,
  created_by: UserPlus,
  updated_time: History,
  updated_by: User,
};

/* ====== 下拉项组件 ====== */
function DropdownItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 text-sm rounded-md transition-colors flex items-center gap-2.5 ${
        active
          ? 'bg-amber-50 text-amber-700 font-semibold'
          : 'text-neutral-600 hover:bg-neutral-50'
      }`}
    >
      {icon && (
        <span className="w-7 h-7 rounded-md bg-neutral-100 flex items-center justify-center text-xs flex-shrink-0">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate">{label}</div>
      </div>
      {active && (
        <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  );
}

/* ====== 单个选择器下拉 ====== */
function SelectorDropdown({
  open,
  label,
  placeholder,
  icon,
  loading,
  disabled,
  searchable = false,
  searchValue = '',
  searchPlaceholder = '搜索…',
  onToggle,
  onSearchChange,
  children,
  emptyText,
  resultCount,
}: {
  open: boolean;
  label: string;
  placeholder: string;
  icon: React.ReactNode;
  loading: boolean;
  disabled: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  searchable?: boolean;
  searchValue?: string;
  searchPlaceholder?: string;
  onSearchChange?: (value: string) => void;
  emptyText?: string;
  resultCount?: number;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open && searchable && inputRef.current) {
      // 延迟聚焦，等下拉动画展现
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open, searchable]);

  const showEmpty = emptyText && resultCount === 0;

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        disabled={disabled}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-md border text-sm font-medium transition-all duration-200 ${
          open
            ? 'border-amber-300 bg-amber-50 text-amber-700 shadow-sm'
            : disabled
            ? 'border-neutral-200 bg-neutral-50 text-neutral-300 cursor-not-allowed'
            : label
            ? 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:shadow-sm'
            : 'border-neutral-200 bg-white text-neutral-400 hover:border-neutral-300'
        }`}
      >
        <span className="text-base">{icon}</span>
        <span className="max-w-[140px] truncate">{label || placeholder}</span>
        {loading ? (
          <svg className="w-3.5 h-3.5 animate-spin text-neutral-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* 下拉菜单 */}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onToggle} />
          <div className="absolute top-full left-0 mt-1.5 w-72 bg-white rounded-md border border-neutral-200 shadow-xl shadow-neutral-200/50 z-20 animate-scale-in origin-top flex flex-col max-h-[360px]">
            {/* 搜索框 */}
            {searchable && onSearchChange && (
              <div className="px-3 pt-2 pb-1.5 flex-shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchValue}
                    onChange={(e) => onSearchChange(e.target.value)}
                    onCompositionUpdate={(e) => onSearchChange((e.target as HTMLInputElement).value)}
                    placeholder={searchPlaceholder}
                    className="w-full pl-8 pr-3 py-2 text-sm rounded-md border border-neutral-200 bg-neutral-50 placeholder:text-neutral-400 focus:outline-none focus:border-amber-300 focus:bg-white focus:ring-1 focus:ring-amber-100 transition-colors"
                  />
                  {searchValue && (
                    <button
                      onClick={() => onSearchChange('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-neutral-300 text-white flex items-center justify-center hover:bg-neutral-400 transition-colors"
                    >
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 列表区域 */}
            <div className="overflow-y-auto py-1.5">
              {showEmpty ? (
                <div className="px-4 py-6 text-center text-sm text-neutral-400">{emptyText}</div>
              ) : (
                children
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ====== 箭头分隔符 ====== */
function Arrow() {
  return (
    <svg className="w-5 h-5 text-neutral-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

/* ====== 主组件 ====== */
interface FieldSelectorProps {
  apps: App[];
  tables: Table[];
  tableFields: Field[];
  selectedApp: App | null;
  selectedTableId: string;
  selectedFieldId: string;
  /** 多选字段集合 */
  selectedFieldIds: Set<string>;
  loadingTables: boolean;
  loadingFields: boolean;
  onSelectApp: (app: App) => void;
  onSelectTable: (table: Table) => void;
  onToggleField: (field: Field) => void;
}

export default function FieldSelector({
  apps,
  tables,
  tableFields,
  selectedApp,
  selectedTableId,
  selectedFieldId,
  selectedFieldIds,
  loadingTables,
  loadingFields,
  onSelectApp,
  onSelectTable,
  onToggleField,
}: FieldSelectorProps) {
  const selectedTable = tables.find((t) => t.table_id === selectedTableId);
  const selectedCount = selectedFieldIds.size;

  const [openApp, setOpenApp] = useState(false);
  const [openTable, setOpenTable] = useState(false);
  const [openField, setOpenField] = useState(false);

  // 搜索关键词
  const [appSearch, setAppSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');

  // 过滤后的列表（支持原文 > 全拼 > 首字母模糊搜索）
  const filteredApps = useMemo(
    () => fuzzySort(apps, (a) => getFileDisplayName(a), appSearch),
    [apps, appSearch],
  );

  const filteredTables = useMemo(
    () => fuzzySort(tables, (t) => t.name, tableSearch),
    [tables, tableSearch],
  );

  const filteredFields = useMemo(
    () => fuzzySort(tableFields, (f) => f.name, fieldSearch),
    [tableFields, fieldSearch],
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* 一级：多维表格 */}
      <SelectorDropdown
        open={openApp}
        label={selectedApp?.name ?? ''}
        placeholder="选择多维表格"
        icon={<Table2 className="w-4 h-4" />}
        loading={false}
        disabled={apps.length === 0}
        onToggle={() => {
          setOpenApp(!openApp);
          setOpenTable(false);
          setOpenField(false);
          if (openApp) setAppSearch('');
        }}
        searchable
        searchValue={appSearch}
        searchPlaceholder="搜索多维表格…"
        onSearchChange={setAppSearch}
        emptyText="无匹配的多维表格"
        resultCount={filteredApps.length}
      >
        {apps.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-neutral-400">暂无多维表格</div>
        ) : (
          filteredApps.map((app) => (
            <DropdownItem
              key={app.app_token}
              label={getFileDisplayName(app)}
              icon={<Table2 className="w-4 h-4" />}
              active={selectedApp?.app_token === app.app_token}
              onClick={() => {
                onSelectApp(app);
                setOpenApp(false);
                setAppSearch('');
              }}
            />
          ))
        )}
      </SelectorDropdown>

      <Arrow />

      {/* 二级：数据表 */}
      <SelectorDropdown
        open={openTable}
        label={selectedTable?.name ?? ''}
        placeholder="选择数据表"
        icon={<ClipboardList className="w-4 h-4" />}
        loading={loadingTables}
        disabled={!selectedApp}
        onToggle={() => {
          if (selectedApp) {
            setOpenTable(!openTable);
            setOpenApp(false);
            setOpenField(false);
            if (openTable) setTableSearch('');
          }
        }}
        searchable
        searchValue={tableSearch}
        searchPlaceholder="搜索数据表…"
        onSearchChange={setTableSearch}
        emptyText="无匹配的数据表"
        resultCount={filteredTables.length}
      >
        {!selectedApp ? (
          <div className="px-4 py-6 text-center text-sm text-neutral-400">请先选择多维表格</div>
        ) : tables.length === 0 && !loadingTables ? (
          <div className="px-4 py-6 text-center text-sm text-neutral-400">暂无数据表</div>
        ) : (
          filteredTables.map((table) => (
            <DropdownItem
              key={table.table_id}
              label={table.name}
              icon={<ClipboardList className="w-4 h-4" />}
              active={selectedTableId === table.table_id}
              onClick={() => {
                onSelectTable(table);
                setOpenTable(false);
                setTableSearch('');
              }}
            />
          ))
        )}
      </SelectorDropdown>

      <Arrow />

      {/* 三级：字段 */}
      <SelectorDropdown
        open={openField}
        label={selectedCount > 0 ? `已选 ${selectedCount} 个字段` : ''}
        placeholder="筛选字段"
        icon={<Type className="w-4 h-4" />}
        loading={loadingFields}
        disabled={!selectedTableId}
        onToggle={() => {
          if (selectedTableId) {
            setOpenField(!openField);
            setOpenApp(false);
            setOpenTable(false);
            if (openField) setFieldSearch('');
          }
        }}
        searchable
        searchValue={fieldSearch}
        searchPlaceholder="搜索字段…"
        onSearchChange={setFieldSearch}
        emptyText="无匹配的字段"
        resultCount={filteredFields.length}
      >
        {!selectedTableId ? (
          <div className="px-4 py-6 text-center text-sm text-neutral-400">请先选择数据表</div>
        ) : tableFields.length === 0 && !loadingFields ? (
          <div className="px-4 py-6 text-center text-sm text-neutral-400">暂无字段</div>
        ) : (
          <>
            {/* 全选/清空快捷操作 — 搜索时隐藏 */}
            {!fieldSearch.trim() && (
              <div className="px-3 pb-2 mb-1 border-b border-neutral-100">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { tableFields.forEach((f) => { if (!selectedFieldIds.has(f.field_id)) onToggleField(f); }); }}
                    className="text-[11px] font-medium text-amber-600 hover:text-amber-700"
                  >
                    全选
                  </button>
                  <span className="text-neutral-300">|</span>
                  <button
                    onClick={() => { tableFields.forEach((f) => { if (selectedFieldIds.has(f.field_id)) onToggleField(f); }); }}
                    className="text-[11px] font-medium text-neutral-400 hover:text-neutral-600"
                  >
                    清空
                  </button>
                </div>
              </div>
            )}
            {filteredFields.map((field) => {
              const checked = selectedFieldIds.has(field.field_id);
              return (
                <DropdownItem
                  key={field.field_id}
                  label={field.name}
                  icon={(() => { const Icon = FIELD_TYPE_ICON[field.type]; return Icon ? <Icon className="w-3.5 h-3.5" /> : <span>?</span>; })()}
                  active={checked}
                  onClick={() => onToggleField(field)}
                />
              );
            })}
          </>
        )}
      </SelectorDropdown>

      {/* 已选字段信息 */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 ml-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-md text-sm animate-scale-in">
          <span className="w-5 h-5 rounded-md bg-emerald-200 flex items-center justify-center text-[10px] text-emerald-700 font-bold">
            {selectedCount}
          </span>
          <span className="text-emerald-700 font-medium whitespace-nowrap">
            个字段已筛选
          </span>
        </div>
      )}
    </div>
  );
}
