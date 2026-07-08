'use client';

import { useState } from 'react';
import { ClipboardList, Sparkles } from 'lucide-react';
import type { Table, FieldType } from '@/types';
import { FIELD_TYPE_OPTIONS } from '@/types';
import ConfirmDialog from '@/app/components/ConfirmDialog';

interface TableManagerProps {
  selectedApp: { app_token: string; name: string } | null;
  tables: Table[];
  selectedTableId: string;
  isLoading: boolean;
  onSelectTable: (table: Table) => void;
  onDeleteTable: (tableId: string, tableName: string) => void;
  onCreateTable: (name: string, fields: { name: string; type: FieldType }[]) => Promise<void>;
  onSwitchToApps: () => void;
}

function EmptyTables({ onSwitchToApps }: { onSwitchToApps: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-24 h-24 rounded-lg bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center mb-6 shadow-inner">
        <svg className="w-12 h-12 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-neutral-700 mb-2">还没有数据表</h3>
      <p className="text-sm text-neutral-400 mb-6">在此多维表格中创建第一个数据表</p>
      <button
        onClick={onSwitchToApps}
        className="px-4 py-2 text-sm font-medium text-amber-600 bg-amber-50 rounded-md hover:bg-amber-100 transition-colors"
      >
        ← 返回选择多维表格
      </button>
    </div>
  );
}

function NoAppSelected({ onSwitchToApps }: { onSwitchToApps: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-24 h-24 rounded-lg bg-gradient-to-br from-neutral-100 to-neutral-200 flex items-center justify-center mb-6 shadow-inner">
        <svg className="w-12 h-12 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-neutral-700 mb-2">请先选择一个多维表格</h3>
      <p className="text-sm text-neutral-400 mb-6">在「多维表格列表」中选择一个表格来管理数据表</p>
      <button
        onClick={onSwitchToApps}
        className="px-5 py-2.5 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-all duration-300 font-semibold text-sm shadow-sm"
      >
        选择多维表格
      </button>
    </div>
  );
}

