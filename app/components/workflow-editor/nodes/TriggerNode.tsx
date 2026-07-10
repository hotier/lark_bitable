/**
 * 触发器节点 - Webhook / 定时 / 多维表格事件
 */

'use client';

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Webhook, Clock, Database } from 'lucide-react';

interface TriggerNodeData {
  label?: string;
  triggerKind?: string;
  webhookUrl?: string;
  cronExpression?: string;
  eventAppToken?: string;
  eventTableId?: string;
  eventType?: string;
}

const TRIGGER_ICONS: Record<string, React.FC<{ className?: string }>> = {
  webhook: Webhook,
  scheduled: Clock,
  bitable_event: Database,
};

/** 不同触发器类型对应的节点标题（随配置动态切换） */
const TRIGGER_TITLES: Record<string, string> = {
  webhook: 'Webhook 触发器',
  scheduled: '定时触发',
  bitable_event: '多维表格事件',
};

const EVENT_LABELS: Record<string, string> = {
  record_created: '记录创建',
  record_updated: '记录更新',
  record_deleted: '记录删除',
};

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 将 Cron 表达式转换为易懂的中文描述（用于画布展示） */
function describeSchedule(cron?: string): string {
  const parts = (cron || '').trim().split(/\s+/);
  if (parts.length !== 5) return '未设置定时';
  const [min, hour, dom, , dow] = parts;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if ((cron ?? '').trim() === '* * * * *') return '每分钟';
  if (min !== '*' && hour === '*') return `每小时第 ${min} 分`;
  if (dom === '*' && dow === '*') return `每天 ${time}`;
  const wd = WEEKDAY_LABELS[((parseInt(dow, 10) % 7) + 7) % 7];
  if (dom === '*' && dow !== '*') return `每${wd} ${time}`;
  if (dom !== '*' && dow === '*') return `每月 ${dom} 号 ${time}`;
  return cron ?? '未设置定时';
}

export default function TriggerNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as TriggerNodeData;
  const kind = nodeData.triggerKind || 'webhook';
  const Icon = TRIGGER_ICONS[kind] || Webhook;

  const renderDetail = () => {
    switch (kind) {
      case 'webhook':
        return nodeData.webhookUrl ? (
          <span className="font-mono text-blue-500 truncate block">{nodeData.webhookUrl}</span>
        ) : '触发器';
      case 'scheduled':
        return <span className="truncate block">{describeSchedule(nodeData.cronExpression)}</span>;
      case 'bitable_event':
        return nodeData.eventTableId ? (
          <span className="truncate block">
            {EVENT_LABELS[nodeData.eventType || ''] || '事件'} · {nodeData.eventTableId}
          </span>
        ) : '多维表格事件（未配置）';
      default:
        return null;
    }
  };

  return (
    <div
      className={`w-[180px] rounded-xl border-2 shadow-sm transition-shadow ${
        selected ? 'border-blue-400 shadow-blue-100 shadow-md' : 'border-blue-200'
      } bg-white`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-blue-100 bg-blue-50/50 rounded-t-xl drag-handle cursor-grab">
        <div className="w-6 h-6 rounded-md bg-blue-100 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-blue-600" />
        </div>
        <span className="text-xs font-semibold text-blue-700">
          {TRIGGER_TITLES[kind] || nodeData.label || '触发器'}
        </span>
      </div>
      <div className="px-3 py-2">
        <div className="text-[10px] text-neutral-500">{renderDetail()}</div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2.5 !h-2.5 !bg-blue-400 !border-2 !border-white"
      />
    </div>
  );
}
