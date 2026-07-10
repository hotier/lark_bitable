'use client';

import { useState } from 'react';
import { Table2, Folder } from 'lucide-react';
import type { App } from '@/types';

interface AppGridProps {
  apps: App[];
  selectedApp: App | null;
  isAuthenticated: boolean;
  isCreating: boolean;
  onSelectApp: (app: App) => void;
  onCreateApp: (name: string, folderToken?: string) => Promise<void>;
}

const ACCENT_COLORS = [
  'from-amber-500 to-neutral-500',
  'from-amber-500 to-pink-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-red-500',
  'from-cyan-500 to-sky-500',
];

const BITABLE_ICON = (
  <svg className="w-9 h-9" viewBox="0 0 36 36" fill="none">
    {/* 外框 */}
    <rect x="1" y="1" width="34" height="34" rx="6" fill="url(#bg)" stroke="#E2E8F0" strokeWidth="1.5" />
    {/* 表头行 */}
    <rect x="1" y="1" width="34" height="9" rx="6" fill="url(#header)" />
    <rect x="1" y="3" width="34" height="7" fill="url(#header)" />
    {/* 列分隔线 */}
    <line x1="12" y1="10" x2="12" y2="35" stroke="#E2E8F0" strokeWidth="1.2" />
    <line x1="24" y1="10" x2="24" y2="35" stroke="#E2E8F0" strokeWidth="1.2" />
    {/* 行分隔线 */}
    <line x1="1" y1="19" x2="35" y2="19" stroke="#E2E8F0" strokeWidth="1" />
    <line x1="1" y1="27" x2="35" y2="27" stroke="#E2E8F0" strokeWidth="1" />
    {/* 表头文字示意 */}
    <rect x="4" y="4.5" width="5" height="2" rx="1" fill="white" opacity="0.7" />
    <rect x="14" y="4.5" width="6" height="2" rx="1" fill="white" opacity="0.7" />
    <rect x="26" y="4.5" width="7" height="2" rx="1" fill="white" opacity="0.7" />
    {/* 数据行文字示意 */}
    <rect x="4" y="13.5" width="4" height="1.5" rx="0.75" fill="#CBD5E1" />
    <rect x="14" y="13.5" width="7" height="1.5" rx="0.75" fill="#CBD5E1" />
    <rect x="26" y="13.5" width="5" height="1.5" rx="0.75" fill="#CBD5E1" />
    <rect x="4" y="22" width="3" height="1.5" rx="0.75" fill="#CBD5E1" />
    <rect x="14" y="22" width="5" height="1.5" rx="0.75" fill="#CBD5E1" />
    <rect x="26" y="22" width="7" height="1.5" rx="0.75" fill="#CBD5E1" />
    {/* 渐变色定义 */}
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop stopColor="#EEF2FF" />
        <stop offset="1" stopColor="#F8FAFC" />
      </linearGradient>
      <linearGradient id="header" x1="0" y1="0" x2="36" y2="0" gradientUnits="userSpaceOnUse">
        <stop stopColor="#6366F1" />
        <stop offset="1" stopColor="#818CF8" />
      </linearGradient>
    </defs>
  </svg>
);

function EmptyState({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-amber-100 to-amber-100 flex items-center justify-center mb-6 shadow-inner">
        <svg className="w-12 h-12 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-neutral-700 mb-2">暂无多维表格</h3>
      <p className="text-sm text-neutral-400 max-w-sm text-center">
        {isAuthenticated
          ? '点击「新建」创建多维表格，或点击顶部「已连接」获取已有列表'
          : '请先使用飞书账号进行授权登录'}
      </p>
    </div>
  );
}

