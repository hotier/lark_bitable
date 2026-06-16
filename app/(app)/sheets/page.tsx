'use client';

import { useState, useEffect, useCallback } from 'react';
import { Grid3X3, Plus, Trash2 } from 'lucide-react';
import type { App, ToastMessage } from '@/types';
import {
  listSheets, createSheet, deleteFile,
  logout as apiLogout,
} from '@/lib/api';
import OAuthLogin from '@/app/components/OAuthLogin';
import Toast from '@/app/components/Toast';
import NameCard from '@/app/components/NameCard';
import ConfirmDialog from '@/app/components/ConfirmDialog';

let toastId = 0;
function nextId() { return `t${++toastId}`; }

export default function SheetsPage() {
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

  useEffect(() => {
    setIsAuthenticated(true); // AuthGuard 已验证
  }, []);

  const addToast = useCallback((type: ToastMessage['type'], text: string) => {
    const id = nextId();
    setToasts((prev) => [...prev, { id, type, text }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listSheets();
      setFiles(data.files || []);
    } catch (err) {
      addToast('error', `获取在线表格列表失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => { if (isAuthenticated && files.length === 0) loadFiles(); }, [isAuthenticated]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setIsCreating(true);
    try {
      await createSheet(newTitle.trim());
      setNewTitle('');
      setShowCreate(false);
      addToast('success', `已创建在线表格「${newTitle.trim()}」`);
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
      await deleteFile(file.app_token, 'sheet');
      addToast('success', `已删除「${file.name}」`);
      setFiles((prev) => prev.filter((f) => f.app_token !== file.app_token));
    } catch (err) {
      addToast('error', `删除失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <Toast messages={toasts} onDismiss={dismissToast} />

      <header
        className="sticky top-0 z-20 flex items-center justify-between h-14 px-6 flex-shrink-0"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <Grid3X3 className="w-5 h-5 text-green-500" />
          <h1 className="text-base font-semibold text-neutral-900">在线表格管理</h1>
        </div>
        <div className="flex items-center gap-3">
          <OAuthLogin
            isAuthenticated={isAuthenticated} oauthUrl="" isLoading={isLoading}
            onFetchApps={loadFiles} onLogout={async () => { await apiLogout(); setFiles([]); window.location.replace('/'); }} hideLogin
          />
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="px-6 py-6 space-y-6">
          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-400">
              {files.length > 0 ? `共 ${files.length} 个在线表格` : '暂无在线表格'}
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              新建在线表格
            </button>
          </div>

          {/* File List */}
          {isLoading ? (
            <div className="rounded-xl bg-white border border-neutral-200 overflow-hidden animate-pulse">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-14 border-b border-neutral-50 last:border-b-0" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-neutral-300">
              <Grid3X3 className="w-16 h-16 mb-4" />
              <p className="text-sm">暂无在线表格，点击上方按钮创建</p>
            </div>
          ) : (
            <div className="rounded-xl bg-white border border-neutral-200 overflow-hidden">
              {/* Header */}
              <div className="flex items-center h-10 px-5 gap-4 text-xs font-medium text-neutral-400 bg-neutral-50 border-b border-neutral-100">
                <span className="flex-1 min-w-0">名称</span>
                <span className="w-[140px]">创建人</span>
                <span className="w-[280px] hidden xl:block">链接</span>
                <span className="w-[110px] text-right">创建时间</span>
                <span className="w-[72px]" />
              </div>
              {/* Rows */}
              {files.map((file) => (
                <div
                  key={file.app_token}
                  className="flex items-center px-5 py-3 gap-4 border-b border-neutral-50 last:border-b-0 hover:bg-green-50/30 transition-colors group"
                >
                  <div className="flex-1 min-w-0 flex items-center gap-2.5">
                    <Grid3X3 className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <a
                      href={file.url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-neutral-800 truncate group-hover:text-green-600 transition-colors"
                    >
                      {file.name}
                    </a>
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
                        className="text-green-500 hover:text-green-700 cursor-pointer transition-colors"
                      >
                        {file.creator_name}
                      </button>
                    ) : (
                      <span title={file.creator_id}>{file.creator_id || '—'}</span>
                    )}
                  </div>
                  <div className="w-[280px] hidden xl:flex items-center min-w-0">
                    {file.url ? (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-neutral-400 hover:text-green-500 transition-colors truncate"
                      >
                        {file.url}
                      </a>
                    ) : (
                      <span className="text-xs text-neutral-300">—</span>
                    )}
                  </div>
                  <div className="w-[110px] text-xs text-neutral-400 text-right flex-shrink-0">
                    {file.create_time && !Number.isNaN(new Date(file.create_time).getTime())
                      ? new Date(file.create_time).toLocaleDateString('zh-CN', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })
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
          )}
        </div>
      </div>

      {/* NameCard Popover */}
      {nameCardFile && (
        <NameCard
          profile={nameCardFile.creator_profile}
          name={nameCardFile.creator_name || nameCardFile.creator_id || ''}
          anchorRect={nameCardRect}
          onClose={() => setNameCardFile(null)}
        />
      )}

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除在线表格"
        message={<>确定要删除 <span className="font-semibold text-neutral-800">「{deleteTarget?.name}」</span> 吗？此操作不可恢复。</>}
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
            <h2 className="text-lg font-semibold text-neutral-900 mb-4">新建在线表格</h2>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="输入表格标题"
              className="w-full px-4 py-2.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 mb-4"
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
                className="px-4 py-2 text-sm font-medium text-white bg-green-500 rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
