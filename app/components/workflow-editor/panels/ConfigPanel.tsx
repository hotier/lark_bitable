/**
 * 节点配置抽屉 - 统一的节点配置面板
 *
 * 通过 ConfigPanelRegistry 将 rfType → 配置组件，替代硬编码 switch-case。
 * 添加新节点时，在此文件底部调用 configPanelRegistry.register() 即可。
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronDown, Plus, Trash2, GripVertical } from 'lucide-react';
import { useWorkflowEditorStore, type AppNode, NODE_TYPES } from '@/lib/workflow-engine/editor-store';
import type { Field, FilterCondition, FieldMapping, CrdAction } from '@/types';
import { CRUD_ACTION_META, FIELD_TYPE_OPTIONS } from '@/types';

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

/** 统一的主选择器样式：等宽（w-full + min-w-0）+ 文字溢出省略号（truncate）
 *  min-w-0 关键：原生 <select> 默认 min-width 由最长 option 文本决定，
 *  长名称（如多维表格名）会撑宽下拉框导致不等宽，min-w-0 让其收缩到父容器宽度。 */
const SELECT_CLS =
  'w-full min-w-0 truncate rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300';

// ====== 自定义下拉选择器（替代原生 <select>，确保框+展开列表均等宽+省略号） ======

interface SelectOption {
  id: string;
  name: string;
}

