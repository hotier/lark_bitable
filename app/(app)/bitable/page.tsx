'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Table2, ClipboardList, FileText, ChevronRight } from 'lucide-react';
import type { App, Table, Field, FieldType, FeishuRecord, ToastMessage } from '@/types';
import {
  listApps, refreshApps, invalidateAppsCache, createApp,
  listTables, createTable, deleteTable, listFields,
  loadFirstRecords, warmUpAllRecords, loadAllRecords, invalidateRecordsCache, createRecord, deleteApiRecord,
  logout as apiLogout,
} from '@/lib/api';
import TopBar from '@/app/components/TopBar';
import AppGrid from '@/app/components/AppGrid';
import TableManager from '@/app/components/TableManager';
import RecordManager, { getRecordFieldValue } from '@/app/components/RecordManager';
import FieldSelector from '@/app/components/FieldSelector';
import Toast from '@/app/components/Toast';
import { TableListSkeleton, RecordListSkeleton } from '@/app/components/Skeletons';
import { useRouteTransition } from '@/app/components/RouteTransition';

type View = 'apps' | 'tables' | 'records';

const PAGE_SIZE = 20;          // 每页展示的行数
const FETCH_PAGE_SIZE = 500;   // 拉取全量记录时每页请求量（飞书上限 500，一次遍历拿到整表）

/** 前端排序比较：空值排末尾；数值按数字比较，其余按本地化字符串比较（兼容 select 的 {text} 与数组） */
function compareRecordValues(a: unknown, b: unknown): number {
  const norm = (v: unknown): unknown => {
    if (v == null) return null;
    if (Array.isArray(v)) return v.length ? norm(v[0]) : null;
    if (typeof v === 'object' && v !== null && 'text' in (v as Record<string, unknown>)) {
      return (v as Record<string, unknown>).text;
    }
    return v;
  };
  const av = norm(a);
  const bv = norm(b);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const an = typeof av === 'number' ? av : Number(av);
  const bn = typeof bv === 'number' ? bv : Number(bv);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return String(av).localeCompare(String(bv), 'zh-CN');
}

