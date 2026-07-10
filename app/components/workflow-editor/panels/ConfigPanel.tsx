/**
 * 节点配置抽屉 - 统一的节点配置面板
 *
 * 通过 ConfigPanelRegistry 将 rfType → 配置组件，替代硬编码 switch-case。
 * 添加新节点时，在此文件底部调用 configPanelRegistry.register() 即可。
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, RefreshCw } from 'lucide-react';
import { useWorkflowEditorStore, type AppNode, NODE_TYPES } from '@/lib/workflow-engine/editor-store';
import type { Field, FilterCondition, FieldMapping, CrdAction } from '@/types';
import { CRUD_ACTION_META } from '@/types';
import { CustomSelect } from '@/app/components/CustomSelect';

interface ConfigPanelProps {
  onListTables?: (appToken: string) => Promise<{ table_id: string; name: string }[]>;
  onListFields?: (appToken: string, tableId: string) => Promise<Field[]>;
}

// ====== 工具 ======

function idGen(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 将存储的相对路径解析为完整 URL（自动跟随当前域名） */
function resolveWebhookUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return path.startsWith('http') ? path : `${origin}${path}`;
}

type ScheduleFreq = 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

/** 将 Cron 表达式解析为友好的频率配置（无法识别的模式归为 custom） */
function parseCron(cron: string): { freq: ScheduleFreq; time: string; weekday: number; monthDay: number } {
  const parts = (cron || '').trim().split(/\s+/);
  if (parts.length !== 5) return { freq: 'custom', time: '09:00', weekday: 1, monthDay: 1 };
  const [min, hour, dom, , dow] = parts;
  if (cron.trim() === '* * * * *') return { freq: 'minute', time: '09:00', weekday: 1, monthDay: 1 };
  if (min !== '*' && hour === '*' && dom === '*' && dow === '*')
    return { freq: 'hourly', time: `00:${min.padStart(2, '0')}`, weekday: 1, monthDay: 1 };
  if (dom === '*' && dow === '*')
    return { freq: 'daily', time: `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`, weekday: 1, monthDay: 1 };
  if (dom === '*' && dow !== '*')
    return {
      freq: 'weekly',
      time: `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`,
      weekday: ((parseInt(dow, 10) % 7) + 7) % 7,
      monthDay: 1,
    };
  if (dom !== '*' && dow === '*')
    return { freq: 'monthly', time: `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`, weekday: 1, monthDay: parseInt(dom, 10) };
  return { freq: 'custom', time: '09:00', weekday: 1, monthDay: 1 };
}

/** 由友好的频率配置生成 Cron 表达式 */
function buildCron(freq: ScheduleFreq, time: string, weekday: number, monthDay: number): string {
  const [h, m] = (time || '09:00').split(':');
  switch (freq) {
    case 'minute': return '* * * * *';
    case 'hourly': return `${m} * * * *`;
    case 'daily': return `${m} ${h} * * *`;
    case 'weekly': return `${m} ${h} * * ${weekday}`;
    case 'monthly': return `${m} ${h} ${monthDay} * *`;
    case 'custom': return '';
  }
}

/** 由频率 + 日期时间（datetime-local 值）生成 Cron 表达式 */
function cronFromParts(f: ScheduleFreq, min: number, hour: number, monthDay: number, weekday: number): string {
  switch (f) {
    case 'minute': return '* * * * *';
    case 'hourly': return `${min} * * * *`;
    case 'daily': return `${min} ${hour} * * *`;
    case 'weekly': return `${min} ${hour} * * ${weekday}`;
    case 'monthly': return `${min} ${hour} ${monthDay} * *`;
    case 'custom': return '';
  }
}

