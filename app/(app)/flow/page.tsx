'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bot, ArrowLeft } from 'lucide-react';
import type { App, ToastMessage } from '@/types';
import {
  listApps, refreshApps, invalidateAppsCache,
  listTables, listFields, createRecord, listRecords,
  updateRecord, deleteApiRecord,
  logout as apiLogout,
} from '@/lib/api';
import OAuthLogin from '@/app/components/OAuthLogin';
import WorkflowManager from '@/app/components/WorkflowManager';
import Toast from '@/app/components/Toast';
import Link from 'next/link';

export default function FlowPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [apps, setApps] = useState<App[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastMessage['type'], text: string) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, type, text }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
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
    invalidateAppsCache();
    setIsAuthenticated(false); setApps([]);
    addToast('info', '已退出登录');
  };

  const handleFetchApps = useCallback(() => {
    setIsLoading(true);
    refreshApps().then(({ data }) => {
      setApps(data.files || []);
      addToast('success', `获取到 ${data.files?.length ?? 0} 个多维表格`);
    }).catch((err) => addToast('error', `获取多维表格列表失败: ${err instanceof Error ? err.message : '未知错误'}`))
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
          <div className="flex items-center gap-2">
            <span
              className="w-7 h-7 rounded-md flex items-center justify-center"
              style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
            >
              <Bot className="w-4 h-4" />
            </span>
            <h1 className="text-sm font-semibold text-neutral-900">机器人指令</h1>
          </div>
          <span className="text-xs text-neutral-400">Webhook 自动化工作流配置</span>
        </div>

        <OAuthLogin
          isAuthenticated={isAuthenticated} oauthUrl="" isLoading={isLoading}
          onFetchApps={handleFetchApps} onLogout={handleLogout} hideLogin
        />
      </header>

      <div className="flex-1 overflow-auto">
        <div className="px-6 py-6">
          <WorkflowManager
            apps={apps}
            onListTables={handleListTablesForNode} onListFields={listFields}
            onCreateRecord={handleTemplateCreateRecord} onListRecords={handleTemplateListRecords}
            onUpdateRecord={handleTemplateUpdateRecord} onDeleteRecord={handleTemplateDeleteRecord}
          />
        </div>
      </div>
    </div>
  );
}
