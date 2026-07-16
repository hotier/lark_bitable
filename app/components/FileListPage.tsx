'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, Search, X, ArrowUpDown, ArrowUp, ArrowDown, HardDrive, BookOpen, ChevronRight, FileText, Grid3X3 } from 'lucide-react';
import type { App, ToastMessage } from '@/types';
import {
  deleteFile, deleteWikiFile, invalidateWikiCaches,
  getUserProfile, getFileDisplayName,
  listDocs, createDoc, invalidateDocsCache, refreshDocs,
  listSheets, createSheet, invalidateSheetsCache, refreshSheets,
  logout as apiLogout,
} from '@/lib/api';
import { fuzzySort } from '@/lib/search';
import TopBar from '@/app/components/TopBar';
import Toast from '@/app/components/Toast';
import NameCard from '@/app/components/NameCard';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { FileListSkeleton } from '@/app/components/Skeletons';
import { useRouteTransition } from '@/app/components/RouteTransition';

let toastId = 0;
function nextId() { return `t${++toastId}`; }

/** 每种文件类型的静态配置 —— 全部可序列化，Server→Client 传递安全 */
const TYPE_CONFIG = {
  doc: {
    label: '云文档',
    Icon: FileText,
    color: 'blue' as const,
    listFn: listDocs,
    createFn: createDoc,
    refreshFn: refreshDocs,
    invalidateCache: invalidateDocsCache,
    deleteFileType: 'docx',
  },
  sheet: {
    label: '在线表格',
    Icon: Grid3X3,
    color: 'green' as const,
    listFn: listSheets,
    createFn: createSheet,
    refreshFn: refreshSheets,
    invalidateCache: invalidateSheetsCache,
    deleteFileType: 'sheet',
  },
} as const;

export type FileListPageType = keyof typeof TYPE_CONFIG;