/** 由频率 + 解析出的时间 / 星期 / 日期构造 datetime-local 初始值（取今天附近） */
function buildExecDateTime(f: ScheduleFreq, time: string, weekday: number, monthDay: number): string {
  const now = new Date();
  const [h, m] = (time || '09:00').split(':');
  let y = now.getFullYear(), mo = now.getMonth(), dnum = now.getDate();
  if (f === 'monthly') dnum = monthDay;
  else if (f === 'weekly') {
    const diff = ((weekday - now.getDay()) + 7) % 7 || 7;
    const t = new Date(now);
    t.setDate(now.getDate() + diff);
    y = t.getFullYear(); mo = t.getMonth(); dnum = t.getDate();
  }
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p2(mo + 1)}-${p2(dnum)}T${p2(Number(h))}:${p2(Number(m))}`;
}

/** 安全解析 datetime-local 值，非法时回退到当前时间 */
function resolveDate(dt: string): Date {
  const d = new Date(dt);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * 节点配置自动保存钩子：
 * 任一配置项变更即写入节点数据（updateNodeData 会合并进 node.data），
 * 因此无需手动点击「保存」按钮，配置栏的选择会即时生效并随工作流一起持久化。
 *
 * @param nodeId   节点 id
 * @param build    根据当前局部状态构建要写入 node.data 的对象
 * @param deps     触发自动保存的依赖（即 build 中用到的全部状态）
 */
function useNodeAutoSave(
  nodeId: string,
  build: () => Record<string, unknown>,
  deps: React.DependencyList,
): void {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  useEffect(() => {
    updateNodeData(nodeId, build());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, updateNodeData, ...deps]);
}

// ====== 配置组件类型 ======

type ConfigComponent = React.FC<{ node: AppNode } & ConfigPanelProps>;

// ====== 配置面板注册中心 ======

class ConfigPanelRegistry {
  private map = new Map<string, ConfigComponent>();

  register(rfType: string, component: ConfigComponent): void {
    this.map.set(rfType, component);
  }

  get(rfType: string): ConfigComponent | undefined {
    return this.map.get(rfType);
  }
}

export const configPanelRegistry = new ConfigPanelRegistry();

// ====== 子面板 ======

function TriggerConfig({ node, onListTables }: { node: AppNode } & ConfigPanelProps) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const apps = useWorkflowEditorStore((s) => s.apps);
  const data = node.data as Record<string, unknown>;
  const [triggerKind, setTriggerKind] = useState((data.triggerKind as string) || 'webhook');
  const [webhookUrl, setWebhookUrl] = useState((data.webhookUrl as string) || `/api/trigger-webhook/${node.id}`);
  const [secretToken, setSecretToken] = useState((data.secretToken as string) || '');
  const [webhookBodyTemplate, setWebhookBodyTemplate] = useState((data.webhookBodyTemplate as string) || '');
  const [cronExpression, setCronExpression] = useState((data.cronExpression as string) || '');
  const [freq, setFreq] = useState<ScheduleFreq>('daily');
  const [execDateTime, setExecDateTime] = useState('');
  const [eventAppToken, setEventAppToken] = useState((data.eventAppToken as string) || '');
  const [eventTableId, setEventTableId] = useState((data.eventTableId as string) || '');
  const [eventType, setEventType] = useState<'record_created' | 'record_updated' | 'record_deleted'>(
    (data.eventType as 'record_created' | 'record_updated' | 'record_deleted') || 'record_created',
  );

  const [tables, setTables] = useState<{ table_id: string; name: string }[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);

  useEffect(() => {
    if (eventAppToken && onListTables) {
      setLoadingTables(true);
      onListTables(eventAppToken)
        .then(setTables)
        .finally(() => setLoadingTables(false));
    } else {
      setTables([]);
    }
  }, [eventAppToken, onListTables]);

  // 根据已保存的 cronExpression 初始化友好的频率配置
  useEffect(() => {
    if (!cronExpression) {
      setExecDateTime(buildExecDateTime('daily', '09:00', 1, 1));
      return;
    }
    const p = parseCron(cronExpression);
    setFreq(p.freq);
    if (p.freq !== 'custom') {
      setExecDateTime(buildExecDateTime(p.freq, p.time, p.weekday, p.monthDay));
      setCronExpression(buildCron(p.freq, p.time, p.weekday, p.monthDay));
    } else {
      setExecDateTime(buildExecDateTime('daily', '09:00', 1, 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 由当前频率 + 日期时间重算 Cron 表达式 */
  const updateSchedule = (f: ScheduleFreq, dt: string) => {
    if (f !== 'custom') {
      const d = resolveDate(dt);
      setCronExpression(cronFromParts(f, d.getMinutes(), d.getHours(), d.getDate(), d.getDay()));
    }
  };

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({
      triggerKind, webhookUrl, secretToken, webhookBodyTemplate,
      cronExpression, eventAppToken, eventTableId, eventType,
    }),
    [triggerKind, webhookUrl, secretToken, webhookBodyTemplate, cronExpression, eventAppToken, eventTableId, eventType],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">触发器类型</label>
        <CustomSelect
          value={triggerKind}
          onChange={(v) => setTriggerKind(v)}
          options={[
            { id: 'webhook', name: 'Webhook' },
            { id: 'scheduled', name: '定时触发' },
            { id: 'bitable_event', name: '多维表格事件' },
          ]}
        />
      </div>
      {triggerKind === 'webhook' && (
        <>
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">Webhook URL</label>
            <input
              type="text" value={resolveWebhookUrl(webhookUrl)}
              onChange={(e) => setWebhookUrl(e.target.value)}
              onClick={() => {
                const url = resolveWebhookUrl(webhookUrl);
                navigator.clipboard.writeText(url).then(() => {
                  window.dispatchEvent(
                    new CustomEvent('app:toast', {
                      detail: { type: 'success', text: 'Webhook URL 已复制到剪贴板' },
                    }),
                  );
                });
              }}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-neutral-50 cursor-pointer hover:border-blue-300 focus:outline-none dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
              readOnly
              title="点击复制 URL"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">安全 Token（可选）</label>
            <div className="relative">
              <input
                type="text" value={secretToken}
                onChange={(e) => setSecretToken(e.target.value)}
                onClick={() => {
                  if (!secretToken) return;
                  navigator.clipboard.writeText(secretToken).then(() => {
                    window.dispatchEvent(
                      new CustomEvent('app:toast', {
                        detail: { type: 'success', text: '安全 Token 已复制到剪贴板' },
                      }),
                    );
                  });
                }}
                placeholder="可选，用于验证请求来源"
                className="w-full rounded-lg border border-neutral-200 pl-3 pr-16 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 cursor-pointer dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
                title="点击复制 Token"
              />
              <button
                type="button"
                onClick={() => {
                  const token = Array.from({ length: 32 }, () =>
                    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]
                  ).join('');
                  setSecretToken(token);
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 transition-colors dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                <RefreshCw className="w-3.5 h-3.5" /> 生成
              </button>
            </div>
            <p className="text-[10px] text-neutral-400 mt-1">
              {secretToken
                ? <>请求头需携带 <code className="font-mono">X-Webhook-Token: &lt;token&gt;</code> 才能通过校验</>
                : '不填写则任何请求均可触发，建议生成 Token 以提升安全性'}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">请求体模板（可选）</label>
            <textarea
              value={webhookBodyTemplate}
              onChange={(e) => setWebhookBodyTemplate(e.target.value)}
              placeholder='{"content": {"field_name": "value"}}'
              rows={4}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
            />
          </div>
        </>
      )}
      {triggerKind === 'scheduled' && (
        <div className="space-y-3">
          {freq !== 'custom' && (
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1 dark:text-neutral-300">执行时间</label>
              <input
                type="datetime-local"
                value={execDateTime}
                onChange={(e) => {
                  const dt = e.target.value;
                  setExecDateTime(dt);
                  updateSchedule(freq, dt);
                }}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
              />
              <p className="text-[10px] text-neutral-400 mt-1">
                {freq === 'minute'
                  ? '每分钟执行，时间无需设置'
                  : '日期用于确定星期 / 每月几号，时间用于确定每日执行时刻'}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1 dark:text-neutral-300">执行频率</label>
            <CustomSelect
              value={freq}
              onChange={(v) => {
                const f = v as ScheduleFreq;
                setFreq(f);
                updateSchedule(f, execDateTime);
              }}
              options={[
                { id: 'minute', name: '每分钟' },
                { id: 'hourly', name: '每小时' },
                { id: 'daily', name: '每天' },
                { id: 'weekly', name: '每周' },
                { id: 'monthly', name: '每月' },
                { id: 'custom', name: '自定义（高级 Cron）' },
              ]}
            />
          </div>

          {freq === 'custom' && (
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1 dark:text-neutral-300">Cron 表达式</label>
              <input
                type="text"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                placeholder="0 9 * * *"
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-100"
              />
            </div>
          )}

          {freq !== 'custom' && (
            <p className="text-[10px] text-neutral-400">
              将按 <span className="font-mono text-neutral-500">{cronExpression}</span> 执行（分 时 日 月 周）
            </p>
          )}
        </div>
      )}
      {triggerKind === 'bitable_event' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">监听的多维表格</label>
            <CustomSelect
              value={eventAppToken}
              onChange={(v) => { setEventAppToken(v); setEventTableId(''); }}
              options={apps.map((app) => ({ id: app.app_token, name: app.name }))}
              placeholder="选择多维表格"
            />
          </div>
          {eventAppToken && (
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">监听的数据表</label>
              <CustomSelect
                value={eventTableId}
                onChange={(v) => setEventTableId(v)}
                options={tables.map((t) => ({ id: t.table_id, name: t.name }))}
                placeholder="选择数据表"
                loading={loadingTables}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">监听的事件类型</label>
            <CustomSelect
              value={eventType}
              onChange={(v) => setEventType(v as 'record_created' | 'record_updated' | 'record_deleted')}
              options={[
                { id: 'record_created', name: '记录创建' },
                { id: 'record_updated', name: '记录更新' },
                { id: 'record_deleted', name: '记录删除' },
              ]}
            />
          </div>
          <p className="text-[10px] text-neutral-400">需在飞书开放平台配置多维表格事件回调，将事件推送到本工作流 Webhook 后生效</p>
        </div>
      )}
    </div>
  );
}

function ActionConfig({ node, onListTables, onListFields }: { node: AppNode } & ConfigPanelProps) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const apps = useWorkflowEditorStore((s) => s.apps);
  const data = node.data as Record<string, unknown>;

  // 操作类型由节点创建时（从面板拖入）即固定，无需选择器
  const [actionType] = useState<CrdAction>((data.actionType as CrdAction) || 'create_record');
  const [targetAppToken, setTargetAppToken] = useState((data.targetAppToken as string) || '');
  const [targetTableId, setTargetTableId] = useState((data.targetTableId as string) || '');
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>(
    (data.fieldMappings as FieldMapping[]) || [],
  );
  const [filters, setFilters] = useState<FilterCondition[]>(
    (data.filters as FilterCondition[]) || [],
  );
  const [filterLogic, setFilterLogic] = useState<'and' | 'or'>('and');

  const [tables, setTables] = useState<{ table_id: string; name: string }[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);

  // 加载数据表
  useEffect(() => {
    if (targetAppToken && onListTables) {
      setLoadingTables(true);
      onListTables(targetAppToken)
        .then(setTables)
        .finally(() => setLoadingTables(false));
    }
  }, [targetAppToken, onListTables]);

  // 加载字段
  useEffect(() => {
    if (targetAppToken && targetTableId && onListFields) {
      setLoadingFields(true);
      onListFields(targetAppToken, targetTableId)
        .then(setFields)
        .finally(() => setLoadingFields(false));
    }
  }, [targetAppToken, targetTableId, onListFields]);

  const addFieldMapping = useCallback(() => {
    if (fields.length === 0) return;
    const unused = fields.find((f) => !fieldMappings.some((m) => m.fieldId === f.field_id));
    if (unused) {
      setFieldMappings([
        ...fieldMappings,
        {
          fieldId: unused.field_id,
          fieldName: unused.name,
          fieldType: unused.type,
          source: 'manual',
          manualValue: '',
          webhookKey: '',
          variableKey: '',
          variableLabel: '',
        },
      ]);
    }
  }, [fields, fieldMappings]);

  const addFilter = useCallback(() => {
    if (fields.length === 0) return;
    const unused = fields.find((f) => !filters.some((fl) => fl.fieldId === f.field_id));
    if (unused) {
      setFilters([
        ...filters,
        { fieldId: unused.field_id, fieldName: unused.name, operator: 'eq', value: '', valueSource: 'manual' },
      ]);
    }
  }, [fields, filters]);

  const targetTableName = tables.find((t) => t.table_id === targetTableId)?.name || '';

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({
      label: CRUD_ACTION_META[actionType]?.label || '操作',
      actionType, targetAppToken, targetTableId, targetTableName,
      fieldMappings, filters,
    }),
    [actionType, targetAppToken, targetTableId, targetTableName, fieldMappings, filters],
  );

  return (
    <div className="space-y-4">
      {/* 目标多维表格 */}
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">目标多维表格</label>
        <CustomSelect
          value={targetAppToken}
          onChange={(v) => { setTargetAppToken(v); setTargetTableId(''); }}
          options={apps.map((app) => ({ id: app.app_token, name: app.name }))}
          placeholder="选择多维表格"
        />
      </div>

      {/* 数据表 */}
      {targetAppToken && (
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">数据表</label>
          <CustomSelect
            value={targetTableId}
            onChange={(v) => setTargetTableId(v)}
            options={tables.map((t) => ({ id: t.table_id, name: t.name }))}
            placeholder="选择数据表"
            loading={loadingTables}
          />
        </div>
      )}

      {/* 字段映射 (create/update) */}
      {(actionType === 'create_record' || actionType === 'update_record') && targetTableId && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-neutral-700">字段映射</label>
            <button onClick={addFieldMapping} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1">
              <Plus className="w-3 h-3" /> 添加
            </button>
          </div>
          {loadingFields ? (
            <div className="text-xs text-neutral-400 py-2">加载字段中...</div>
          ) : fieldMappings.length === 0 ? (
            <div className="text-xs text-neutral-400 py-2">点击添加字段映射</div>
          ) : (
            <div className="space-y-2">
              {fieldMappings.map((m, idx) => (
                <div key={idx} className="p-2 rounded-lg bg-neutral-50 border border-neutral-100 space-y-2">
                  {/* 第一行：需要映射的字段 */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <CustomSelect
                        value={m.fieldId}
                        onChange={(fid) => {
                          const f = fields.find((ff) => ff.field_id === fid);
                          if (!f) return;
                          const newMaps = [...fieldMappings];
                          newMaps[idx] = { ...newMaps[idx], fieldId: f.field_id, fieldName: f.name, fieldType: f.type };
                          setFieldMappings(newMaps);
                        }}
                        options={fields
                          .filter((f) => f.field_id === m.fieldId || !fieldMappings.some((mm) => mm.fieldId === f.field_id))
                          .map((f) => ({ id: f.field_id, name: f.name }))}
                        placeholder="选择字段"
                      />
                    </div>
                    <button
                      onClick={() => setFieldMappings(fieldMappings.filter((_, i) => i !== idx))}
                      className="text-red-400 hover:text-red-500 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  {/* 第二行：映射类型 + 映射内容（同一方框内） */}
                  <div className="flex items-center gap-2 border border-neutral-200 rounded-lg p-2 bg-white">
                    <div className="w-[88px] shrink-0">
                    <CustomSelect
                      value={m.source}
                      onChange={(v) => {
                        const newMaps = [...fieldMappings];
                        newMaps[idx] = { ...newMaps[idx], source: v as 'manual' | 'webhook' | 'variable' };
                        setFieldMappings(newMaps);
                      }}
                      options={[
                        { id: 'manual', name: '手动输入' },
                        { id: 'webhook', name: 'Webhook 参数' },
                        { id: 'variable', name: '变量' },
                      ]}
                    />
                    </div>
                    <div className="flex-1 min-w-0">
                      {m.source === 'manual' && (
                        <input
                          type="text" value={m.manualValue}
                          onChange={(e) => {
                            const newMaps = [...fieldMappings];
                            newMaps[idx] = { ...newMaps[idx], manualValue: e.target.value };
                            setFieldMappings(newMaps);
                          }}
                          placeholder="值"
                          className="w-full text-xs rounded border border-neutral-200 px-2 py-1 bg-white"
                        />
                      )}
                      {m.source === 'webhook' && (
                        <input
                          type="text" value={m.webhookKey}
                          onChange={(e) => {
                            const newMaps = [...fieldMappings];
                            newMaps[idx] = { ...newMaps[idx], webhookKey: e.target.value };
                            setFieldMappings(newMaps);
                          }}
                          placeholder="content.key"
                          className="w-full text-xs rounded border border-neutral-200 px-2 py-1 bg-white"
                        />
                      )}
                      {m.source === 'variable' && (
                        <div className="text-[11px] text-neutral-400">选择变量</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 筛选条件 (read/update/delete) */}
      {(actionType === 'read_records' || actionType === 'update_record' || actionType === 'delete_record') && targetTableId && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-neutral-700">筛选条件</label>
            <button onClick={addFilter} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1">
              <Plus className="w-3 h-3" /> 添加
            </button>
          </div>
          {loadingFields ? (
            <div className="text-xs text-neutral-400 py-2">加载字段中...</div>
          ) : filters.length === 0 ? (
            <div className="text-xs text-neutral-400 py-2">无筛选条件则匹配第一条记录</div>
          ) : (
            <div className="space-y-2">
              {filters.length > 1 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setFilterLogic('and')}
                    className={`text-xs px-2 py-0.5 rounded ${filterLogic === 'and' ? 'bg-blue-100 text-blue-700' : 'bg-neutral-100 text-neutral-500'}`}
                  >
                    AND
                  </button>
                  <button
                    onClick={() => setFilterLogic('or')}
                    className={`text-xs px-2 py-0.5 rounded ${filterLogic === 'or' ? 'bg-blue-100 text-blue-700' : 'bg-neutral-100 text-neutral-500'}`}
                  >
                    OR
                  </button>
                </div>
              )}
              {filters.map((f, idx) => (
                <div key={f.fieldId} className="flex items-center gap-2 p-2 rounded-lg bg-neutral-50 border border-neutral-100">
                  <span className="text-xs font-medium text-neutral-600 min-w-[60px]">{f.fieldName}</span>
                  <div className="w-[72px] shrink-0">
                  <CustomSelect
                    value={f.operator}
                    onChange={(v) => {
                      const newFilters = [...filters];
                      newFilters[idx] = { ...newFilters[idx], operator: v as FilterCondition['operator'] };
                      setFilters(newFilters);
                    }}
                    options={[
                      { id: 'eq', name: '=' },
                      { id: 'ne', name: '≠' },
                      { id: 'contains', name: '包含' },
                      { id: 'gt', name: '>' },
                      { id: 'lt', name: '<' },
                      { id: 'gte', name: '≥' },
                      { id: 'lte', name: '≤' },
                    ]}
                  />
                  </div>
                  <input
                    type="text" value={f.value}
                    onChange={(e) => {
                      const newFilters = [...filters];
                      newFilters[idx] = { ...newFilters[idx], value: e.target.value };
                      setFilters(newFilters);
                    }}
                    placeholder="值"
                    className="flex-1 text-xs rounded border border-neutral-200 px-2 py-1 bg-white"
                  />
                  <button
                    onClick={() => setFilters(filters.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-500"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

function FilterConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [conditions, setConditions] = useState<FilterCondition[]>(
    (data.conditions as FilterCondition[]) || [],
  );
  const [matchMode, setMatchMode] = useState<'any' | 'all'>((data.matchMode as 'any' | 'all') || 'all');

  const addCondition = () => {
    setConditions([
      ...conditions,
      { fieldId: idGen(), fieldName: '', operator: 'eq', value: '', valueSource: 'manual' },
    ]);
  };

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ conditions, matchMode }),
    [conditions, matchMode],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMatchMode('all')}
          className={`text-xs px-2.5 py-1 rounded-lg ${matchMode === 'all' ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-neutral-100 text-neutral-500'}`}
        >
          AND (全部匹配)
        </button>
        <button
          onClick={() => setMatchMode('any')}
          className={`text-xs px-2.5 py-1 rounded-lg ${matchMode === 'any' ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-neutral-100 text-neutral-500'}`}
        >
          OR (任一匹配)
        </button>
      </div>

      <div className="space-y-2">
        {conditions.map((c, idx) => (
          <div key={c.fieldId} className="flex items-center gap-2 p-2 rounded-lg bg-neutral-50 border border-neutral-100">
            <input
              type="text" value={c.fieldName}
              onChange={(e) => {
                const newConds = [...conditions];
                newConds[idx] = { ...newConds[idx], fieldName: e.target.value };
                setConditions(newConds);
              }}
              placeholder="字段名"
              className="flex-1 text-xs rounded border border-neutral-200 px-2 py-1 bg-white"
            />
            <div className="w-[72px] shrink-0">
            <CustomSelect
              value={c.operator}
              onChange={(v) => {
                const newConds = [...conditions];
                newConds[idx] = { ...newConds[idx], operator: v as FilterCondition['operator'] };
                setConditions(newConds);
              }}
              options={[
                { id: 'eq', name: '=' },
                { id: 'ne', name: '≠' },
                { id: 'contains', name: '包含' },
                { id: 'gt', name: '>' },
                { id: 'lt', name: '<' },
                { id: 'gte', name: '≥' },
                { id: 'lte', name: '≤' },
              ]}
            />
            </div>
            <input
              type="text" value={c.value}
              onChange={(e) => {
                const newConds = [...conditions];
                newConds[idx] = { ...newConds[idx], value: e.target.value };
                setConditions(newConds);
              }}
              placeholder="值"
              className="flex-1 text-xs rounded border border-neutral-200 px-2 py-1 bg-white"
            />
            <button onClick={() => setConditions(conditions.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-500">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      <button onClick={addCondition} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1">
        <Plus className="w-3 h-3" /> 添加条件
      </button>

    </div>
  );
}

function DelayConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [duration, setDuration] = useState((data.duration as number) || 1);
  const [unit, setUnit] = useState((data.unit as string) || 'minutes');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ duration, unit }),
    [duration, unit],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="number" min={1} value={duration}
          onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))}
          className="w-24 rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
        />
        <div className="w-20 shrink-0">
        <CustomSelect
          value={unit}
          onChange={(v) => setUnit(v)}
          options={[
            { id: 'seconds', name: '秒' },
            { id: 'minutes', name: '分钟' },
            { id: 'hours', name: '小时' },
            { id: 'days', name: '天' },
          ]}
        />
        </div>
      </div>
      <p className="text-[10px] text-neutral-400">注意：最大延时 5 分钟（serverless 限制）</p>
    </div>
  );
}

function HttpConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [url, setUrl] = useState((data.url as string) || '');
  const [method, setMethod] = useState((data.method as string) || 'GET');
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>(
    (data.headers as { key: string; value: string }[]) || [],
  );
  const [body, setBody] = useState((data.body as string) || '');

  const addHeader = () => setHeaders([...headers, { key: '', value: '' }]);

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ url, method, headers, body }),
    [url, method, headers, body],
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="w-24 shrink-0">
        <CustomSelect
          value={method}
          onChange={(v) => setMethod(v)}
          options={['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => ({ id: m, name: m }))}
        />
        </div>
        <input
          type="text" value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/api"
          className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-neutral-700">Headers</label>
          <button onClick={addHeader} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1">
            <Plus className="w-3 h-3" /> 添加
          </button>
        </div>
        {headers.map((h, idx) => (
          <div key={idx} className="flex gap-2 mb-1">
            <input
              type="text" value={h.key}
              onChange={(e) => {
                const newH = [...headers];
                newH[idx] = { ...newH[idx], key: e.target.value };
                setHeaders(newH);
              }}
              placeholder="Key"
              className="flex-1 text-xs rounded border border-neutral-200 px-2 py-1 bg-white"
            />
            <input
              type="text" value={h.value}
              onChange={(e) => {
                const newH = [...headers];
                newH[idx] = { ...newH[idx], value: e.target.value };
                setHeaders(newH);
              }}
              placeholder="Value"
              className="flex-1 text-xs rounded border border-neutral-200 px-2 py-1 bg-white"
            />
            <button onClick={() => setHeaders(headers.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-500">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {['POST', 'PUT', 'PATCH'].includes(method) && (
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">Body (JSON)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
          />
        </div>
      )}

    </div>
  );
}

function ImConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [msgType, setMsgType] = useState<'text' | 'card'>((data.msgType as 'text' | 'card') || 'text');
  const [textContent, setTextContent] = useState((data.textContent as string) || '');
  const [cardJson, setCardJson] = useState((data.cardJson as string) || '');
  const [receiveIdType, setReceiveIdType] = useState((data.receiveIdType as string) || 'open_id');
  const [receiveId, setReceiveId] = useState((data.receiveId as string) || '');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({
      msgType, textContent, cardJson, receiveIdType, receiveId,
    }),
    [msgType, textContent, cardJson, receiveIdType, receiveId],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">接收人类型</label>
        <CustomSelect
          value={receiveIdType}
          onChange={(v) => setReceiveIdType(v)}
          options={[
            { id: 'open_id', name: 'Open ID' },
            { id: 'user_id', name: 'User ID' },
            { id: 'union_id', name: 'Union ID' },
            { id: 'email', name: '邮箱' },
            { id: 'chat_id', name: '群聊 ID' },
          ]}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">接收人 ID</label>
        <input
          type="text" value={receiveId}
          onChange={(e) => setReceiveId(e.target.value)}
          placeholder="输入飞书用户/群聊 ID"
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">消息类型</label>
        <div className="flex gap-2">
          <button
            onClick={() => setMsgType('text')}
            className={`text-xs px-3 py-1.5 rounded-lg ${msgType === 'text' ? 'bg-violet-100 text-violet-700 font-medium' : 'bg-neutral-100 text-neutral-500'}`}
          >
            文本消息
          </button>
          <button
            onClick={() => setMsgType('card')}
            className={`text-xs px-3 py-1.5 rounded-lg ${msgType === 'card' ? 'bg-violet-100 text-violet-700 font-medium' : 'bg-neutral-100 text-neutral-500'}`}
          >
            卡片消息
          </button>
        </div>
      </div>
      {msgType === 'text' ? (
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">消息内容</label>
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="输入文本消息内容..."
            rows={3}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
          />
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">卡片 JSON</label>
          <textarea
            value={cardJson}
            onChange={(e) => setCardJson(e.target.value)}
            placeholder='{"header": {"title": "标题"}, "elements": [...]}'
            rows={5}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
          />
        </div>
      )}

    </div>
  );
}

// ====== 流程控制配置面板 ======

function SwitchConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [branches, setBranches] = useState<{ id: string; label: string; fieldName: string; operator: string; value: string; valueSource: string }[]>(
    (data.branches as unknown[])?.map((b: unknown, i: number) => {
      const br = b as Record<string, unknown>;
      return {
        id: (br.id as string) || idGen(),
        label: (br.label as string) || `分支${i + 1}`,
        fieldName: (br.fieldName as string) || '',
        operator: (br.operator as string) || 'eq',
        value: (br.value as string) || '',
        valueSource: (br.valueSource as string) || 'manual',
      };
    }) || [],
  );
  const [hasDefault, setHasDefault] = useState<boolean>((data.hasDefault as boolean) ?? true);

  const addBranch = () => setBranches([...branches, { id: idGen(), label: `分支${branches.length + 1}`, fieldName: '', operator: 'eq', value: '', valueSource: 'manual' }]);

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ branches, hasDefault }),
    [branches, hasDefault],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-neutral-600">
          <input type="checkbox" checked={hasDefault} onChange={(e) => setHasDefault(e.target.checked)} className="mr-1" />
          不匹配时走默认分支
        </label>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-neutral-700">分支规则</label>
          <button onClick={addBranch} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"><Plus className="w-3 h-3" />添加</button>
        </div>
        <div className="space-y-2">
          {branches.map((b, idx) => (
            <div key={b.id} className="p-2 rounded-lg bg-neutral-50 border border-neutral-100 space-y-2">
              <div className="flex gap-2">
                <input type="text" value={b.label} onChange={(e) => { const n = [...branches]; n[idx] = { ...n[idx], label: e.target.value }; setBranches(n); }} placeholder="分支名" className="flex-1 text-xs rounded border border-neutral-200 px-2 py-1 bg-white" />
                <button onClick={() => setBranches(branches.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
              </div>
              <div className="flex gap-2 items-center">
                <input type="text" value={b.fieldName} onChange={(e) => { const n = [...branches]; n[idx] = { ...n[idx], fieldName: e.target.value }; setBranches(n); }} placeholder="字段名" className="w-24 text-xs rounded border border-neutral-200 px-2 py-1 bg-white" />
                <div className="w-[72px] shrink-0">
                <CustomSelect value={b.operator} onChange={(v) => { const n = [...branches]; n[idx] = { ...n[idx], operator: v }; setBranches(n); }} options={[{ id: 'eq', name: '=' }, { id: 'ne', name: '≠' }, { id: 'contains', name: '包含' }, { id: 'gt', name: '>' }, { id: 'lt', name: '<' }]} />
                </div>
                <input type="text" value={b.value} onChange={(e) => { const n = [...branches]; n[idx] = { ...n[idx], value: e.target.value }; setBranches(n); }} placeholder="值" className="flex-1 text-xs rounded border border-neutral-200 px-2 py-1 bg-white" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoopConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [mode, setMode] = useState((data.mode as string) || 'fixed_count');
  const [count, setCount] = useState((data.count as number) || 5);
  const [iterateSource, setIterateSource] = useState((data.iterateSource as string) || '');
  const [maxIterations, setMaxIterations] = useState((data.maxIterations as number) || 100);

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ mode, count, iterateSource, maxIterations }),
    [mode, count, iterateSource, maxIterations],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">循环模式</label>
        <CustomSelect
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { id: 'fixed_count', name: '固定次数' },
            { id: 'iterate_array', name: '迭代数组' },
          ]}
        />
      </div>
      {mode === 'fixed_count' && (
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">循环次数</label>
          <input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>
      )}
      {mode === 'iterate_array' && (
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">迭代数据 key</label>
          <input type="text" value={iterateSource} onChange={(e) => setIterateSource(e.target.value)} placeholder="webhook 数据中的数组字段名" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">最大迭代次数（安全上限）</label>
        <input type="number" min={1} max={1000} value={maxIterations} onChange={(e) => setMaxIterations(Number(e.target.value))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

function MergeConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [mode, setMode] = useState((data.mode as string) || 'append');
  const [joinKey, setJoinKey] = useState((data.joinKey as string) || '');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ mode, joinKey }),
    [mode, joinKey],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">合并模式</label>
        <CustomSelect
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { id: 'append', name: '追加（数组）' },
            { id: 'combine', name: '对象合并' },
            { id: 'join', name: 'Key 关联' },
          ]}
        />
      </div>
      {mode === 'join' && (
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">关联 Key</label>
          <input type="text" value={joinKey} onChange={(e) => setJoinKey(e.target.value)} placeholder="例如: record_id" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>
      )}
    </div>
  );
}

function TryCatchConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [continueOnError, setContinueOnError] = useState<boolean>((data.continueOnError as boolean) ?? true);
  const [maxRetries, setMaxRetries] = useState((data.maxRetries as number) || 3);
  const [retryDelayMs, setRetryDelayMs] = useState((data.retryDelayMs as number) || 1000);

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ continueOnError, maxRetries, retryDelayMs }),
    [continueOnError, maxRetries, retryDelayMs],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-neutral-600">
          <input type="checkbox" checked={continueOnError} onChange={(e) => setContinueOnError(e.target.checked)} className="mr-1" />
          错误时继续执行
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">最大重试次数</label>
        <input type="number" min={0} max={10} value={maxRetries} onChange={(e) => setMaxRetries(Number(e.target.value))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">重试间隔 (ms)</label>
        <input type="number" min={100} step={100} value={retryDelayMs} onChange={(e) => setRetryDelayMs(Number(e.target.value))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

// ====== 数据转换配置面板 ======

function AssignConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [variables, setVariables] = useState<{ name: string; value: string; source: string; webhookKey?: string }[]>(
    (data.variables as unknown[])?.map((v: unknown) => v as { name: string; value: string; source: string; webhookKey?: string }) || [],
  );

  const addVar = () => setVariables([...variables, { name: '', value: '', source: 'manual' }]);

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ variables }),
    [variables],
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-neutral-700">变量赋值</label>
          <button onClick={addVar} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"><Plus className="w-3 h-3" />添加</button>
        </div>
        <div className="space-y-2">
          {variables.map((v, idx) => (
            <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-neutral-50 border border-neutral-100">
              <input type="text" value={v.name} onChange={(e) => { const n = [...variables]; n[idx] = { ...n[idx], name: e.target.value }; setVariables(n); }} placeholder="变量名" className="w-24 text-xs rounded border border-neutral-200 px-2 py-1 bg-white" />
              <div className="w-[88px] shrink-0">
              <CustomSelect value={v.source} onChange={(v2) => { const n = [...variables]; n[idx] = { ...n[idx], source: v2 }; setVariables(n); }} options={[{ id: 'manual', name: '手动' }, { id: 'webhook', name: 'Webhook' }, { id: 'expression', name: '表达式' }]} />
              </div>
              {v.source !== 'webhook' ? (
                <input type="text" value={v.value} onChange={(e) => { const n = [...variables]; n[idx] = { ...n[idx], value: e.target.value }; setVariables(n); }} placeholder="值" className="flex-1 text-xs rounded border border-neutral-200 px-2 py-1 bg-white" />
              ) : (
                <input type="text" value={v.webhookKey || ''} onChange={(e) => { const n = [...variables]; n[idx] = { ...n[idx], webhookKey: e.target.value }; setVariables(n); }} placeholder="content.key" className="flex-1 text-xs rounded border border-neutral-200 px-2 py-1 bg-white" />
              )}
              <button onClick={() => setVariables(variables.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AggregateConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [operation, setOperation] = useState((data.operation as string) || 'count');
  const [fieldName, setFieldName] = useState((data.fieldName as string) || '');
  const [resultVariable, setResultVariable] = useState((data.resultVariable as string) || 'aggregate_result');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ operation, fieldName, resultVariable }),
    [operation, fieldName, resultVariable],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">聚合操作</label>
        <CustomSelect
          value={operation}
          onChange={(val) => setOperation(val)}
          options={[
            { id: 'count', name: '计数' },
            { id: 'sum', name: '求和' },
            { id: 'avg', name: '平均值' },
            { id: 'min', name: '最小值' },
            { id: 'max', name: '最大值' },
            { id: 'group_by', name: '分组' },
          ]}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">目标字段</label>
        <input type="text" value={fieldName} onChange={(e) => setFieldName(e.target.value)} placeholder="字段名或 webhook key" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">结果变量名</label>
        <input type="text" value={resultVariable} onChange={(e) => setResultVariable(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

function CodeConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [code, setCode] = useState((data.code as string) || '// 可访问 data (上游输出) 和 ctx\n// 将结果赋值给 exports.result\nconst result = data;\nexports.result = result;');
  const [language, setLanguage] = useState((data.language as string) || 'javascript');
  const [timeout, setTimeout_] = useState((data.timeout as number) || 5000);

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ code, language, timeout }),
    [code, language, timeout],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">语言</label>
        <CustomSelect
          value={language}
          onChange={(val) => setLanguage(val)}
          options={[
            { id: 'javascript', name: 'JavaScript' },
            { id: 'python', name: 'Python（需要运行时）' },
          ]}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">代码</label>
        <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={8} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">超时 (ms)</label>
        <input type="number" min={1000} max={30000} value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

function TemplateConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [template, setTemplate] = useState((data.template as string) || '你好 {{name}}，你的订单 {{order_id}} 已处理完成。');
  const [engine, setEngine] = useState((data.engine as string) || 'plain');
  const [resultVariable, setResultVariable] = useState((data.resultVariable as string) || 'rendered');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ template, engine, resultVariable }),
    [template, engine, resultVariable],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">模板引擎</label>
        <CustomSelect
          value={engine}
          onChange={(val) => setEngine(val)}
          options={[
            { id: 'plain', name: '纯文本 {{var}}' },
            { id: 'handlebars', name: 'Handlebars' },
            { id: 'mustache', name: 'Mustache' },
          ]}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">模板内容</label>
        <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={4} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        <p className="text-[10px] text-neutral-400 mt-1">使用 {'{{变量名}}'} 引用 webhook 数据或上游节点输出</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">结果变量名</label>
        <input type="text" value={resultVariable} onChange={(e) => setResultVariable(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

// ====== 通知配置面板 ======

function EmailConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [to, setTo] = useState((data.to as string) || '');
  const [toSource, setToSource] = useState((data.toSource as string) || 'manual');
  const [subject, setSubject] = useState((data.subject as string) || '');
  const [body, setBody] = useState((data.body as string) || '');
  const [bodyFormat, setBodyFormat] = useState((data.bodyFormat as string) || 'text');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ to, toSource, subject, body, bodyFormat }),
    [to, toSource, subject, body, bodyFormat],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">收件人来源</label>
        <div className="flex gap-2 mb-2">
          <button onClick={() => setToSource('manual')} className={`text-xs px-2.5 py-1 rounded-lg ${toSource === 'manual' ? 'bg-rose-100 text-rose-700' : 'bg-neutral-100 text-neutral-500'}`}>手动输入</button>
          <button onClick={() => setToSource('webhook')} className={`text-xs px-2.5 py-1 rounded-lg ${toSource === 'webhook' ? 'bg-rose-100 text-rose-700' : 'bg-neutral-100 text-neutral-500'}`}>Webhook</button>
        </div>
        <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder={toSource === 'manual' ? 'user@example.com' : 'content.email'} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">主题</label>
        <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="邮件主题" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">正文格式</label>
        <div className="flex gap-2">
          <button onClick={() => setBodyFormat('text')} className={`text-xs px-2.5 py-1 rounded-lg ${bodyFormat === 'text' ? 'bg-rose-100 text-rose-700' : 'bg-neutral-100 text-neutral-500'}`}>纯文本</button>
          <button onClick={() => setBodyFormat('html')} className={`text-xs px-2.5 py-1 rounded-lg ${bodyFormat === 'html' ? 'bg-rose-100 text-rose-700' : 'bg-neutral-100 text-neutral-500'}`}>HTML</button>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">正文</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="邮件正文内容..." className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

function BotNotifyConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [channel, setChannel] = useState((data.channel as string) || 'feishu');
  const [webhookUrl, setWebhookUrl] = useState((data.webhookUrl as string) || '');
  const [title, setTitle] = useState((data.title as string) || '');
  const [content, setContent] = useState((data.content as string) || '');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ channel, webhookUrl, title, content }),
    [channel, webhookUrl, title, content],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">通知渠道</label>
        <CustomSelect
          value={channel}
          onChange={(val) => setChannel(val)}
          options={[
            { id: 'feishu', name: '飞书' },
            { id: 'dingtalk', name: '钉钉' },
            { id: 'wechat_work', name: '企业微信' },
            { id: 'slack', name: 'Slack' },
          ]}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">Webhook URL</label>
        <input type="text" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">标题</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="通知标题" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">内容（支持 Markdown）</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="## 通知内容&#10;工作流执行结果..." className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