export default function TableManager({
  selectedApp,
  tables,
  selectedTableId,
  isLoading,
  onSelectTable,
  onDeleteTable,
  onCreateTable,
  onSwitchToApps,
}: TableManagerProps) {
  const [newTableName, setNewTableName] = useState('');
  const [newTableFields, setNewTableFields] = useState<{ name: string; type: FieldType }[]>([
    { name: '', type: 'text' },
  ]);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  if (!selectedApp) {
    return <NoAppSelected onSwitchToApps={onSwitchToApps} />;
  }

  if (tables.length === 0 && !isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <EmptyTables onSwitchToApps={onSwitchToApps} />
        </div>
        {/* 右侧创建表单仍显示 */}
        <CreateFormSidebar
          newTableName={newTableName}
          setNewTableName={setNewTableName}
          newTableFields={newTableFields}
          setNewTableFields={setNewTableFields}
          creating={creating}
          isLoading={isLoading}
          onCreate={async () => {
            if (!newTableName.trim()) return;
            const validFields = newTableFields.filter((f) => f.name.trim());
            if (validFields.length === 0) return;
            setCreating(true);
            try {
              await onCreateTable(newTableName.trim(), validFields);
              setNewTableName('');
              setNewTableFields([{ name: '', type: 'text' }]);
            } finally {
              setCreating(false);
            }
          }}
          appName={selectedApp.name}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 左侧：数据表列表 */}
      <div className="lg:col-span-2">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-neutral-800 flex items-center gap-2">
            <ClipboardList className="w-5 h-5" />
            数据表列表
            <span className="text-sm font-normal text-neutral-400 bg-neutral-100 px-2.5 py-0.5 rounded-full">
              {tables.length}
            </span>
          </h2>
        </div>

        <div className="space-y-2">
          {tables.map((table) => {
            const isSelected = selectedTableId === table.table_id;
            return (
              <div
                key={table.table_id}
                className={`group flex items-center gap-4 p-4 rounded-lg border transition-all duration-300 ${
                  isSelected
                    ? 'border-amber-200 bg-amber-50/50 shadow-sm'
                    : 'border-neutral-100 bg-white hover:border-neutral-200 hover:bg-neutral-50/50 hover:shadow-sm'
                }`}
              >
                {/* 图标 */}
                <div className={`flex-shrink-0 w-10 h-10 rounded-md flex items-center justify-center text-lg transition-colors ${
                  isSelected ? 'bg-amber-100' : 'bg-neutral-100 group-hover:bg-amber-50'
                }`}>
                  <ClipboardList className="w-4 h-4" />
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectTable(table)}>
                  <div className="font-semibold text-neutral-800 truncate">{table.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-neutral-300 font-mono hidden sm:inline">{table.table_id}</span>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => onSelectTable(table)}
                    className="px-3.5 py-1.5 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors shadow-sm shadow-amber-500/20"
                  >
                    查看
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget({ id: table.table_id, name: table.name });
                    }}
                    className="p-1.5 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="删除数据表"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 右侧：创建表单 */}
      <CreateFormSidebar
        newTableName={newTableName}
        setNewTableName={setNewTableName}
        newTableFields={newTableFields}
        setNewTableFields={setNewTableFields}
        creating={creating}
        isLoading={isLoading}
        onCreate={async () => {
          if (!newTableName.trim()) return;
          const validFields = newTableFields.filter((f) => f.name.trim());
          if (validFields.length === 0) return;
          setCreating(true);
          try {
            await onCreateTable(newTableName.trim(), validFields);
            setNewTableName('');
            setNewTableFields([{ name: '', type: 'text' }]);
          } finally {
            setCreating(false);
          }
        }}
        appName={selectedApp.name}
      />

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除数据表"
        message={<>确定要删除数据表 <span className="font-semibold text-neutral-800">「{deleteTarget?.name}」</span> 吗？此操作不可恢复，表内所有字段和记录将被一并删除。</>}
        confirmLabel="删除"
        onConfirm={() => {
          if (deleteTarget) {
            onDeleteTable(deleteTarget.id, deleteTarget.name);
            setDeleteTarget(null);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ====== 创建表单侧边栏组件 ======

function CreateFormSidebar({
  newTableName,
  setNewTableName,
  newTableFields,
  setNewTableFields,
  creating,
  isLoading,
  onCreate,
  appName,
}: {
  newTableName: string;
  setNewTableName: (v: string) => void;
  newTableFields: { name: string; type: FieldType }[];
  setNewTableFields: (updater: (prev: { name: string; type: FieldType }[]) => { name: string; type: FieldType }[]) => void;
  creating: boolean;
  isLoading: boolean;
  onCreate: () => Promise<void>;
  appName: string;
}) {
  const addField = () => setNewTableFields((prev) => [...prev, { name: '', type: 'text' }]);
  const removeField = (i: number) => setNewTableFields((prev) => prev.filter((_, idx) => idx !== i));
  const updateField = (i: number, data: Partial<{ name: string; type: FieldType }>) =>
    setNewTableFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...data } : f)));

  return (
    <div>
      <h2 className="text-lg font-bold text-neutral-800 flex items-center gap-2 mb-5">
        <Sparkles className="w-5 h-5" />
        创建数据表
      </h2>

      <div className="bg-gradient-to-br from-neutral-50 to-amber-50/50 rounded-lg p-5 border border-neutral-100 space-y-4">
        {/* 当前应用 */}
        <div className="flex items-center gap-2 text-xs text-neutral-400 bg-white rounded-md px-3 py-2 border border-neutral-100">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <span className="truncate">{appName}</span>
        </div>

        {/* 表名 */}
        <div>
          <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">
            数据表名称
          </label>
          <input
            type="text"
            value={newTableName}
            onChange={(e) => setNewTableName(e.target.value)}
            placeholder="例如：客户信息表"
            className="w-full px-4 py-2.5 text-sm bg-white border border-neutral-200 rounded-md focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all outline-none placeholder:text-neutral-300"
          />
        </div>

        {/* 字段列表 */}
        <div>
          <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
            字段定义
          </label>
          <div className="space-y-2">
            {newTableFields.map((field, index) => (
              <div key={index} className="flex gap-2 items-center animate-fade-in">
                <input
                  type="text"
                  value={field.name}
                  onChange={(e) => updateField(index, { name: e.target.value })}
                  placeholder="字段名"
                  className="flex-1 px-3 py-2 text-sm bg-white border border-neutral-200 rounded-md focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all outline-none placeholder:text-neutral-300"
                />
                <select
                  value={field.type}
                  onChange={(e) => updateField(index, { type: e.target.value as FieldType })}
                  className="px-3 py-2 text-sm bg-white border border-neutral-200 rounded-md focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 transition-all outline-none text-neutral-600 cursor-pointer truncate"
                >
                  {FIELD_TYPE_OPTIONS.map((ft) => (
                    <option key={ft.value} value={ft.value}>
                      {ft.label}
                    </option>
                  ))}
                </select>
                {newTableFields.length > 1 && (
                  <button
                    onClick={() => removeField(index)}
                    className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addField}
            className="w-full mt-2.5 px-4 py-2.5 text-sm font-medium text-amber-500 bg-white border border-dashed border-amber-200 rounded-md hover:bg-amber-50 hover:border-amber-300 transition-all flex items-center justify-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            添加字段
          </button>
        </div>

        {/* 创建按钮 */}
        <button
          onClick={onCreate}
          disabled={creating || isLoading || !newTableName.trim()}
          className="w-full px-4 py-3 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:from-neutral-300 disabled:to-neutral-300 disabled:cursor-not-allowed transition-all duration-300 font-semibold text-sm shadow-sm hover:shadow-amber-500/40 active:scale-[0.98]"
        >
          {creating ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              创建中...
            </span>
          ) : (
            '创建数据表'
          )}
        </button>
      </div>
    </div>
  );
}