export default function FileListPage({ type }: { type: FileListPageType }) {
  const config = TYPE_CONFIG[type] ?? TYPE_CONFIG.doc;
  const {
    label, Icon, color,
    listFn, createFn, refreshFn, invalidateCache, deleteFileType,
  } = config;

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [files, setFiles] = useState<App[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [nameCardFile, setNameCardFile] = useState<App | null>(null);
  const [nameCardRect, setNameCardRect] = useState<DOMRect | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<App | null>(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [previewFile, setPreviewFile] = useState<App | null>(null);
  const [spaceFilter, setSpaceFilter] = useState<{ id: string; name: string } | null>(null);

  const { endTransition } = useRouteTransition();

  useEffect(() => {
    setIsAuthenticated(true);
    endTransition();
  }, []);

  const addToast = useCallback((t: ToastMessage['type'], text: string) => {
    const id = nextId();
    setToasts((prev) => [...prev, { id, type: t, text }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listFn();
      setFiles(data.files || []);
    } catch (err) {
      addToast('error', `获取${label}列表失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  }, [addToast, label, listFn]);

  useEffect(() => { if (isAuthenticated && files.length === 0) loadFiles(); }, [isAuthenticated]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setIsCreating(true);
    try {
      await createFn(newTitle.trim());
      setNewTitle('');
      setShowCreate(false);
      addToast('success', `已创建${label}「${newTitle.trim()}」`);
      invalidateCache();
      await loadFiles();
    } catch (err) {
      addToast('error', `创建失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const file = deleteTarget;
    setDeleteTarget(null);
    try {
      if (file.source === 'wiki') {
        await deleteWikiFile(file.space_id!, file.node_token!, file.obj_type!);
        invalidateWikiCaches();
      } else {
        await deleteFile(file.app_token, deleteFileType);
        invalidateCache();
      }
      addToast('success', `已删除「${getFileDisplayName(file)}」`);
      setFiles((prev) => prev.filter((f) =>
        f.source === 'wiki'
          ? f.node_token !== file.node_token
          : f.app_token !== file.app_token,
      ));
    } catch (err) {
      addToast('error', `删除失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const filtered = useMemo(() => {
    const base = spaceFilter
      ? files.filter((f) => f.space_id === spaceFilter.id)
      : files;
    return fuzzySort(base, getFileDisplayName, search);
  }, [files, search, spaceFilter]);

  const handleSort = useCallback((field: string) => {
    if (sortField === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  }, [sortField]);

  const sorted = useMemo(() => {
    if (!sortField) {
      if (!search) {
        return [...filtered].sort(
          (a, b) => new Date(b.update_time).getTime() - new Date(a.update_time).getTime(),
        );
      }
      return filtered;
    }
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = getFileDisplayName(a).localeCompare(getFileDisplayName(b));
          break;
        case 'creator':
          cmp = (a.creator_name || '').localeCompare(b.creator_name || '');
          break;
        case 'update_time':
          cmp = new Date(a.update_time).getTime() - new Date(b.update_time).getTime();
          break;
        case 'create_time':
          cmp = new Date(a.create_time).getTime() - new Date(b.create_time).getTime();
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortOrder, search]);

  // Tailwind JIT needs static class strings — use a static mapping.
  const colorStyles = {
    blue: {
      icon: 'text-blue-500',
      ring: 'focus:ring-blue-100 focus:border-blue-300',
      badge: 'bg-blue-50 text-blue-700 border border-blue-200',
      badgeHover: 'hover:bg-blue-200',
      btn: 'bg-blue-500 hover:bg-blue-600',
      linkHover: 'hover:text-blue-500',
      nameHover: 'hover:text-blue-700',
      createRing: 'focus:ring-blue-500/20 focus:border-blue-400',
      hoverBg: 'hover:bg-blue-50/30',
      rowHover: 'group-hover:text-blue-600',
      rowNameHover: 'text-blue-500 hover:text-blue-700',
    },
    green: {
      icon: 'text-green-500',
      ring: 'focus:ring-green-100 focus:border-green-300',
      badge: 'bg-green-50 text-green-700 border border-green-200',
      badgeHover: 'hover:bg-green-200',
      btn: 'bg-green-500 hover:bg-green-600',
      linkHover: 'hover:text-green-500',
      nameHover: 'hover:text-green-700',
      createRing: 'focus:ring-green-500/20 focus:border-green-400',
      hoverBg: 'hover:bg-green-50/30',
      rowHover: 'group-hover:text-green-600',
      rowNameHover: 'text-green-500 hover:text-green-700',
    },
  } as const;
  const s = colorStyles[color as keyof typeof colorStyles] ?? colorStyles.blue;

  return (
    <div className="flex flex-col h-full">
      <Toast messages={toasts} onDismiss={dismissToast} />

      <TopBar
        isAuthenticated={isAuthenticated} isLoading={isLoading}
        onFetchApps={async () => {
          setIsLoading(true);
          try {
            const data = await refreshFn(undefined, true);
            setFiles(data.files || []);
            addToast('success', `已同步 ${data.files?.length ?? 0} 个${label}`);
          } catch (err) {
            addToast('error', `同步${label}失败: ${err instanceof Error ? err.message : '未知错误'}`);
          } finally {
            setIsLoading(false);
          }
        }} onLogout={async () => { await apiLogout(); invalidateCache(); setFiles([]); window.location.replace('/'); }}
      >
        <nav className="flex items-center gap-1.5 text-base min-w-0" aria-label="Breadcrumb">
          <button
            onClick={() => { setPreviewFile(null); setSpaceFilter(null); }}
            className="flex items-center gap-2 font-semibold transition-colors flex-shrink-0"
            style={{ color: previewFile || spaceFilter ? 'var(--text-tertiary)' : 'var(--text)' }}
          >
            <Icon className={`w-5 h-5 ${s.icon}`} />
            {label}
          </button>
          {spaceFilter && !previewFile && (
            <>
              <ChevronRight className="w-4 h-4 text-neutral-300 flex-shrink-0" />
              <span className="font-semibold truncate max-w-[200px]" style={{ color: 'var(--text)' }}
                title={spaceFilter.name}>{spaceFilter.name}</span>
            </>
          )}
          {previewFile && (
            <>
              {previewFile.source === 'wiki' && previewFile.space_name && (
                <>
                  <ChevronRight className="w-4 h-4 text-neutral-300 flex-shrink-0" />
                  <button
                    onClick={() => { setSpaceFilter({ id: previewFile.space_id!, name: previewFile.space_name! }); setPreviewFile(null); }}
                    className="font-medium truncate max-w-[200px] transition-colors"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {previewFile.space_name}
                  </button>
                </>
              )}
              <ChevronRight className="w-4 h-4 text-neutral-300 flex-shrink-0" />
              <span className="font-semibold truncate max-w-[300px]" style={{ color: 'var(--text)' }}>
                {getFileDisplayName(previewFile)}
              </span>
            </>
          )}
        </nav>
      </TopBar>

      {previewFile ? (
        <iframe
          src={previewFile.url || ''}
          title={getFileDisplayName(previewFile)}
          className="flex-1 w-full border-0"
        />
      ) : (
        <>
          {/* Toolbar */}
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onCompositionUpdate={(e) => setSearch((e.target as HTMLInputElement).value)}
                    placeholder={`搜索${label}...`}
                    className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-neutral-200 bg-white focus:outline-none focus:ring-2 ${s.ring} placeholder:text-neutral-400`}
                  />
                </div>
                {spaceFilter && (
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full ${s.badge}`}>
                    <BookOpen className="w-3 h-3" />
                    {spaceFilter.name}
                    <button
                      onClick={() => setSpaceFilter(null)}
                      className={`ml-0.5 p-0.5 rounded-full ${s.badgeHover} transition-colors`}
                      title="清除过滤"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${s.btn}`}
              >
                <Plus className="w-4 h-4" />
                新建{label}
              </button>
            </div>
          </div>

          {/* File List */}
          <div className="flex-1 overflow-auto px-6 pb-6">
            {isLoading ? (
              <FileListSkeleton />
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-neutral-300">
                <Icon className="w-16 h-16 mb-4" />
                <p className="text-sm">{files.length === 0 ? `暂无${label}，点击上方按钮创建` : `没有匹配的${label}`}</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="sticky top-0 z-10 flex items-center h-10 px-5 gap-4 text-xs font-medium text-neutral-400 bg-neutral-50 border border-neutral-200 rounded-t-xl min-w-[780px]">
                  <button onClick={() => handleSort('name')} className="flex items-center flex-1 min-w-0 hover:text-neutral-600 transition-colors">
                    名称
                    {sortField === 'name' ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />) : <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />}
                  </button>
                  <button onClick={() => handleSort('creator')} className="flex items-center w-[140px] hover:text-neutral-600 transition-colors">
                    创建人
                    {sortField === 'creator' ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />) : <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />}
                  </button>
                  <span className="w-[140px]">位置</span>
                  <span className="w-[280px] hidden xl:block">链接</span>
                  <button onClick={() => handleSort('update_time')} className="flex items-center justify-end w-[130px] hover:text-neutral-600 transition-colors">
                    更新时间
                    {sortField === 'update_time' ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />) : <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />}
                  </button>
                  <button onClick={() => handleSort('create_time')} className="flex items-center justify-end w-[110px] hover:text-neutral-600 transition-colors">
                    创建时间
                    {sortField === 'create_time' ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />) : <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />}
                  </button>
                  <span className="w-[72px]" />
                </div>
                <div className="bg-white border-l border-r border-b border-neutral-200 rounded-b-xl">
                  {/* Rows */}
                  {sorted.map((file) => (
                    <div
                      key={file.app_token}
                      className={`flex items-center px-5 py-3 gap-4 border-b border-neutral-50 last:border-b-0 ${s.hoverBg} transition-colors group min-w-[780px]`}
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 ${s.icon} flex-shrink-0`} />
                        <button
                          type="button"
                          onClick={() => setPreviewFile(file)}
                          className={`text-sm font-medium text-neutral-800 truncate ${s.rowHover} transition-colors text-left`}
                        >
                          {getFileDisplayName(file)}
                        </button>
                      </div>
                      <div className="w-[140px] text-xs text-neutral-400 truncate flex-shrink-0">
                        {file.creator_name ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setNameCardRect((e.target as HTMLElement).getBoundingClientRect());
                              setNameCardFile(file);
                            }}
                            className={`${s.rowNameHover} cursor-pointer transition-colors`}
                          >
                            {file.creator_name}
                          </button>
                        ) : (
                          <span title={file.creator_id}>{file.creator_id || '—'}</span>
                        )}
                      </div>
                      <div className="w-[140px] flex-shrink-0">
                        {file.source === 'wiki' ? (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] leading-none text-neutral-400 truncate"
                            title={file.space_name || '文档库'}
                          >
                            <BookOpen className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{file.space_name || '文档库'}</span>
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] leading-none text-neutral-400 whitespace-nowrap"
                            title="来自云盘"
                          >
                            <HardDrive className="w-3 h-3" />
                            云盘
                          </span>
                        )}
                      </div>
                      <div className="w-[280px] hidden xl:flex items-center min-w-0">
                        {file.url ? (
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`text-xs text-neutral-400 ${s.linkHover} transition-colors truncate`}
                          >
                            {file.url}
                          </a>
                        ) : (
                          <span className="text-xs text-neutral-300">—</span>
                        )}
                      </div>
                      <div className="w-[130px] text-xs text-neutral-400 text-right flex-shrink-0">
                        {file.update_time && !Number.isNaN(new Date(file.update_time).getTime())
                          ? (() => {
                              const d = new Date(file.update_time);
                              const pad = (n: number) => String(n).padStart(2, '0');
                              return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
                            })()
                          : '—'}
                      </div>
                      <div className="w-[110px] text-xs text-neutral-400 text-right flex-shrink-0">
                        {file.create_time && !Number.isNaN(new Date(file.create_time).getTime())
                          ? (() => {
                              const d = new Date(file.create_time);
                              const pad = (n: number) => String(n).padStart(2, '0');
                              return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
                            })()
                          : '—'}
                      </div>
                      <div className="w-[72px] flex justify-end flex-shrink-0">
                        <button
                          onClick={() => setDeleteTarget(file)}
                          className="p-1.5 rounded-md text-neutral-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* NameCard Popover */}
      {nameCardFile && (
        <NameCard
          profile={nameCardFile.creator_profile}
          name={nameCardFile.creator_name || nameCardFile.creator_id || ''}
          anchorRect={nameCardRect}
          onFetchProfile={getUserProfile}
          onClose={() => setNameCardFile(null)}
        />
      )}

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.source === 'wiki' ? '删除知识库文件' : `删除${label}`}
        message={<>确定要删除 <span className="font-semibold text-neutral-800">「{deleteTarget ? getFileDisplayName(deleteTarget) : ''}」</span> 吗？此操作不可恢复。</>}
        confirmLabel="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowCreate(false)}>
          <div
            className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-neutral-900 mb-4">新建{label}</h2>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={`输入${label === '云文档' ? '文档' : '表格'}标题`}
              className={`w-full px-4 py-2.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 ${s.createRing} mb-4`}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowCreate(false); setNewTitle(''); }}
                className="px-4 py-2 text-sm font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || isCreating}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${s.btn}`}
              >
                {isCreating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