// ====== 飞书生态配置面板 ======

function CreateDocConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [title, setTitle] = useState((data.title as string) || '');
  const [docType, setDocType] = useState((data.docType as string) || 'docx');
  const [content, setContent] = useState((data.content as string) || '');
  const [folderToken, setFolderToken] = useState((data.folderToken as string) || '');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ title, docType, content, folderToken }),
    [title, docType, content, folderToken],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">文档类型</label>
        <CustomSelect
          value={docType}
          onChange={(val) => setDocType(val)}
          options={[
            { id: 'docx', name: '文档' },
            { id: 'sheet', name: '表格' },
            { id: 'slide', name: '幻灯片' },
            { id: 'bitable', name: '多维表格' },
          ]}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">标题</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文档标题" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">内容</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="文档初始内容..." className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">目标文件夹 Token（可选）</label>
        <input type="text" value={folderToken} onChange={(e) => setFolderToken(e.target.value)} placeholder="为空则放在根目录" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

function CreateTaskConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [title, setTitle] = useState((data.title as string) || '');
  const [description, setDescription] = useState((data.description as string) || '');
  const [assignee, setAssignee] = useState((data.assignee as string) || '');
  const [priority, setPriority] = useState((data.priority as string) || 'medium');
  const [dueDate, setDueDate] = useState((data.dueDate as string) || '');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ title, description, assignee, priority, dueDate }),
    [title, description, assignee, priority, dueDate],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">任务标题</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="任务标题" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">描述</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="任务详细描述..." className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">负责人 Open ID</label>
        <input type="text" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="ou_xxxx" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">优先级</label>
        <CustomSelect
          value={priority}
          onChange={(val) => setPriority(val)}
          options={[
            { id: 'low', name: '低' },
            { id: 'medium', name: '中' },
            { id: 'high', name: '高' },
          ]}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">截止时间</label>
        <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

function CalendarEventConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [title, setTitle] = useState((data.title as string) || '');
  const [description, setDescription] = useState((data.description as string) || '');
  const [startTime, setStartTime] = useState((data.startTime as string) || '');
  const [endTime, setEndTime] = useState((data.endTime as string) || '');
  const [roomId, setRoomId] = useState((data.roomId as string) || '');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ title, description, startTime, endTime, roomId }),
    [title, description, startTime, endTime, roomId],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">日程标题</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="日程标题" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">描述</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="日程描述..." className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">开始时间</label>
        <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">结束时间</label>
        <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">会议室 ID（可选）</label>
        <input type="text" value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="预留会议室" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

function UploadFileConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [fileUrl, setFileUrl] = useState((data.fileUrl as string) || '');
  const [fileName, setFileName] = useState((data.fileName as string) || '');
  const [fileType, setFileType] = useState((data.fileType as string) || 'auto');
  const [folderToken, setFolderToken] = useState((data.folderToken as string) || '');

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ fileUrl, fileName, fileType, folderToken }),
    [fileUrl, fileName, fileType, folderToken],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">文件 URL</label>
        <input type="text" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://example.com/file.pdf" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">文件名（可选）</label>
        <input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="重命名文件" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">文件类型</label>
        <CustomSelect
          value={fileType}
          onChange={(val) => setFileType(val)}
          options={[
            { id: 'auto', name: '自动识别' },
            { id: 'docx', name: '文档' },
            { id: 'sheet', name: '表格' },
            { id: 'bitable', name: '多维表格' },
            { id: 'image', name: '图片' },
            { id: 'pdf', name: 'PDF' },
          ]}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">目标文件夹 Token（可选）</label>
        <input type="text" value={folderToken} onChange={(e) => setFolderToken(e.target.value)} placeholder="为空则放在根目录" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
    </div>
  );
}

