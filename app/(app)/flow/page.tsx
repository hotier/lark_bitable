'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Workflow as WorkflowIcon, Plus, Trash2, Clock, Layers, Search } from 'lucide-react';
import type { Workflow, WorkflowSummary } from '@/types';
import { idGen } from '@/lib/workflow-engine/editor-store';
import Toast from '@/app/components/Toast';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import TopBar from '@/app/components/TopBar';
import { logout as apiLogout } from '@/lib/api';

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

export default function FlowPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: string; type: 'info' | 'success' | 'error'; text: string }[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  const addToast = useCallback((type: 'info' | 'success' | 'error', text: string) => {
    const tid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id: tid, type, text }]);
  }, []);

  const dismissToast = useCallback((tid: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== tid));
  }, []);

  // 加载工作流
  useEffect(() => {
    const local = loadWorkflowsFromStorage();
    if (local.length > 0) {
      setWorkflows(local);
      setIsLoading(false);
    }

    // 从服务端同步（列表端点：轻量摘要，不含 nodes）
    fetch('/api/workflows/list')
      .then((r) => r.json())
      .then((data) => {
        const serverList = (data.workflows as WorkflowSummary[]) || [];
        if (serverList.length === 0) return;

        // 合并：以 updatedAt 较新者为准，避免服务端陈旧数据覆盖本地刚保存的修改
        const localMap = new Map(local.map((w) => [w.id, w]));
        const merged: Workflow[] = serverList.map((s) => {
          const l = localMap.get(s.id);
          if (l && new Date(l.updatedAt).getTime() > new Date(s.updatedAt).getTime()) return l;
          // server 较新：用摘要字段，nodes 回退到本地（若有）
          return {
            id: s.id,
            name: s.name,
            status: s.status,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            nodes: l?.nodes ?? [],
            nodeCount: s.nodeCount,
          };
        });
        // 保留仅存在于本地的工作流
        for (const w of local) {
          if (!merged.some((m) => m.id === w.id)) merged.push(w);
        }

        setWorkflows(merged);
        saveWorkflowsToStorage(merged);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  // 认证状态（AuthGuard 已校验，这里仅用于渲染账户控件）
  useEffect(() => { setIsAuthenticated(true); }, []);

  // 顶部「已连接飞书」按钮：从服务端重新同步工作流
  const handleSync = useCallback(async () => {
    setAuthLoading(true);
    try {
    const r = await fetch('/api/workflows/list');
    const data = await r.json();
    const serverList = (data.workflows as WorkflowSummary[]) || [];
    setWorkflows((prev) => {
      const localMap = new Map(prev.map((w) => [w.id, w]));
      const merged: Workflow[] = serverList.map((s) => {
        const l = localMap.get(s.id);
        if (l && new Date(l.updatedAt).getTime() > new Date(s.updatedAt).getTime()) return l;
        return {
          id: s.id,
          name: s.name,
          status: s.status,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          nodes: l?.nodes ?? [],
          nodeCount: s.nodeCount,
        };
      });
      for (const w of prev) {
        if (!merged.some((m) => m.id === w.id)) merged.push(w);
      }
      saveWorkflowsToStorage(merged);
      return merged;
    });
    } catch {
      addToast('error', '同步工作流失败');
    } finally {
      setAuthLoading(false);
    }
  }, [addToast]);

  const handleLogout = useCallback(async () => {
    await apiLogout();
    window.location.replace('/');
  }, []);

  // 新建工作流
  const handleCreate = useCallback(() => {
    const id = idGen();
    const now = new Date().toISOString();
    const newWf: Workflow = { id, name: '未命名工作流', nodes: [], status: 'draft', createdAt: now, updatedAt: now };

    const updated = [newWf, ...workflows];
    setWorkflows(updated);
    saveWorkflowsToStorage(updated);

    // 同步到服务端
    fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflows: updated }),
    }).catch(() => {});

    router.push(`/flow/${id}`);
  }, [workflows, router]);

  // 删除工作流（触发确认弹窗）
  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmId(id);
  }, []);

  const confirmDeleteWorkflow = useCallback(() => {
    if (!deleteConfirmId) return;
    const updated = workflows.filter((w) => w.id !== deleteConfirmId);
    setWorkflows(updated);
    saveWorkflowsToStorage(updated);

    fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflows: updated }),
    }).catch(() => {});

    setDeleteConfirmId(null);
    addToast('success', '工作流已删除');
  }, [deleteConfirmId, workflows, addToast]);

  const cancelDeleteWorkflow = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  // 启停切换：仅修改工作流运行状态，与编辑/保存结构无关，立即持久化
  const handleToggleStatus = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = workflows.map((w) =>
      w.id === id
        ? { ...w, status: (w.status === 'enabled' ? 'disabled' : 'enabled') as Workflow['status'], updatedAt: new Date().toISOString() }
        : w,
    );
    setWorkflows(updated);
    saveWorkflowsToStorage(updated);
    fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflows: updated }),
    }).catch(() => {});
  }, [workflows]);



  // 过滤
  const filtered = search
    ? workflows.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()))
    : workflows;

  // 时间格式化
  const fmtDate = (s: string) => {
    try {
      const d = new Date(s);
      return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return s; }
  };



  return (
    <div className="flex flex-col h-full">
      <Toast messages={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <TopBar
        isAuthenticated={isAuthenticated} isLoading={authLoading}
        onFetchApps={handleSync} onLogout={handleLogout}
      >
        <div className="flex items-center gap-3">
          <WorkflowIcon className="w-5 h-5 text-violet-500" />
          <h1 className="text-base font-semibold text-neutral-900">工作流</h1>
        </div>
      </TopBar>

      {/* 操作栏：搜索框 + 新建工作流（同一行，靠右） */}
      <div className="flex items-center justify-between gap-3 px-6 py-6">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索工作流..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-neutral-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder:text-neutral-400"
          />
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors bg-violet-500 hover:bg-violet-600"
        >
          <Plus className="w-4 h-4" />
          新建工作流
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-neutral-400 text-sm">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-neutral-400">
            <WorkflowIcon className="w-12 h-12 mb-3 text-neutral-200" />
            {workflows.length === 0 ? (
              <>
                <p className="text-sm font-medium">暂无工作流</p>
                <p className="text-xs mt-1">点击"新建工作流"创建第一个自动化流程</p>
              </>
            ) : (
              <p className="text-sm">没有匹配的工作流</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((wf) => (
              <div
                key={wf.id}
                onClick={() => router.push(`/flow/${wf.id}`)}
                className="group relative rounded-xl border border-neutral-200 bg-white p-4 cursor-pointer hover:shadow-md hover:border-neutral-300 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 mr-2">
                    <h3 className="text-sm font-semibold text-neutral-900 truncate">{wf.name}</h3>
                  </div>
                  <button
                    onClick={(e) => handleToggleStatus(wf.id, e)}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                      wf.status === 'enabled' ? 'bg-emerald-500' : 'bg-neutral-300'
                    }`}
                    title={wf.status === 'enabled' ? '点击停止运行' : '点击启动运行'}
                    aria-label={wf.status === 'enabled' ? '停止' : '启动'}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                      wf.status === 'enabled' ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`} />
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs text-neutral-400 mb-3">
                  <span className="flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    {wf.nodeCount ?? wf.nodes.length} 节点
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-neutral-400 truncate flex-1 mr-2 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {fmtDate(wf.updatedAt)}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleDelete(wf.id, e)}
                      className="p-1 rounded-md text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={deleteConfirmId !== null}
        title="删除工作流"
        message={<>确定要删除工作流 <span className="font-semibold text-neutral-800">「{workflows.find((w) => w.id === deleteConfirmId)?.name}」</span> 吗？此操作不可恢复。</>}
        confirmLabel="删除"
        onConfirm={confirmDeleteWorkflow}
        onCancel={cancelDeleteWorkflow}
      />
    </div>
  );
}
