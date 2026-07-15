'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Workflow as WorkflowIcon, Plus, Trash2, Clock, Layers, Search } from 'lucide-react';
import type { Workflow } from '@/types';
import { idGen } from '@/lib/workflow-engine/editor-store';
import Toast from '@/app/components/Toast';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import TopBar from '@/app/components/TopBar';
import LoadingScreen from '@/app/components/LoadingScreen';
import { useRouteTransition } from '@/app/components/RouteTransition';
import { logout as apiLogout } from '@/lib/api';
import {
  loadLocalWorkflows,
  saveLocalWorkflows,
  computeSync,
  fetchServerWorkflows,
} from '@/lib/workflow-sync';

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

  // 双向同步：从服务端拉取合并（pull），并把本地独有/较新的变更推回（push），
  // 使数据库成为跨设备中枢（覆盖离线创建、上次 POST 静默失败等情况）。
  // 基线直接读持久化的 localStorage（本页所有变更都会即时写回，故它即真相源），
  // 避免依赖可能滞后的 React state，也规避 StrictMode 下的副作用重复。
  const runSync = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? true;
    if (!silent) setAuthLoading(true);
    try {
      const { workflows: serverWfs, deletedIds } = await fetchServerWorkflows();
      const local = loadLocalWorkflows();
      const { merged, push } = computeSync(local, serverWfs, deletedIds);
      if (push.length > 0) {
        fetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflows: push }),
        }).catch(() => {}); // 上行失败不阻塞，下次同步重试（UPSERT 幂等）
      }
      saveLocalWorkflows(merged);
      setWorkflows(merged);
      if (!silent) addToast('success', '已与服务端同步');
    } catch {
      if (!silent) addToast('error', '同步工作流失败');
    } finally {
      if (!silent) setAuthLoading(false);
      setIsLoading(false);
    }
  }, [addToast]);

  // 首次加载：先用本地瞬时渲染，再双向同步
  useEffect(() => {
    const local = loadLocalWorkflows();
    if (local.length > 0) {
      setWorkflows(local);
      setIsLoading(false);
    }
    runSync({ silent: true });
  }, [runSync]);

  // 后台静默对账：标签页重新可见 / 窗口聚焦时，非阻塞地双向同步，
  // 使其他设备/标签的改动反映到本视图，同时把本机本地变更推回数据库。
  useEffect(() => {
    let lastSync = 0;
    const sync = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastSync < 10_000) return; // 节流，避免频繁导航造成请求风暴
      lastSync = now;
      runSync({ silent: true });
    };
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, [runSync]);

  const { endTransition } = useRouteTransition();

  // 认证状态（AuthGuard 已校验，这里仅用于渲染账户控件）
  useEffect(() => {
    setIsAuthenticated(true);
    endTransition(); // 结束从首页进入的过渡动画
  }, []);

  // 顶部「已连接飞书」按钮：手动双向同步
  const handleSync = useCallback(() => {
    return runSync({ silent: false });
  }, [runSync]);

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
    saveLocalWorkflows(updated);

    // 同步到服务端（增量：只上行新增项，不触碰其他记录）
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
    saveLocalWorkflows(updated);

    // 增量同步：上行剩余项，并显式标记被删 id（写入墓碑，跨设备传播）
    fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflows: updated, deletedIds: [deleteConfirmId] }),
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
    saveLocalWorkflows(updated);
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
          <WorkflowIcon className="w-5 h-5 text-emerald-500" />
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
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors bg-emerald-500 hover:bg-emerald-600"
        >
          <Plus className="w-4 h-4" />
          新建工作流
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-8">
        {isLoading ? (
          <LoadingScreen accent="emerald" fullScreen={false} label="Lark Workspace" />
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