function ApprovalConfig({ node }: { node: AppNode }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [approvalCode, setApprovalCode] = useState((data.approvalCode as string) || '');
  const [title, setTitle] = useState((data.title as string) || '');
  const [applicant, setApplicant] = useState((data.applicant as string) || '');
  const [formData, setFormData] = useState((data.formData as string) || '');
  const [approvers, setApprovers] = useState((data.approvers as string) || '[]');
  const [waitForResult, setWaitForResult] = useState<boolean>((data.waitForResult as boolean) ?? false);

  // 自动保存：配置变更即写入节点数据（无需手动点击保存）
  useNodeAutoSave(
    node.id,
    () => ({ approvalCode, title, applicant, formData, approvers, waitForResult }),
    [approvalCode, title, applicant, formData, approvers, waitForResult],
  );

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">审批定义 Code</label>
        <input type="text" value={approvalCode} onChange={(e) => setApprovalCode(e.target.value)} placeholder="7F28DDCB-..." className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">审批标题</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="审批标题" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">申请人 Open ID</label>
        <input type="text" value={applicant} onChange={(e) => setApplicant(e.target.value)} placeholder="ou_xxxx" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">审批人列表 (JSON 数组)</label>
        <input type="text" value={approvers} onChange={(e) => setApprovers(e.target.value)} placeholder='["ou_xxx","ou_yyy"]' className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">表单数据 (JSON)</label>
        <textarea value={formData} onChange={(e) => setFormData(e.target.value)} rows={4} placeholder='{"field_1": "value_1", "field_2": "value_2"}' className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-neutral-600">
          <input type="checkbox" checked={waitForResult} onChange={(e) => setWaitForResult(e.target.checked)} className="mr-1" />
          等待审批结果
        </label>
      </div>
    </div>
  );
}