/** ====== 创建多维表格弹窗 ====== */
function CreateAppModal({
  isOpen,
  isCreating,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  isCreating: boolean;
  onClose: () => void;
  onCreate: (name: string, folderToken?: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [folderToken, setFolderToken] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入多维表格名称');
      return;
    }
    if (trimmed.length > 100) {
      setError('名称不能超过100个字符');
      return;
    }
    try {
      setError('');
      await onCreate(trimmed, folderToken.trim() || undefined);
      setName('');
      setFolderToken('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      {/* 弹窗卡片 */}
      <div className="relative bg-white rounded-lg shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
        {/* 渐变头部 */}
        <div className="bg-gradient-to-r bg-amber-600 px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-white/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">创建多维表格</h2>
                <p className="text-xs text-white/70">在飞书云空间中新建一个多维表格应用</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isCreating}
              className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors flex items-center justify-center disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* 名称输入 */}
          <div>
            <label className="block text-sm font-semibold text-neutral-700 mb-2">
              多维表格名称 <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Table2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(''); }}
                placeholder="例如：项目管理、客户跟进表..."
                maxLength={100}
                autoFocus
                className="w-full pl-10 pr-4 py-3 text-sm border border-neutral-200 rounded-md focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all placeholder:text-neutral-300"
              />
            </div>
          </div>

          {/* 文件夹（可选） */}
          <div>
            <label className="block text-sm font-semibold text-neutral-700 mb-2">
              目标文件夹 Token <span className="text-neutral-400 text-xs font-normal">（可选）</span>
            </label>
            <div className="relative">
              <Folder className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
              <input
                type="text"
                value={folderToken}
                onChange={(e) => setFolderToken(e.target.value)}
                placeholder="留空则创建在根目录"
                className="w-full pl-10 pr-4 py-3 text-sm border border-neutral-200 rounded-md focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all placeholder:text-neutral-300 font-mono"
              />
            </div>
            <p className="text-xs text-neutral-400 mt-1.5 ml-1">
              可在多维表格卡片的「Token」信息中复制文件夹 token
            </p>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-rose-600 bg-rose-50 px-4 py-3 rounded-md animate-shake">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          {/* 按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="flex-1 px-4 py-3 text-sm font-semibold text-neutral-600 bg-neutral-100 rounded-md hover:bg-neutral-200 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isCreating || !name.trim()}
              className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r bg-amber-600 rounded-md hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all  flex items-center justify-center gap-2"
            >
              {isCreating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  创建中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  创建
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AppGrid({
  apps,
  selectedApp,
  isAuthenticated,
  isCreating,
  onSelectApp,
  onCreateApp,
}: AppGridProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-neutral-800 flex items-center gap-2">
          <Table2 className="w-5 h-5" />
          多维表格列表
          <span className="text-sm font-normal text-neutral-400 bg-neutral-100 px-2.5 py-0.5 rounded-full">
            {apps.length}
          </span>
        </h2>

        {isAuthenticated && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-all duration-300 font-semibold text-sm  hover:-translate-y-0.5 active:translate-y-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            新建
          </button>
        )}
      </div>

      {apps.length === 0 ? (
        <EmptyState isAuthenticated={isAuthenticated} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
          {apps.map((app, index) => {
            const isSelected = selectedApp?.app_token === app.app_token;
            const accent = ACCENT_COLORS[index % ACCENT_COLORS.length];

            return (
              <div
                key={app.app_token}
                onClick={() => onSelectApp(app)}
                className={`group relative bg-white rounded-lg border cursor-pointer transition-all duration-300 overflow-hidden ${
                  isSelected
                    ? 'border-amber-300 shadow-lg shadow-amber-100/50 ring-2 ring-amber-100'
                    : 'border-neutral-100 shadow-sm hover:shadow-xl hover:shadow-neutral-200/50 hover:-translate-y-1 hover:border-neutral-200'
                }`}
              >
                {/* 顶部色条 */}
                <div className={`h-1.5 bg-gradient-to-r ${accent}`} />

                <div className="p-5">
                  {/* 多维表格图标 */}
                  <div className="flex items-start justify-between mb-4">
                    {BITABLE_ICON}
                    {isSelected && (
                      <span className="flex items-center gap-1 text-xs font-medium text-amber-500 bg-amber-50 px-2 py-1 rounded-full">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        已选中
                      </span>
                    )}
                  </div>

                  {/* 标题 */}
                  <h3 className="font-bold text-neutral-800 text-base mb-2 truncate group-hover:text-amber-600 transition-colors">
                    {app.name}
                  </h3>

                  {/* URL */}
                  {app.url && (
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 mt-1.5 mb-3 text-xs text-neutral-400 hover:text-amber-500 transition-colors truncate"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      <span className="truncate">{app.url}</span>
                    </a>
                  )}

                  {/* 底部信息 */}
                  <div className="flex items-center justify-between pt-3 border-t border-neutral-50">
                    <span className="text-xs text-neutral-400">
                      {app.create_time && !Number.isNaN(new Date(app.create_time).getTime())
                        ? new Date(app.create_time).toLocaleDateString('zh-CN', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                    </span>
                    <span className="text-xs font-medium text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                      选择表格
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 创建弹窗 */}
      <CreateAppModal
        isOpen={showCreateModal}
        isCreating={isCreating}
        onClose={() => setShowCreateModal(false)}
        onCreate={onCreateApp}
      />
    </div>
  );
}