function CustomSelect({
  value,
  onChange,
  options = [],
  placeholder = '请选择',
  disabled = false,
  loading = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((o) => o.id === value)?.name || '';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`${SELECT_CLS} text-left flex items-center justify-between gap-1`}
      >
        <span className="truncate flex-1 text-left">{selectedLabel || placeholder}</span>
        {loading ? (
          <svg className="w-3 h-3 animate-spin text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-full max-h-48 overflow-y-auto bg-white rounded-lg border border-neutral-200 shadow-xl z-20 py-1 animate-scale-in origin-top">
            {options.length === 0 && !loading && (
              <div className="text-xs text-neutral-400 px-3 py-2">{placeholder === '请选择' ? '暂无数据' : placeholder}</div>
            )}
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => { onChange(opt.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                  opt.id === value
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                <span className="truncate block">{opt.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ====== 配置组件类型 ======

type ConfigComponent = React.FC<{ node: AppNode; onClose: () => void } & ConfigPanelProps>;

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

function TriggerConfig({ node, onClose, onListTables }: { node: AppNode; onClose: () => void } & ConfigPanelProps) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const apps = useWorkflowEditorStore((s) => s.apps);
  const data = node.data as Record<string, unknown>;
  const [triggerKind, setTriggerKind] = useState((data.triggerKind as string) || 'webhook');
  const [webhookUrl, setWebhookUrl] = useState((data.webhookUrl as string) || `/api/trigger-webhook/${node.id}`);
  const [secretToken, setSecretToken] = useState((data.secretToken as string) || '');
  const [webhookBodyTemplate, setWebhookBodyTemplate] = useState((data.webhookBodyTemplate as string) || '');
  const [cronExpression, setCronExpression] = useState((data.cronExpression as string) || '');
  const [freq, setFreq] = useState<ScheduleFreq>('daily');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [weekday, setWeekday] = useState(1);
  const [monthDay, setMonthDay] = useState(1);
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
    const p = parseCron(cronExpression);
    setFreq(p.freq);
    setScheduleTime(p.time);
    setWeekday(p.weekday);
    setMonthDay(p.monthDay);
    if (p.freq !== 'custom') setCronExpression(buildCron(p.freq, p.time, p.weekday, p.monthDay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSchedule = (
    f: ScheduleFreq = freq,
    t: string = scheduleTime,
    w: number = weekday,
    d: number = monthDay,
  ) => {
    if (f !== 'custom') setCronExpression(buildCron(f, t, w, d));
  };

  const handleSave = () => {
    updateNodeData(node.id, {
      triggerKind, webhookUrl, secretToken, webhookBodyTemplate,
      cronExpression, eventAppToken, eventTableId, eventType,
    });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">触发器类型</label>
        <select
          value={triggerKind}
          onChange={(e) => setTriggerKind(e.target.value)}
          className={SELECT_CLS}
        >
          <option value="webhook">Webhook</option>
          <option value="scheduled">定时触发</option>
          <option value="bitable_event">多维表格事件</option>
        </select>
      </div>
      {triggerKind === 'webhook' && (
        <>
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">Webhook URL</label>
            <input
              type="text" value={resolveWebhookUrl(webhookUrl)}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-neutral-50"
              readOnly
            />
            <p className="text-[10px] text-neutral-400 mt-1">外部系统 POST 到此地址触发工作流</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">安全 Token（可选）</label>
            <input
              type="text" value={secretToken}
              onChange={(e) => setSecretToken(e.target.value)}
              placeholder="可选，用于验证请求来源"
              className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
            />
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
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">执行频率</label>
            <select
              value={freq}
              onChange={(e) => { const f = e.target.value as ScheduleFreq; setFreq(f); updateSchedule(f); }}
              className={SELECT_CLS}
            >
              <option value="minute">每分钟</option>
              <option value="hourly">每小时</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="monthly">每月</option>
              <option value="custom">自定义（高级 Cron）</option>
            </select>
          </div>

          {freq === 'hourly' && (
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">第几分钟触发</label>
              <input
                type="number" min={0} max={59}
                value={Number(scheduleTime.split(':')[1])}
                onChange={(e) => {
                  const t = `00:${String(e.target.value || '0').padStart(2, '0')}`;
                  setScheduleTime(t);
                  updateSchedule(freq, t);
                }}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
              />
              <p className="text-[10px] text-neutral-400 mt-1">每小时的第 {Number(scheduleTime.split(':')[1])} 分钟执行</p>
            </div>
          )}

          {(freq === 'daily' || freq === 'weekly' || freq === 'monthly') && (
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">执行时间</label>
              <input
                type="time" value={scheduleTime}
                onChange={(e) => { const t = e.target.value; setScheduleTime(t); updateSchedule(freq, t); }}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
              />
            </div>
          )}

          {freq === 'weekly' && (
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">星期</label>
              <select
                value={weekday}
                onChange={(e) => { const w = Number(e.target.value); setWeekday(w); updateSchedule(freq, scheduleTime, w); }}
                className={SELECT_CLS}
              >
                {['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </div>
          )}

          {freq === 'monthly' && (
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">每月几号</label>
              <select
                value={monthDay}
                onChange={(e) => { const d = Number(e.target.value); setMonthDay(d); updateSchedule(freq, scheduleTime, weekday, d); }}
                className={SELECT_CLS}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d} 号</option>
                ))}
              </select>
            </div>
          )}

          {freq === 'custom' && (
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">Cron 表达式</label>
              <input
                type="text"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                placeholder="0 9 * * *"
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
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
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as 'record_created' | 'record_updated' | 'record_deleted')}
              className={SELECT_CLS}
            >
              <option value="record_created">记录创建</option>
              <option value="record_updated">记录更新</option>
              <option value="record_deleted">记录删除</option>
            </select>
          </div>
          <p className="text-[10px] text-neutral-400">需在飞书开放平台配置多维表格事件回调，将事件推送到本工作流 Webhook 后生效</p>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function ActionConfig({ node, onClose, onListTables, onListFields }: { node: AppNode; onClose: () => void } & ConfigPanelProps) {
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

  const handleSave = () => {
    updateNodeData(node.id, {
      label: CRUD_ACTION_META[actionType]?.label || '操作',
      actionType, targetAppToken, targetTableId, targetTableName,
      fieldMappings, filters,
    });
    onClose();
  };

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
                    <select
                      value={m.source}
                      onChange={(e) => {
                        const newMaps = [...fieldMappings];
                        newMaps[idx] = { ...newMaps[idx], source: e.target.value as 'manual' | 'webhook' | 'variable' };
                        setFieldMappings(newMaps);
                      }}
                      className="text-xs rounded border border-neutral-200 px-2 py-1 bg-white shrink-0"
                    >
                      <option value="manual">手动输入</option>
                      <option value="webhook">Webhook 参数</option>
                      <option value="variable">变量</option>
                    </select>
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
                  <select
                    value={f.operator}
                    onChange={(e) => {
                      const newFilters = [...filters];
                      newFilters[idx] = { ...newFilters[idx], operator: e.target.value as FilterCondition['operator'] };
                      setFilters(newFilters);
                    }}
                    className="text-xs rounded border border-neutral-200 px-2 py-1 bg-white"
                  >
                    <option value="eq">=</option>
                    <option value="ne">≠</option>
                    <option value="contains">包含</option>
                    <option value="gt">&gt;</option>
                    <option value="lt">&lt;</option>
                    <option value="gte">≥</option>
                    <option value="lte">≤</option>
                  </select>
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

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function FilterConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
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

  const handleSave = () => {
    updateNodeData(node.id, { conditions, matchMode });
    onClose();
  };

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
            <select
              value={c.operator}
              onChange={(e) => {
                const newConds = [...conditions];
                newConds[idx] = { ...newConds[idx], operator: e.target.value as FilterCondition['operator'] };
                setConditions(newConds);
              }}
              className="text-xs rounded border border-neutral-200 px-2 py-1 bg-white"
            >
              <option value="eq">=</option>
              <option value="ne">≠</option>
              <option value="contains">包含</option>
              <option value="gt">&gt;</option>
              <option value="lt">&lt;</option>
              <option value="gte">≥</option>
              <option value="lte">≤</option>
            </select>
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

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function DelayConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [duration, setDuration] = useState((data.duration as number) || 1);
  const [unit, setUnit] = useState((data.unit as string) || 'minutes');

  const handleSave = () => {
    updateNodeData(node.id, { duration, unit });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="number" min={1} value={duration}
          onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))}
          className="w-24 rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
        >
          <option value="seconds">秒</option>
          <option value="minutes">分钟</option>
          <option value="hours">小时</option>
          <option value="days">天</option>
        </select>
      </div>
      <p className="text-[10px] text-neutral-400">注意：最大延时 5 分钟（serverless 限制）</p>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function HttpConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [url, setUrl] = useState((data.url as string) || '');
  const [method, setMethod] = useState((data.method as string) || 'GET');
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>(
    (data.headers as { key: string; value: string }[]) || [],
  );
  const [body, setBody] = useState((data.body as string) || '');

  const addHeader = () => setHeaders([...headers, { key: '', value: '' }]);

  const handleSave = () => {
    updateNodeData(node.id, { url, method, headers, body });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
        >
          {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
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

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function ImConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [msgType, setMsgType] = useState<'text' | 'card'>((data.msgType as 'text' | 'card') || 'text');
  const [textContent, setTextContent] = useState((data.textContent as string) || '');
  const [cardJson, setCardJson] = useState((data.cardJson as string) || '');
  const [receiveIdType, setReceiveIdType] = useState((data.receiveIdType as string) || 'open_id');
  const [receiveId, setReceiveId] = useState((data.receiveId as string) || '');

  const handleSave = () => {
    updateNodeData(node.id, {
      msgType, textContent, cardJson, receiveIdType, receiveId,
    });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">接收人类型</label>
        <select
          value={receiveIdType}
          onChange={(e) => setReceiveIdType(e.target.value)}
          className={SELECT_CLS}
        >
          <option value="open_id">Open ID</option>
          <option value="user_id">User ID</option>
          <option value="union_id">Union ID</option>
          <option value="email">邮箱</option>
          <option value="chat_id">群聊 ID</option>
        </select>
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

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

// ====== 流程控制配置面板 ======

function SwitchConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
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

  const handleSave = () => {
    updateNodeData(node.id, { branches, hasDefault });
    onClose();
  };

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
                <select value={b.operator} onChange={(e) => { const n = [...branches]; n[idx] = { ...n[idx], operator: e.target.value }; setBranches(n); }} className="text-xs rounded border border-neutral-200 px-2 py-1 bg-white">
                  <option value="eq">=</option><option value="ne">≠</option><option value="contains">包含</option><option value="gt">&gt;</option><option value="lt">&lt;</option>
                </select>
                <input type="text" value={b.value} onChange={(e) => { const n = [...branches]; n[idx] = { ...n[idx], value: e.target.value }; setBranches(n); }} placeholder="值" className="flex-1 text-xs rounded border border-neutral-200 px-2 py-1 bg-white" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function LoopConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [mode, setMode] = useState((data.mode as string) || 'fixed_count');
  const [count, setCount] = useState((data.count as number) || 5);
  const [iterateSource, setIterateSource] = useState((data.iterateSource as string) || '');
  const [maxIterations, setMaxIterations] = useState((data.maxIterations as number) || 100);

  const handleSave = () => {
    updateNodeData(node.id, { mode, count, iterateSource, maxIterations });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">循环模式</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={SELECT_CLS}>
          <option value="fixed_count">固定次数</option>
          <option value="iterate_array">迭代数组</option>
        </select>
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
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function MergeConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [mode, setMode] = useState((data.mode as string) || 'append');
  const [joinKey, setJoinKey] = useState((data.joinKey as string) || '');

  const handleSave = () => {
    updateNodeData(node.id, { mode, joinKey });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">合并模式</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={SELECT_CLS}>
          <option value="append">追加（数组）</option>
          <option value="combine">对象合并</option>
          <option value="join">Key 关联</option>
        </select>
      </div>
      {mode === 'join' && (
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">关联 Key</label>
          <input type="text" value={joinKey} onChange={(e) => setJoinKey(e.target.value)} placeholder="例如: record_id" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function TryCatchConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [continueOnError, setContinueOnError] = useState<boolean>((data.continueOnError as boolean) ?? true);
  const [maxRetries, setMaxRetries] = useState((data.maxRetries as number) || 3);
  const [retryDelayMs, setRetryDelayMs] = useState((data.retryDelayMs as number) || 1000);

  const handleSave = () => {
    updateNodeData(node.id, { continueOnError, maxRetries, retryDelayMs });
    onClose();
  };

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
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

// ====== 数据转换配置面板 ======

function AssignConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [variables, setVariables] = useState<{ name: string; value: string; source: string; webhookKey?: string }[]>(
    (data.variables as unknown[])?.map((v: unknown) => v as { name: string; value: string; source: string; webhookKey?: string }) || [],
  );

  const addVar = () => setVariables([...variables, { name: '', value: '', source: 'manual' }]);

  const handleSave = () => {
    updateNodeData(node.id, { variables });
    onClose();
  };

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
              <select value={v.source} onChange={(e) => { const n = [...variables]; n[idx] = { ...n[idx], source: e.target.value }; setVariables(n); }} className="text-xs rounded border border-neutral-200 px-2 py-1 bg-white">
                <option value="manual">手动</option>
                <option value="webhook">Webhook</option>
                <option value="expression">表达式</option>
              </select>
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
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function AggregateConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [operation, setOperation] = useState((data.operation as string) || 'count');
  const [fieldName, setFieldName] = useState((data.fieldName as string) || '');
  const [resultVariable, setResultVariable] = useState((data.resultVariable as string) || 'aggregate_result');

  const handleSave = () => {
    updateNodeData(node.id, { operation, fieldName, resultVariable });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">聚合操作</label>
        <select value={operation} onChange={(e) => setOperation(e.target.value)} className={SELECT_CLS}>
          <option value="count">计数</option><option value="sum">求和</option><option value="avg">平均值</option><option value="min">最小值</option><option value="max">最大值</option><option value="group_by">分组</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">目标字段</label>
        <input type="text" value={fieldName} onChange={(e) => setFieldName(e.target.value)} placeholder="字段名或 webhook key" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">结果变量名</label>
        <input type="text" value={resultVariable} onChange={(e) => setResultVariable(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function CodeConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [code, setCode] = useState((data.code as string) || '// 可访问 data (上游输出) 和 ctx\n// 将结果赋值给 exports.result\nconst result = data;\nexports.result = result;');
  const [language, setLanguage] = useState((data.language as string) || 'javascript');
  const [timeout, setTimeout_] = useState((data.timeout as number) || 5000);

  const handleSave = () => {
    updateNodeData(node.id, { code, language, timeout });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">语言</label>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className={SELECT_CLS}>
          <option value="javascript">JavaScript</option>
          <option value="python">Python（需要运行时）</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">代码</label>
        <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={8} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">超时 (ms)</label>
        <input type="number" min={1000} max={30000} value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function TemplateConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [template, setTemplate] = useState((data.template as string) || '你好 {{name}}，你的订单 {{order_id}} 已处理完成。');
  const [engine, setEngine] = useState((data.engine as string) || 'plain');
  const [resultVariable, setResultVariable] = useState((data.resultVariable as string) || 'rendered');

  const handleSave = () => {
    updateNodeData(node.id, { template, engine, resultVariable });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">模板引擎</label>
        <select value={engine} onChange={(e) => setEngine(e.target.value)} className={SELECT_CLS}>
          <option value="plain">纯文本 {'{{var}}'}</option>
          <option value="handlebars">Handlebars</option>
          <option value="mustache">Mustache</option>
        </select>
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
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

// ====== 通知配置面板 ======

function EmailConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [to, setTo] = useState((data.to as string) || '');
  const [toSource, setToSource] = useState((data.toSource as string) || 'manual');
  const [subject, setSubject] = useState((data.subject as string) || '');
  const [body, setBody] = useState((data.body as string) || '');
  const [bodyFormat, setBodyFormat] = useState((data.bodyFormat as string) || 'text');

  const handleSave = () => {
    updateNodeData(node.id, { to, toSource, subject, body, bodyFormat });
    onClose();
  };

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
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function BotNotifyConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [channel, setChannel] = useState((data.channel as string) || 'feishu');
  const [webhookUrl, setWebhookUrl] = useState((data.webhookUrl as string) || '');
  const [title, setTitle] = useState((data.title as string) || '');
  const [content, setContent] = useState((data.content as string) || '');

  const handleSave = () => {
    updateNodeData(node.id, { channel, webhookUrl, title, content });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">通知渠道</label>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className={SELECT_CLS}>
          <option value="feishu">飞书</option><option value="dingtalk">钉钉</option><option value="wechat_work">企业微信</option><option value="slack">Slack</option>
        </select>
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
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

// ====== 飞书生态配置面板 ======

function CreateDocConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [title, setTitle] = useState((data.title as string) || '');
  const [docType, setDocType] = useState((data.docType as string) || 'docx');
  const [content, setContent] = useState((data.content as string) || '');
  const [folderToken, setFolderToken] = useState((data.folderToken as string) || '');

  const handleSave = () => {
    updateNodeData(node.id, { title, docType, content, folderToken });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">文档类型</label>
        <select value={docType} onChange={(e) => setDocType(e.target.value)} className={SELECT_CLS}>
          <option value="docx">文档</option><option value="sheet">表格</option><option value="slide">幻灯片</option><option value="bitable">多维表格</option>
        </select>
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
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function CreateTaskConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [title, setTitle] = useState((data.title as string) || '');
  const [description, setDescription] = useState((data.description as string) || '');
  const [assignee, setAssignee] = useState((data.assignee as string) || '');
  const [priority, setPriority] = useState((data.priority as string) || 'medium');
  const [dueDate, setDueDate] = useState((data.dueDate as string) || '');

  const handleSave = () => {
    updateNodeData(node.id, { title, description, assignee, priority, dueDate });
    onClose();
  };

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
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={SELECT_CLS}>
          <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">截止时间</label>
        <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function CalendarEventConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [title, setTitle] = useState((data.title as string) || '');
  const [description, setDescription] = useState((data.description as string) || '');
  const [startTime, setStartTime] = useState((data.startTime as string) || '');
  const [endTime, setEndTime] = useState((data.endTime as string) || '');
  const [roomId, setRoomId] = useState((data.roomId as string) || '');

  const handleSave = () => {
    updateNodeData(node.id, { title, description, startTime, endTime, roomId });
    onClose();
  };

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
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function UploadFileConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [fileUrl, setFileUrl] = useState((data.fileUrl as string) || '');
  const [fileName, setFileName] = useState((data.fileName as string) || '');
  const [fileType, setFileType] = useState((data.fileType as string) || 'auto');
  const [folderToken, setFolderToken] = useState((data.folderToken as string) || '');

  const handleSave = () => {
    updateNodeData(node.id, { fileUrl, fileName, fileType, folderToken });
    onClose();
  };

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
        <select value={fileType} onChange={(e) => setFileType(e.target.value)} className={SELECT_CLS}>
          <option value="auto">自动识别</option><option value="docx">文档</option><option value="sheet">表格</option><option value="bitable">多维表格</option><option value="image">图片</option><option value="pdf">PDF</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-1">目标文件夹 Token（可选）</label>
        <input type="text" value={folderToken} onChange={(e) => setFolderToken(e.target.value)} placeholder="为空则放在根目录" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
      </div>
    </div>
  );
}

function ApprovalConfig({ node, onClose }: { node: AppNode; onClose: () => void }) {
  const updateNodeData = useWorkflowEditorStore((s) => s.updateNodeData);
  const data = node.data as Record<string, unknown>;
  const [approvalCode, setApprovalCode] = useState((data.approvalCode as string) || '');
  const [title, setTitle] = useState((data.title as string) || '');
  const [applicant, setApplicant] = useState((data.applicant as string) || '');
  const [formData, setFormData] = useState((data.formData as string) || '');
  const [approvers, setApprovers] = useState((data.approvers as string) || '[]');
  const [waitForResult, setWaitForResult] = useState<boolean>((data.waitForResult as boolean) ?? false);

  const handleSave = () => {
    updateNodeData(node.id, { approvalCode, title, applicant, formData, approvers, waitForResult });
    onClose();
  };

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
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50">取消</button>
        <button onClick={handleSave} className="px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600">保存</button>
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
      return <ConfigComp node={node} onClose={handleClose} onListTables={onListTables} onListFields={onListFields} />;
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