// ====== 注册所有配置面板组件 ======

configPanelRegistry.register(NODE_TYPES.TRIGGER, TriggerConfig);
configPanelRegistry.register(NODE_TYPES.ACTION, ActionConfig);
configPanelRegistry.register(NODE_TYPES.FILTER, FilterConfig);
configPanelRegistry.register(NODE_TYPES.DELAY, DelayConfig);
configPanelRegistry.register(NODE_TYPES.HTTP, HttpConfig);
configPanelRegistry.register(NODE_TYPES.IM, ImConfig);
// 流程控制
configPanelRegistry.register(NODE_TYPES.SWITCH, SwitchConfig);
configPanelRegistry.register(NODE_TYPES.LOOP, LoopConfig);
configPanelRegistry.register(NODE_TYPES.MERGE, MergeConfig);
configPanelRegistry.register(NODE_TYPES.TRY_CATCH, TryCatchConfig);
// 数据转换
configPanelRegistry.register(NODE_TYPES.ASSIGN, AssignConfig);
configPanelRegistry.register(NODE_TYPES.AGGREGATE, AggregateConfig);
configPanelRegistry.register(NODE_TYPES.CODE, CodeConfig);
configPanelRegistry.register(NODE_TYPES.TEMPLATE, TemplateConfig);
// 通知
configPanelRegistry.register(NODE_TYPES.EMAIL, EmailConfig);
configPanelRegistry.register(NODE_TYPES.BOT_NOTIFY, BotNotifyConfig);
// 飞书生态
configPanelRegistry.register(NODE_TYPES.CREATE_DOC, CreateDocConfig);
configPanelRegistry.register(NODE_TYPES.CREATE_TASK, CreateTaskConfig);
configPanelRegistry.register(NODE_TYPES.CALENDAR_EVENT, CalendarEventConfig);
configPanelRegistry.register(NODE_TYPES.UPLOAD_FILE, UploadFileConfig);
configPanelRegistry.register(NODE_TYPES.APPROVAL, ApprovalConfig);

// ====== 主面板 ======

export default function ConfigPanel({ onListTables, onListFields }: ConfigPanelProps) {
  const selectedNodeId = useWorkflowEditorStore((s) => s.selectedNodeId);
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const setSelectedNodeId = useWorkflowEditorStore((s) => s.setSelectedNodeId);

  const node = nodes.find((n) => n.id === selectedNodeId);

  const handleClose = () => setSelectedNodeId(null);

  if (!node) return null;

  const renderConfig = () => {
    const rfType = node.type as string;
    const ConfigComp = configPanelRegistry.get(rfType);
    if (ConfigComp) {
      return <ConfigComp node={node} onListTables={onListTables} onListFields={onListFields} />;
    }
    return <div className="text-xs text-neutral-400">该节点无需配置</div>;
  };

  return (
    <div
      className="fixed top-0 right-0 h-full w-80 z-50 shadow-xl flex flex-col"
      style={{ background: 'var(--bg)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-sm font-semibold text-neutral-900">节点配置</h3>
        <button
          onClick={handleClose}
          className="p-1 rounded-md hover:bg-neutral-100 transition-colors"
        >
          <X className="w-4 h-4 text-neutral-400" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {renderConfig()}
      </div>
    </div>
  );
}
