'use client';

import { useState } from 'react';
import { X, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight, Webhook, Zap, Loader2, Table2, Copy } from 'lucide-react';
import type { Execution, ExecutionStep, TriggerKind } from '@/types';
import { TRIGGER_KIND_META } from '@/types';

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function fmtDuration(ms?: number): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function JsonBlock({ data, title }: { data: unknown; title?: string }) {
  const [open, setOpen] = useState(false);
  const text = JSON.stringify(data, null, 2);
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {title || 'JSON'}
        <span className="text-neutral-400 font-normal">({text.length} 字符)</span>
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto px-3 py-2 text-[11px] leading-relaxed text-neutral-700 bg-white border-t border-neutral-200 whitespace-pre-wrap break-all">
          {text}
        </pre>
      )}
    </div>
  );
}

/** 触发器行：样式与执行步骤一致，首行显示触发器类型，第二行显示具体触发器及其触发内容 */
function TriggerRow({ execution }: { execution: Execution }) {
  const [copied, setCopied] = useState(false);
  const kind: TriggerKind = execution.triggerKind ?? 'webhook';
  const meta = TRIGGER_KIND_META[kind] ?? { label: '未知', desc: '' };
  const detail = execution.triggerDetail ?? {};

  const Icon = kind === 'scheduled' ? Clock : kind === 'bitable_event' ? Table2 : Webhook;

  // 第二行：具体是哪个触发器
  let detailText = '';
  let fullWebhookUrl = '';
  if (kind === 'webhook') {
    const raw = (detail.webhookUrl as string) ?? '';
    // 存储的是相对路径，拼接当前站点 origin 还原成完整可访问地址
    fullWebhookUrl = raw
      ? raw.startsWith('/')
        ? `${typeof window !== 'undefined' ? window.location.origin : ''}${raw}`
        : raw
      : '';
    detailText = `Webhook 地址：${fullWebhookUrl || '—'}`;
  } else if (kind === 'scheduled') {
    detailText = `Cron 表达式：${detail.cronExpression ?? '—'}`;
  } else if (kind === 'bitable_event') {
    detailText = `应用 ${detail.eventAppToken ?? '—'} / 数据表 ${detail.eventTableId ?? '—'} / 事件 ${detail.eventType ?? '—'}`;
  }

  const copyWebhook = async () => {
    if (!fullWebhookUrl) return;
    try {
      await navigator.clipboard.writeText(fullWebhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 忽略复制失败 */
    }
  };

  // 触发内容：webhook 用请求体；其余回退到触发器配置快照
  const contentSrc = execution.requestSummary?.content ?? {};
  const content = Object.keys(contentSrc).length > 0 ? contentSrc : detail;

  return (
    <div className="relative pl-8 pb-5">
      {/* 节点圆点 */}
      <span className="absolute left-0 top-0.5 w-6 h-6 rounded-full flex items-center justify-center bg-blue-50 text-blue-600">
        <Icon className="w-4 h-4" />
      </span>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-900">{meta.label} 触发器</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 font-mono">{kind}</span>
        </div>
        <p className="text-xs mt-0.5 text-neutral-500 flex items-center gap-1.5 flex-wrap">
          <span>{detailText}</span>
          {fullWebhookUrl && (
            <button
              onClick={copyWebhook}
              title="复制 webhook 地址"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-neutral-200 text-neutral-500 hover:bg-neutral-100 transition-colors"
            >
              <Copy className="w-3 h-3" />
              {copied ? '已复制' : '复制'}
            </button>
          )}
        </p>
        <div className="mt-2">
          <JsonBlock data={content} title="触发内容" />
        </div>
      </div>
    </div>
  );
}

function StepRow({ step, index }: { step: ExecutionStep; index: number }) {
  return (
    <div className="relative pl-8 pb-5 last:pb-0">
      {/* 时间线竖线 */}
      <span className="absolute left-[11px] top-5 bottom-0 w-px bg-neutral-200" />
      {/* 节点圆点 */}
      <span
        className={`absolute left-0 top-0.5 w-6 h-6 rounded-full flex items-center justify-center ${
          step.success ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
        }`}
      >
        {step.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
      </span>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-neutral-900">{step.title}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 font-mono">{step.action}</span>
            <span className="text-[10px] text-neutral-400">#{index + 1}</span>
          </div>
          <p className={`text-xs mt-0.5 ${step.success ? 'text-neutral-500' : 'text-red-500'}`}>{step.message}</p>
        </div>
        <span className="flex-shrink-0 text-xs text-neutral-400 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {fmtDuration(step.durationMs)}
        </span>
      </div>

      {step.output && Object.keys(step.output).length > 0 && (
        <div className="mt-2">
          <JsonBlock data={step.output} title="步骤输出" />
        </div>
      )}
    </div>
  );
}

export default function ExecutionDetail({
  execution,
  loading = false,
  onClose,
}: {
  execution: Execution | null;
  loading?: boolean;
  onClose: () => void;
}) {
  if (!execution) return null;
  const isSuccess = execution.status === 'success';
  const steps = execution.steps || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* 抽屉 */}
      <div
        className="relative w-full max-w-xl h-full bg-white shadow-2xl flex flex-col execution-drawer"
      >
        {/* 头部 */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-neutral-200 flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-neutral-900 truncate">{execution.workflowName}</h2>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  isSuccess ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                }`}
              >
                {isSuccess ? '成功' : '失败'}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              {fmtTime(execution.triggerTime)} · 总耗时 {fmtDuration(execution.durationMs)} · {steps.length} 个步骤
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* 触发器 + 步骤 时间线 */}
          <section>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">
              <Zap className="w-3.5 h-3.5" />
              执行过程
            </div>
            {loading && steps.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-neutral-400 py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                正在加载步骤详情...
              </div>
            ) : (
              <div className="relative">
                <span className="absolute left-[11px] top-1 bottom-1 w-px bg-neutral-200" />
                {/* 触发器行（首行） */}
                <TriggerRow execution={execution} />
                {steps.length === 0 ? (
                  <p className="text-xs text-neutral-400 pl-8">本次执行没有产生步骤记录</p>
                ) : (
                  steps.map((step, i) => (
                    <StepRow key={i} step={step} index={i} />
                  ))
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
