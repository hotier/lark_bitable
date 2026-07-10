'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, Search, CheckCircle2, XCircle, Clock, Activity,
  Calendar, Timer, TrendingUp, ChevronDown, Inbox,
} from 'lucide-react';
import type { Execution } from '@/types';
import { fetchExecutions, fetchExecutionById } from '@/lib/executions';
import ExecutionDetail from './ExecutionDetail';
import { CustomSelect } from '@/app/components/CustomSelect';

const PAGE_SIZE = 50;

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function isWithin(iso: string, range: 'all' | 'today' | '7d' | '14d' | '30d'): boolean {
  if (range === 'all') return true;
  const t = new Date(iso).getTime();
  const now = Date.now();
  if (range === 'today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return t >= start.getTime();
  }
  const days = range === '7d' ? 7 : range === '14d' ? 14 : 30;
  return t >= now - days * 24 * 60 * 60 * 1000;
}

function StatCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent: string;
}) {
  return (
    <div className="flex-1 rounded-xl border border-neutral-200 bg-white px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${accent}1a`, color: accent }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-lg font-semibold text-neutral-900 leading-tight">{value}</div>
        <div className="text-[11px] text-neutral-400 truncate">{label}{sub ? ` · ${sub}` : ''}</div>
      </div>
    </div>
  );
}

export default function ExecutionList({ workflowId, compact = false }: { workflowId?: string; compact?: boolean }) {
  const [all, setAll] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failure'>('all');
  const [timeRange, setTimeRange] = useState<'all' | 'today' | '7d' | '14d' | '30d'>('all');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selected, setSelected] = useState<Execution | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 点击列表项：先用摘要立即打开，再按需拉取完整 steps / request_summary
  const openDetail = useCallback(async (summary: Execution) => {
    setSelected(summary);
    setDetailLoading(true);
    try {
      const full = await fetchExecutionById(summary.id);
      setSelected(full);
    } catch {
      // 拉取失败时保留摘要（steps 为空），由详情组件提示
    } finally {
      setDetailLoading(false);
    }
  }, []);
  const reqId = useRef(0);

  const load = useCallback(async (forceRefresh: boolean) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchExecutions({ workflowId, limit: 500, refresh: forceRefresh });
      if (id !== reqId.current) return; // 忽略过期请求
      setAll(res.executions);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    load(false);
  }, [load]);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => load(true), 5000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  // 统计（基于完整集合，不受状态/时间筛选影响）
  const total = all.length;
  const successCount = all.filter((e) => e.status === 'success').length;
  const failureCount = all.filter((e) => e.status === 'failure').length;
  const successRate = total === 0 ? 0 : Math.round((successCount / total) * 100);
  const todayCount = all.filter((e) => isWithin(e.triggerTime, 'today')).length;
  const avgDuration = total === 0 ? 0 : Math.round(all.reduce((s, e) => s + (e.durationMs || 0), 0) / total);

  // 列表筛选
  const filtered = all.filter((e) => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false;
    if (!isWithin(e.triggerTime, timeRange)) return false;
    if (search && !e.workflowName.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="flex flex-col h-full">
      {/* 统计卡片 */}
      {!compact && (
        <div className="flex gap-3 px-6 py-4 flex-shrink-0">
          <StatCard icon={<Activity className="w-4 h-4" />} label="总运行" value={String(total)} accent="#d97706" />
          <StatCard icon={<TrendingUp className="w-4 h-4" />} label="成功率" value={`${successRate}%`} sub={`${successCount} 成功 / ${failureCount} 失败`} accent="#059669" />
          <StatCard icon={<Calendar className="w-4 h-4" />} label="今日运行" value={String(todayCount)} accent="#2563eb" />
          <StatCard icon={<Timer className="w-4 h-4" />} label="平均耗时" value={fmtDuration(avgDuration)} accent="#7c3aed" />
        </div>
      )}

      {/* 工具栏：筛选 + 刷新 */}
      <div className="flex items-center gap-2 px-6 py-3 flex-shrink-0 flex-wrap" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        {/* 搜索框仅在跨工作流视图（非 compact）下有意义；锁定单工作流时隐藏 */}
        {!compact && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
              placeholder="搜索工作流名称"
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-neutral-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 w-48"
            />
          </div>
        )}

        <CustomSelect
          value={statusFilter}
          onChange={(val) => { setStatusFilter(val as typeof statusFilter); setVisibleCount(PAGE_SIZE); }}
          options={[
            { id: 'all', name: '全部状态' },
            { id: 'success', name: '成功' },
            { id: 'failure', name: '失败' },
          ]}
          className="w-[120px] shrink-0"
        />

        <CustomSelect
          value={timeRange}
          onChange={(val) => { setTimeRange(val as typeof timeRange); setVisibleCount(PAGE_SIZE); }}
          options={[
            { id: 'all', name: '全部时间' },
            { id: 'today', name: '今天' },
            { id: '7d', name: '近 7 天' },
            { id: '14d', name: '近 14 天' },
            { id: '30d', name: '近 30 天' },
          ]}
          className="w-[120px] shrink-0"
        />

        <span className="text-[11px] text-neutral-400" title="超过 30 天的日志会被自动删除，避免无序增长">
          仅保留近 30 天
        </span>

        <div className="flex-1" />

        <label className="flex items-center gap-1.5 text-xs text-neutral-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded border-neutral-300"
          />
          自动刷新
        </label>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-3">
        {loading && all.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-neutral-400 text-sm">加载中...</div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-40 text-red-500 text-sm gap-2">
            <span>{error}</span>
            <button onClick={() => load(true)} className="text-xs px-3 py-1 rounded-lg border border-neutral-200 hover:bg-neutral-50">重试</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-neutral-400">
            <Inbox className="w-10 h-10 mb-2 text-neutral-200" />
            <p className="text-sm">暂无运行日志</p>
            {!workflowId && <p className="text-xs mt-1">启用工作流并发起触发后，运行记录将显示在此</p>}
          </div>
        ) : (
          <div className="space-y-1.5">
            {visible.map((e) => {
              const ok = e.status === 'success';
              return (
                <button
                  key={e.id}
                  onClick={() => openDetail(e)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm transition-all text-left"
                >
                  <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                    {ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-neutral-900 truncate">{e.workflowName}</span>
                      {!workflowId && <span className="text-[10px] text-neutral-400 font-mono truncate">{e.workflowId}</span>}
                    </div>
                    <div className="text-[11px] text-neutral-400 flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {fmtTime(e.triggerTime)}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xs text-neutral-600">{fmtDuration(e.durationMs)}</div>
                    <div className="text-[10px] text-neutral-400">{e.stepCount} 步骤</div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-neutral-300 -rotate-90 flex-shrink-0" />
                </button>
              );
            })}

            {visibleCount < filtered.length && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="w-full py-2 text-xs text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                加载更多（{filtered.length - visibleCount} 条）
              </button>
            )}
          </div>
        )}
      </div>

      <ExecutionDetail execution={selected} loading={detailLoading} onClose={() => setSelected(null)} />
    </div>
  );
}