export default function DashboardPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [apps, setApps] = useState<App[]>([]);
  const [selectedApp, setSelectedApp] = useState<App | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [tableFields, setTableFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState('');
  // 快速导航中勾选的字段集合（多选；为空时显示全部字段）
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(new Set());
  const [allRecords, setAllRecords] = useState<FeishuRecord[]>([]); // 已加载的全量记录（本地缓存，翻页零请求）
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false); // 全量记录是否已静默预热完成（未完时后续翻页会触发兜底加载）
  const [warming, setWarming] = useState(false);       // 是否正在后台静默预热全量记录（用于展示进度动画）
  const loadKeyRef = useRef(''); // 当前加载的表+排序标识，防止后台预热结果错位写入
  const [view, setView] = useState<View>('apps');
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // 翻页状态：全量记录已缓存在本地，翻页仅为前端切片
  const [currentPage, setCurrentPage] = useState(1);   // 展示页（1-based）
  const [total, setTotal] = useState(0);

  // 列排序（前端排序，仅对当前分页内容排序）：字段 id + 方向
  const [sortFieldId, setSortFieldId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // 当前展示页对应的记录：从本地全量缓存切片（翻页零接口调用），再按 sort 在前端排序（仅本页）
  const displayRecords = useMemo(() => {
    if (allRecords.length === 0) return [];
    const start = (currentPage - 1) * PAGE_SIZE;
    const page = allRecords.slice(start, start + PAGE_SIZE);
    if (!sortFieldId) return page;
    const field = tableFields.find((f) => f.field_id === sortFieldId);
    if (!field) return page;
    const dir = sortOrder === 'asc' ? 1 : -1;
    return [...page].sort((ra, rb) =>
      compareRecordValues(getRecordFieldValue(ra, field), getRecordFieldValue(rb, field)) * dir,
    );
  }, [allRecords, currentPage, sortFieldId, sortOrder, tableFields]);

  // 加载指定数据表的字段 + 记录：
  // ① 先拉字段与「首页记录」秒开首屏；② 再静默预热全量记录写入缓存，后续翻页/跳页零接口调用。
  const loadTableData = useCallback(async (appToken: string, tableId: string) => {
    const key = `${appToken}:${tableId}:none`;
    loadKeyRef.current = key;

    const [fieldsData, first] = await Promise.all([
      listFields(appToken, tableId),
      loadFirstRecords(appToken, tableId, FETCH_PAGE_SIZE),
    ]);
    setTableFields(fieldsData);
    // 首屏即展示首页记录（命中全量缓存时 first 已包含整表）
    setAllRecords(first.records || []);
    setTotal(first.total || (first.records?.length ?? 0));
    setRecordsLoaded(true);
    const doneAtStart = !first.has_more || !first.page_token;
    setFullLoaded(doneAtStart);

    // ② 静默预热：后台继续拉取剩余页，完成后替换本地全量记录
    if (!doneAtStart) {
      setWarming(true);
      warmUpAllRecords(appToken, tableId, FETCH_PAGE_SIZE, first.page_token!, first.records || [])
        .then((full) => {
          if (loadKeyRef.current !== key) return; // 已切换到别的表/排序，丢弃
          setAllRecords(full.records || []);
          setTotal(full.total || (full.records?.length ?? 0));
          setFullLoaded(true);
        })
        .catch(() => { /* 静默失败：用户翻页时会兜底全量加载 */ })
        .finally(() => { if (loadKeyRef.current === key) setWarming(false); });
    } else {
      setWarming(false);
    }
  }, []);

  const addToast = useCallback((type: ToastMessage['type'], text: string) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, type, text }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const { endTransition } = useRouteTransition();

  useEffect(() => {
    setIsAuthenticated(true); // AuthGuard 已验证
    endTransition(); // 结束从首页进入的过渡动画
  }, []);

  const withLoading = async (fn: () => Promise<void>, successMsg?: string, errorPrefix = '操作失败') => {
    setIsLoading(true);
    try { await fn(); if (successMsg) addToast('success', successMsg); }
    catch (error) { addToast('error', `${errorPrefix}: ${error instanceof Error ? error.message : '未知错误'}`); }
    finally { setIsLoading(false); }
  };

  const resetRecords = useCallback(() => {
    setAllRecords([]); setCurrentPage(1); setTotal(0); setRecordsLoaded(false); setFullLoaded(false);
  }, []);

  const handleLogout = async () => {
    await apiLogout();
    invalidateAppsCache();
    window.location.replace('/');
  };

  const handleListApps = useCallback(() => {
    withLoading(async () => {
      const { data } = await listApps();
      const sorted = (data.files || []).slice().sort(
        (a, b) => new Date(b.update_time).getTime() - new Date(a.update_time).getTime(),
      );
      setApps(sorted);
    }, undefined, '获取多维表格列表失败');
  }, []);

  // 同步按钮：强制绕过缓存刷新飞书数据
  const handleSyncApps = useCallback(() => {
    withLoading(async () => {
      const { data } = await refreshApps();
      const sorted = (data.files || []).slice().sort(
        (a, b) => new Date(b.update_time).getTime() - new Date(a.update_time).getTime(),
      );
      setApps(sorted);
      addToast('success', `已同步 ${data.files?.length ?? 0} 个多维表格`);
    }, undefined, '同步多维表格列表失败');
  }, [addToast]);

  const handleCreateApp = useCallback(async (name: string, folderToken?: string) => {
    setIsCreating(true);
    try { const app = await createApp(name, folderToken); setApps((prev) => [app, ...prev]); addToast('success', `多维表格 "${name}" 创建成功`); }
    catch (error) { const msg = error instanceof Error ? error.message : '未知错误'; addToast('error', `创建多维表格失败: ${msg}`); throw error; }
    finally { setIsCreating(false); }
  }, []);

  const handleSelectApp = useCallback((app: App) => {
    setSelectedApp(app); setView('tables');
    setSelectedTableId(''); setSelectedFieldId(''); setSelectedFieldIds(new Set()); setRecordsLoaded(false);
    resetRecords();
    // 自动加载该 App 下的数据表列表
    withLoading(async () => {
      const data = await listTables(app.app_token);
      setTables(data.items || []);
    }, undefined, '获取数据表列表失败');
  }, [resetRecords]);

  const handleListTables = useCallback(() => {
    if (!selectedApp) return;
    withLoading(async () => {
      const data = await listTables(selectedApp.app_token);
      setTables(data.items || []);
    }, undefined, '获取数据表列表失败');
  }, [selectedApp]);

  const handleCreateTable = useCallback(async (name: string, fields: { name: string; type: FieldType }[]) => {
    if (!selectedApp) return;
    await withLoading(async () => {
      await createTable(selectedApp.app_token, name, fields);
      const data = await listTables(selectedApp.app_token);
      setTables(data.items || []);
    }, `数据表 "${name}" 创建成功`, '创建数据表失败');
  }, [selectedApp]);

  const handleDeleteTable = useCallback((tableId: string, tableName: string) => {
    if (!selectedApp) return;
    withLoading(async () => {
      await deleteTable(selectedApp.app_token, tableId);
      if (tableId === selectedTableId) setSelectedTableId('');
      const data = await listTables(selectedApp.app_token);
      setTables(data.items || []);
    }, `数据表 "${tableName}" 已删除`, '删除数据表失败');
  }, [selectedApp, selectedTableId]);

  const handleSelectTable = useCallback((table: Table) => {
    setSelectedTableId(table.table_id);
    setSelectedFieldId(''); setSelectedFieldIds(new Set()); setRecordsLoaded(false); setView('records');
    setSortFieldId(null); setSortOrder('asc');
    resetRecords();
    // 自动加载该数据表的字段和全量记录
    if (selectedApp) {
      withLoading(async () => {
        await loadTableData(selectedApp.app_token, table.table_id);
      }, undefined, '获取字段/记录失败');
    }
  }, [selectedApp, resetRecords, loadTableData]);

  const handleSelectorSelectApp = useCallback(async (app: App) => {
    setSelectedApp(app); setView('tables'); setTables([]); setTableFields([]);
    setSelectedTableId(''); setSelectedFieldId(''); setSelectedFieldIds(new Set()); setRecordsLoaded(false);
    resetRecords();
    setLoadingTables(true);
    try { const data = await listTables(app.app_token); setTables(data.items || []); }
    catch (err) { addToast('error', `加载数据表失败: ${err instanceof Error ? err.message : '未知错误'}`); }
    finally { setLoadingTables(false); }
  }, [resetRecords]);

  const handleSelectorSelectTable = useCallback(async (table: Table) => {
    setSelectedTableId(table.table_id); setSelectedFieldId(''); setSelectedFieldIds(new Set()); setTableFields([]);
    setView('records'); setRecordsLoaded(false);
    setSortFieldId(null); setSortOrder('asc');
    resetRecords();
    if (selectedApp) {
      setLoadingFields(true);
      try {
        await loadTableData(selectedApp.app_token, table.table_id);
      }
      catch (err) { addToast('error', `加载字段/记录失败: ${err instanceof Error ? err.message : '未知错误'}`); }
      finally { setLoadingFields(false); }
    }
  }, [selectedApp, resetRecords, loadTableData]);

  const handleSelectorToggleField = useCallback((field: Field) => {
    setSelectedFieldIds((prev) => {
      const next = new Set(prev);
      if (next.has(field.field_id)) {
        next.delete(field.field_id);
      } else {
        next.add(field.field_id);
      }
      return next;
    });
  }, []);

  // 根据勾选的字段筛选展示列；未勾选任何字段时显示全部
  const displayFields = selectedFieldIds.size > 0
    ? tableFields.filter((f) => selectedFieldIds.has(f.field_id))
    : tableFields;

  const handleDeleteRecord = useCallback(async (recordId: string) => {
    if (!selectedApp || !selectedTableId) return;
    await withLoading(async () => {
      await deleteApiRecord(selectedApp.app_token, selectedTableId, recordId);
      invalidateRecordsCache(selectedApp.app_token, selectedTableId);
      await loadTableData(selectedApp.app_token, selectedTableId);
    }, '记录已删除', '删除记录失败');
  }, [selectedApp, selectedTableId, loadTableData]);

  const handleCreateRecord = useCallback(async (fields: Record<string, unknown>) => {
    if (!selectedApp || !selectedTableId) return;
    await withLoading(async () => {
      const namedFields: Record<string, unknown> = {};
      for (const [fieldId, value] of Object.entries(fields)) {
        const fieldMeta = tableFields.find((f) => f.field_id === fieldId);
        namedFields[fieldMeta?.name || fieldId] = value;
      }
      await createRecord(selectedApp.app_token, selectedTableId, namedFields);
      invalidateRecordsCache(selectedApp.app_token, selectedTableId);
      await loadTableData(selectedApp.app_token, selectedTableId);
    }, '记录创建成功', '创建记录失败');
  }, [selectedApp, selectedTableId, tableFields, loadTableData]);

  // 兜底：全量尚未预热完成时，若目标页超出本地已加载范围，则等待/触发全量加载
  const ensureFullLoaded = useCallback(async (targetPage: number) => {
    if (fullLoaded) return;
    if (!selectedApp || !selectedTableId) return;
    const start = (targetPage - 1) * PAGE_SIZE;
    if (start < allRecords.length) return; // 目标页已在本地切片范围内，无需加载
    const key = `${selectedApp.app_token}:${selectedTableId}:none`;
    if (loadKeyRef.current !== key) return; // 已切换表
    setIsLoading(true);
    try {
      const full = await loadAllRecords(selectedApp.app_token, selectedTableId, FETCH_PAGE_SIZE);
      if (loadKeyRef.current === key) {
        setAllRecords(full.records || []);
        setTotal(full.total || (full.records?.length ?? 0));
        setFullLoaded(true);
      }
    } catch { /* 忽略，保留已加载部分 */ }
    finally { setIsLoading(false); }
  }, [fullLoaded, selectedApp, selectedTableId, allRecords.length]);

  // 翻页：上一页（本地切片，零接口调用；越界时兜底全量加载）
  const handlePrevPage = useCallback(async () => {
    const target = Math.max(1, currentPage - 1);
    await ensureFullLoaded(target);
    setCurrentPage(target);
  }, [currentPage, ensureFullLoaded]);

  // 翻页：下一页（本地切片，零接口调用；越界时兜底全量加载）
  const handleNextPage = useCallback(async () => {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const target = Math.min(totalPages, currentPage + 1);
    await ensureFullLoaded(target);
    setCurrentPage(target);
  }, [currentPage, total, ensureFullLoaded]);

  // 翻页：跳转到指定页码（本地切片，零接口调用；越界时兜底全量加载）
  const handleGoToPage = useCallback(async (targetPage: number) => {
    if (!selectedApp || !selectedTableId) return;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (targetPage < 1 || targetPage > totalPages || targetPage === currentPage) return;
    await ensureFullLoaded(targetPage);
    setCurrentPage(targetPage);
  }, [selectedApp, selectedTableId, currentPage, total, ensureFullLoaded]);

  // 列排序：点击表头切换 未排序→升序→降序→取消（纯前端排序当前分页，无需请求飞书）
  const handleSort = useCallback((fieldId: string) => {
    let newFieldId: string | null = fieldId;
    let newOrder: 'asc' | 'desc' = 'asc';
    if (sortFieldId === fieldId) {
      if (sortOrder === 'asc') newOrder = 'desc';
      else { newFieldId = null; newOrder = 'asc'; }
    }
    setSortFieldId(newFieldId);
    setSortOrder(newOrder);
    setCurrentPage(1); // 回到首页，避免停留在已重排的越界页
  }, [sortFieldId, sortOrder]);

  useEffect(() => { if (isAuthenticated && apps.length === 0) handleListApps(); }, [isAuthenticated]);

  const selectedTable = tables.find((t) => t.table_id === selectedTableId);

  const TABS = [
    { key: 'apps' as View, label: '表格列表', icon: Table2 },
    { key: 'tables' as View, label: '数据表', icon: ClipboardList },
    { key: 'records' as View, label: '记录', icon: FileText },
  ];

  return (
    <div className="flex flex-col h-full">
      <Toast messages={toasts} onDismiss={dismissToast} />

      {/* Top Bar */}
      <TopBar
        isAuthenticated={isAuthenticated} isLoading={isLoading}
        onFetchApps={handleSyncApps} onLogout={handleLogout}
      >
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-base" aria-label="Breadcrumb">
          <button
            onClick={() => { setView('apps'); setSelectedApp(null); setTables([]); setSelectedTableId(''); setSelectedFieldId(''); setSelectedFieldIds(new Set()); setRecordsLoaded(false); resetRecords(); }}
            className="flex items-center gap-2 font-semibold transition-colors"
            style={{ color: view === 'apps' ? 'var(--text)' : 'var(--text-tertiary)' }}
          >
            <Table2 className="w-5 h-5 text-orange-500" />
            多维表格
          </button>
          {selectedApp && (
            <>
              <ChevronRight className="w-4 h-4 text-neutral-300" />
              <button
                onClick={() => { setView('tables'); setSelectedTableId(''); setSelectedFieldId(''); setSelectedFieldIds(new Set()); setRecordsLoaded(false); resetRecords(); }}
                className="font-medium transition-colors truncate max-w-[200px]"
                style={{ color: view === 'tables' ? 'var(--text)' : 'var(--text-tertiary)' }}
              >
                {selectedApp.name}
              </button>
            </>
          )}
          {selectedTable && (
            <>
              <ChevronRight className="w-4 h-4 text-neutral-300" />
              <span className="font-medium truncate max-w-[200px]" style={{ color: 'var(--text)' }}>
                {selectedTable.name}
              </span>
            </>
          )}
        </nav>
      </TopBar>

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Field Selector / 快速导航 */}
        {isAuthenticated && (
          <div className="px-6 pt-6 flex-shrink-0">
            <div
              className="p-4 rounded-lg animate-fade-in"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-4">
                <span className="text-xs font-medium text-neutral-400 uppercase tracking-wide flex-shrink-0">
                  快速导航
                </span>
                <div className="flex-1">
                  <FieldSelector
                    apps={apps} tables={tables} tableFields={tableFields}
                    selectedApp={selectedApp} selectedTableId={selectedTableId} selectedFieldId={selectedFieldId}
                    selectedFieldIds={selectedFieldIds}
                    loadingTables={loadingTables} loadingFields={loadingFields}
                    onSelectApp={handleSelectorSelectApp}
                    onSelectTable={handleSelectorSelectTable}
                    onToggleField={handleSelectorToggleField}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs + Content */}
        <div className="flex-1 min-h-0 flex flex-col px-6 pb-6 pt-6">
          <div
            className="flex-1 min-h-0 flex flex-col rounded-lg overflow-hidden animate-fade-in"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            {/* Tab bar */}
            <div
              className="flex-shrink-0 flex border-b px-2"
              style={{ borderColor: 'var(--border)' }}
            >
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setView(tab.key)}
                  className="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative"
                  style={{
                    color: view === tab.key ? 'var(--text)' : 'var(--text-tertiary)',
                  }}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                  {view === tab.key && (
                    <span
                      className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full"
                      style={{ background: 'var(--accent)' }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content — 各组件自行管理滚动 */}
            <div className="flex-1 min-h-0 overflow-hidden p-6">
              {view === 'apps' && (
                isLoading && apps.length === 0 ? (
                  <div className="p-1"><TableListSkeleton rows={8} /></div>
                ) : (
                  <AppGrid
                    apps={apps} selectedApp={selectedApp}
                    isAuthenticated={isAuthenticated} isCreating={isCreating}
                    onSelectApp={handleSelectApp} onCreateApp={handleCreateApp}
                    onRefresh={handleSyncApps}
                  />
                )
              )}
              {view === 'tables' && (
                isLoading && tables.length === 0 ? (
                  <div className="p-1"><TableListSkeleton rows={6} /></div>
                ) : (
                  <TableManager
                    selectedApp={selectedApp} tables={tables} selectedTableId={selectedTableId}
                    isLoading={isLoading} onSelectTable={handleSelectTable}
                    onDeleteTable={handleDeleteTable} onCreateTable={handleCreateTable}
                    onSwitchToApps={() => setView('apps')}
                  />
                )
              )}
              {view === 'records' && (
                isLoading && allRecords.length === 0 ? (
                  <div className="p-1"><RecordListSkeleton cols={displayFields.length || 4} rows={8} /></div>
                ) : (
                  <RecordManager
                    appToken={selectedApp?.app_token ?? ''} tableId={selectedTableId}
                    appName={selectedApp?.name ?? ''}
                    fields={tableFields} displayFields={displayFields} records={displayRecords} isLoading={isLoading}
                    onSwitchToTables={() => setView('tables')}
                    onCreateRecord={handleCreateRecord} onDeleteRecord={handleDeleteRecord}
                    warming={warming} loadedCount={allRecords.length}
                    currentPage={currentPage} total={total} pageSize={PAGE_SIZE}
                    onNextPage={handleNextPage} onPrevPage={handlePrevPage} onGoToPage={handleGoToPage}
                    sortFieldId={sortFieldId} sortOrder={sortOrder} onSort={handleSort}
                  />
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
