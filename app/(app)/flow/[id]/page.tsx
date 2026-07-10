'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { Zap, ArrowLeft } from 'lucide-react';
import type { App, ToastMessage, Workflow } from '@/types';
import {
  listApps, listTables, listFields,
  refreshApps, invalidateAppsCache,
  logout as apiLogout,
} from '@/lib/api';
import OAuthLogin from '@/app/components/OAuthLogin';
import WorkflowCanvas from '@/app/components/workflow-editor/WorkflowCanvas';

import Toast from '@/app/components/Toast';
import { useWorkflowEditorStore } from '@/lib/workflow-engine/editor-store';
import { GuardedLink, useNavigationGuard } from '@/app/components/NavigationGuard';

const STORAGE_KEY = 'bitable_workflows';

function loadWorkflowsFromStorage(): Workflow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveWorkflowsToStorage(workflows: Workflow[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
}

export default function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [apps, setApps] = useState<App[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [workflow, setWorkflow] = useState<Workflow | null | undefined>(undefined);


  const addToast = useCallback((type: ToastMessage['type'], text: string) => {
    const tid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id: tid, type, text }]);
  }, []);
  const dismissToast = useCallback((tid: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== tid));
  }, []);

  // 监听全局 toast 事件（供深层子组件如配置面板触发）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ type: ToastMessage['type']; text: string }>).detail;
      if (detail) addToast(detail.type, detail.text);
    };
    window.addEventListener('app:toast', handler);
    return () => window.removeEventListener('app:toast', handler);
  }, [addToast]);

  useEffect(() => { setIsAuthenticated(true); }, []);

  useEffect(() => {
    if (isAuthenticated && apps.length === 0) {
      setIsLoading(true);
      listApps().then(({ data }) => { setApps(data.files || []); })
        .catch((err) => addToast('error', `获取多维表格列表失败: ${err instanceof Error ? err.message : '未知错误'}`))
        .finally(() => setIsLoading(false));
    }
  }, [isAuthenticated, apps.length]);

  // 加载目标工作流
  useEffect(() => {
    const stored = loadWorkflowsFromStorage();
    const found = stored.find((w) => w.id === id);
    if (found) { setWorkflow(found); return; }

    fetch('/api/workflows').then((r) => r.json())
      .then((data) => setWorkflow((data.workflows as Workflow[])?.find((w) => w.id === id) || null))
      .catch(() => setWorkflow(null));
  }, [id]);

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

  const handleSave = useCallback(async (wf: Workflow) => {
    const existing = loadWorkflowsFromStorage();
    const idx = existing.findIndex((w) => w.id === wf.id);
    if (idx >= 0) { existing[idx] = wf; } else { existing.push(wf); }
    saveWorkflowsToStorage(existing);

    await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflows: existing }),
    });
    // 保存成功后清除未保存标记，避免离开时重复提示
    useWorkflowEditorStore.getState().markSaved();
  }, []);

  const { registerSaveHandler, registerDiscardHandler } = useNavigationGuard();

  // 将本页保存逻辑注册给导航守卫，供弹窗「保存」调用
  useEffect(() => {
    registerSaveHandler(handleSave);
    return () => registerSaveHandler(null);
  }, [registerSaveHandler, handleSave]);


  // 将「恢复未更改状态」逻辑注册给导航守卫，供弹窗「取消」时调用
  useEffect(() => {
    registerDiscardHandler(() => {
      const stored = loadWorkflowsFromStorage();
      const found = stored.find((w) => w.id === id);
      if (found) useWorkflowEditorStore.getState().setWorkflow(found);
    });
    return () => registerDiscardHandler(null);
  }, [registerDiscardHandler, id]);

  return (
    <div className="flex flex-col h-full">
      <Toast messages={toasts} onDismiss={dismissToast} />

      <header
        className="sticky top-0 z-20 flex items-center justify-between h-14 px-6 flex-shrink-0"
        style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
        <GuardedLink
          href="/flow"
          className="flex items-center gap-1.5 text-sm font-medium text-neutral-400 hover:text-neutral-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          工作流
        </GuardedLink>
          <span className="text-neutral-300">/</span>
          <span className="w-6 h-6 rounded flex items-center justify-center"
            style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
            <Zap className="w-3.5 h-3.5" />
          </span>
          <span className="text-sm font-semibold text-neutral-900">流程详情</span>
        </div>
        <OAuthLogin
          isAuthenticated={isAuthenticated} oauthUrl="" isLoading={isLoading}
          onFetchApps={handleFetchApps} onLogout={handleLogout}
        />
      </header>

      <div className="flex-1 min-h-0 flex flex-col">
        {workflow === undefined ? (
          <div className="flex items-center justify-center h-full text-neutral-400">加载中...</div>
        ) : workflow === null ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-400">
            <svg className="w-16 h-16 mb-4 text-neutral-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <p className="text-base font-medium">工作流未找到</p>
            <GuardedLink href="/flow" className="text-sm text-blue-500 mt-2 hover:underline">返回列表</GuardedLink>
          </div>
        ) : !isAuthenticated ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-400">
            <svg className="w-16 h-16 mb-4 text-neutral-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <p className="text-base font-medium">请先使用飞书账号进行授权登录</p>
            <p className="text-sm mt-1">登录后可编辑工作流配置</p>
          </div>
        ) : (
          <WorkflowCanvas
            apps={apps}
            workflow={workflow}
            onListTables={handleListTablesForNode}
            onListFields={listFields}
            onSave={handleSave}
          />
        )}
      </div>
    </div>
  );
}
