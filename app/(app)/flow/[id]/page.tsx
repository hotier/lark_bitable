'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { Zap, ArrowLeft } from 'lucide-react';
import type { App, ToastMessage } from '@/types';
import {
  listApps, listTables, listFields, createRecord, listRecords,
  updateRecord, deleteApiRecord, refreshApps, invalidateAppsCache,
  logout as apiLogout,
} from '@/lib/api';
import OAuthLogin from '@/app/components/OAuthLogin';
import WorkflowManager from '@/app/components/WorkflowManager';
import Toast from '@/app/components/Toast';
import Link from 'next/link';

export default function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [apps, setApps] = useState<App[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastMessage['type'], text: string) => {
    const tid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id: tid, type, text }]);
  }, []);
  const dismissToast = useCallback((tid: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== tid));
  }, []);

  useEffect(() => {
    setIsAuthenticated(true); // AuthGuard 已验证
  }, []);

  useEffect(() => {
    if (isAuthenticated && apps.length === 0) {
      setIsLoading(true);
      listApps().then(({ data }) => { setApps(data.files || []); })
        .catch((err) => addToast('error', `获取多维表格列表失败: ${err instanceof Error ? err.message : '未知错误'}`))
        .finally(() => setIsLoading(false));
    }
  }, [isAuthenticated, apps.length]);

  const handleLogout = async () => {
    await apiLogout();
    invalidateAppsCache(); setIsAuthenticated(false); setApps([]);
  };

  const handleFetchApps = useCallback(() => {
    setIsLoading(true);
    refreshApps().then(({ data }) => { setApps(data.files || []); addToast('success', `获取到 ${data.files?.length ?? 0} 个多维表格`); })
      .catch((err) => addToast('error', `获取多维表格列表失败: ${err instanceof Error ? err.message : '未知错误'}`))
      .finally(() => setIsLoading(false));
  }, []);

  const handleListTablesForNode = useCallback(async (appToken: string) => {
    const data = await listTables(appToken); return data.items || [];
  }, []);

  const handleTemplateCreateRecord = useCallback(async (appToken: string, tableId: string, fields: Record<string, unknown>) => {
    return await createRecord(appToken, tableId, fields);
  }, []);
  const handleTemplateListRecords = useCallback(async (appToken: string, tableId: string) => {
    const data = await listRecords(appToken, tableId); return data.records || [];
  }, []);
  const handleTemplateUpdateRecord = useCallback(async (appToken: string, tableId: string, recordId: string, fields: Record<string, unknown>) => {
    return await updateRecord(appToken, tableId, recordId, fields);
  }, []);
  const handleTemplateDeleteRecord = useCallback(async (appToken: string, tableId: string, recordId: string) => {
    return await deleteApiRecord(appToken, tableId, recordId);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <Toast messages={toasts} onDismiss={dismissToast} />

      {/* Top Bar */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between h-14 px-6 flex-shrink-0"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <Link
            href="/flow"
            className="flex items-center gap-1.5 text-sm font-medium text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            机器人指令
          </Link>
          <span className="text-neutral-300">/</span>
          <span
            className="w-6 h-6 rounded flex items-center justify-center"
            style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
          >
            <Zap className="w-3.5 h-3.5" />
          </span>
          <span className="text-sm font-semibold text-neutral-900">流程详情</span>
        </div>

        <OAuthLogin
          isAuthenticated={isAuthenticated} oauthUrl="" isLoading={isLoading}
          onFetchApps={handleFetchApps} onLogout={handleLogout}
        />
      </header>

      <div className="flex-1 overflow-auto">
        <div className="px-6 py-6">
          {!isAuthenticated ? (
            <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
              <svg className="w-16 h-16 mb-4 text-neutral-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <p className="text-base font-medium">请先使用飞书账号进行授权登录</p>
              <p className="text-sm mt-1">登录后可编辑工作流配置</p>
            </div>
          ) : (
            <WorkflowManager
              apps={apps} onListTables={handleListTablesForNode} onListFields={listFields}
              onCreateRecord={handleTemplateCreateRecord} onListRecords={handleTemplateListRecords}
              onUpdateRecord={handleTemplateUpdateRecord} onDeleteRecord={handleTemplateDeleteRecord}
              targetWorkflowId={id}
            />
          )}
        </div>
      </div>
    </div>
  );
}
