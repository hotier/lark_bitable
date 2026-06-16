'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Settings, ClipboardList, Link, Clock, Calendar, Filter, Timer, X, Trash2, Plus, Search, Pencil, AlertTriangle, Globe, MessageSquare, Send, GripVertical, Copy, Play, Type, Hash, CircleDot, CheckSquare, Check, User, Paperclip, Phone, Mail, Sigma, UserPlus, History, Monitor, Webhook, ArrowUpLeft, Pin, Table as TableIcon } from 'lucide-react';
import type { Field, Workflow, WorkflowNode, NodeKind, CrdAction, FieldMapping, FilterCondition, FilterOp, App, Table, TriggerKind } from '@/types';
import { CRUD_ACTION_META, TRIGGER_KIND_META } from '@/types';
import ConfirmDialog from '@/app/components/ConfirmDialog';

/** 递归扁平化对象 key：{a:{b:1}, c:2} → ["a.b","c"] */
function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const record = obj as Record<string, unknown>;
  const keys: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

// ====== 图标映射 ======
const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  create_record: Plus,
  read_records: Search,
  update_record: Pencil,
  delete_record: Trash2,
  filter: Filter,
  delay: Timer,
  http_request: Globe,
  im_message: MessageSquare,
};
const VAR_ICONS_BASE: Record<string, React.ComponentType<{ className?: string }>> = {
  sys_time: Clock,
  sys_date: Calendar,
  webhook_payload: Link,
};
const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '系统变量': Monitor,
  'Webhook 触发': Webhook,
  '上一节点输出': ArrowUpLeft,
};
const TRIGGER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  webhook: Webhook,
  scheduled: Clock,
  bitable_event: TableIcon,
};
const OP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  filter: Filter,
  delay: Timer,
  http_request: Globe,
  im_message: Send,
};

// ====== 字段类型图标（与多维表格保持一致，使用 lucide-react） ======
const FIELD_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  text: Type, number: Hash, single_select: CircleDot, multi_select: CheckSquare,
  date: Calendar, checkbox: Check, person: User, url: Link, file: Paperclip,
  phone: Phone, email: Mail, formula: Sigma, lookup: Search,
  created_time: Clock, created_by: UserPlus, updated_time: History, updated_by: User,
};

// ====== 常量 ======
const STORAGE_KEY = 'bitable_workflows';

// ====== localStorage 工具 ======
function loadWorkflows(): Workflow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveWorkflows(workflows: Workflow[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
}

// ====== Props ======
interface WorkflowManagerProps {
  /** 可用多维表格列表 */
  apps: App[];
  /** 获取某应用下的数据表列表 */
  onListTables: (appToken: string) => Promise<Table[]>;
  /** 获取某数据表的字段列表 */
  onListFields: (appToken: string, tableId: string) => Promise<Field[]>;
  /** CRUD 操作回调（appToken/tableId 由调用方从节点配置中取） */
  onCreateRecord: (appToken: string, tableId: string, fields: Record<string, unknown>) => Promise<unknown>;
  onListRecords: (appToken: string, tableId: string) => Promise<unknown>;
  onUpdateRecord: (appToken: string, tableId: string, recordId: string, fields: Record<string, unknown>) => Promise<unknown>;
  onDeleteRecord: (appToken: string, tableId: string, recordId: string) => Promise<unknown>;
  /** 详情模式：直接进入指定工作流的编辑器视图（不显示首页和左侧列表） */
  targetWorkflowId?: string;
}

// ====== 节点颜色 ======
const NODE_STYLE: Record<string, { bg: string; border: string; text: string; iconBg: string }> = {
  trigger:      { bg: 'bg-blue-50/80', border: 'border-blue-200', text: 'text-blue-700', iconBg: 'bg-blue-100' },
  action:       { bg: 'bg-amber-50/80', border: 'border-amber-200', text: 'text-amber-700', iconBg: 'bg-amber-100' },
  filter:       { bg: 'bg-purple-50/80', border: 'border-purple-200', text: 'text-purple-700', iconBg: 'bg-purple-100' },
  delay:        { bg: 'bg-orange-50/80', border: 'border-orange-200', text: 'text-orange-700', iconBg: 'bg-orange-100' },
  http_request: { bg: 'bg-teal-50/80', border: 'border-teal-200', text: 'text-teal-700', iconBg: 'bg-teal-100' },
  im_message:   { bg: 'bg-violet-50/80', border: 'border-violet-200', text: 'text-violet-700', iconBg: 'bg-violet-100' },
  end:          { bg: 'bg-neutral-100/80', border: 'border-neutral-200', text: 'text-neutral-500', iconBg: 'bg-neutral-200' },
};

// ====== 辅助 ======
const idGen = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

function generateWebhookId(): string {
  // 生成 32 位 hex 字符串，与飞书 webhook 格式一致：a70af54e80adc8e62a9f4921b38e8b91
  return crypto.randomUUID().replace(/-/g, '');
}

function makeDefaultTriggerConfig(): import('@/types').TriggerConfig {
  return {
    triggerKind: 'webhook',
    webhookUrl: `/api/trigger-webhook/${generateWebhookId()}`,
    secretToken: '',
  };
}

/** 将存储的相对路径解析为完整 URL（自动跟随当前域名） */
function resolveWebhookUrl(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return path.startsWith('http') ? path : `${origin}${path}`;
}


function makeDefaultWorkflow(existingNames?: Set<string>): Workflow {
  // 生成唯一默认名称
  let defaultName = '机器人指令 1';
  if (existingNames) {
    let i = 1;
    while (existingNames.has(`机器人指令 ${i}`)) i++;
    defaultName = `机器人指令 ${i}`;
  }
  return {
    id: idGen(),
    name: defaultName,
    status: 'draft',
    nodes: [
      { id: 'trigger', type: 'trigger', title: 'Webhook 触发', triggerConfig: makeDefaultTriggerConfig() },
      { id: idGen(), type: 'action', title: '新增记录', actionConfig: makeDefaultActionConfig('create_record') },
      { id: 'end', type: 'end', title: '结束' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeDefaultActionConfig(action: CrdAction): ActionConfigType {
  return { action, targetAppToken: '', targetTableId: '', fieldMappings: [], filters: [], filterLogic: 'and' };
}

type ActionConfigType = import('@/types').ActionConfig;

function makeEmptyMapping(field: Field): FieldMapping {
  return { fieldId: field.field_id, fieldName: field.name, fieldType: field.type, source: 'manual', manualValue: '', webhookKey: '', variableKey: '', variableLabel: '' };
}

// ====== SVG 图标 ======
function TriggerIcon() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.246l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.246"/></svg>; }
function EndIcon() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>; }

// ====== 动作节点配置面板（右侧滑出） ======
function ActionConfigPanel({
  node,
  apps,
  allNodes,
  nodeFieldsCache,
  onListTables,
  onListFields,
  onSave,
  onClose,
}: {
  node: WorkflowNode;
  apps: App[];
  allNodes: WorkflowNode[];
  nodeFieldsCache: Record<string, Field[]>;
  onListTables: (appToken: string) => Promise<Table[]>;
  onListFields: (appToken: string, tableId: string) => Promise<Field[]>;
  onSave: (config: ActionConfigType) => void;
  onClose: () => void;
}) {
  const cfg = node.actionConfig!;

  // ---- 状态 ----
  const [targetAppToken, setTargetAppToken] = useState(cfg.targetAppToken);
  const [targetTableId, setTargetTableId] = useState(cfg.targetTableId);
  const [targetTableName, setTargetTableName] = useState(cfg.targetTableName || '');
  const [mappings, setMappings] = useState<FieldMapping[]>(cfg.fieldMappings);
  const [filters, setFilters] = useState<FilterCondition[]>(cfg.filters);
  const [filterLogic, setFilterLogic] = useState<'and' | 'or'>(cfg.filterLogic || 'and');

  // 数据源加载状态 — tables 由下拉中的 AppTableGroupItem 懒加载，这里只管 fields
  const [nodeFields, setNodeFields] = useState<Field[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [tableDropdownOpen, setTableDropdownOpen] = useState(false);

  const showMapping = cfg.action === 'create_record' || cfg.action === 'update_record';
  const showFilter = cfg.action === 'read_records' || cfg.action === 'update_record' || cfg.action === 'delete_record';

  // ---- 当 targetAppToken + targetTableId 都有时，加载 fields ----
  useEffect(() => {
    if (!targetAppToken || !targetTableId) {
      setNodeFields([]);
      return;
    }
    setLoadingFields(true);
    onListFields(targetAppToken, targetTableId)
      .then((fields) => {
        setNodeFields(fields);
        // 选好数据表后，若尚无映射且需要映射，默认弹出第一个字段
        if (showMapping && fields.length > 0) {
          setMappings((prev) => (prev.length === 0 ? [makeEmptyMapping(fields[0])] : prev));
        }
      })
      .catch(() => setNodeFields([]))
      .finally(() => setLoadingFields(false));
  }, [targetAppToken, targetTableId, onListFields]);

  // 如果已有值且还没加载过，首次挂载时也加载
  useEffect(() => {
    if (cfg.targetAppToken && !targetAppToken) setTargetAppToken(cfg.targetAppToken);
    if (cfg.targetTableId && !targetTableId) setTargetTableId(cfg.targetTableId);
    if (cfg.targetTableName && !targetTableName) setTargetTableName(cfg.targetTableName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 字段映射操作 ----
  const toggleFieldMapping = (field: Field) => {
    const exists = mappings.find((m) => m.fieldId === field.field_id);
    if (exists) {
      setMappings(mappings.filter((m) => m.fieldId !== field.field_id));
    } else {
      setMappings([...mappings, makeEmptyMapping(field)]);
    }
  };

  const updateMapping = (fieldId: string, patch: Partial<FieldMapping>) => {
    setMappings(mappings.map((m) => (m.fieldId === fieldId ? { ...m, ...patch } : m)));
  };

  // ---- 筛选条件操作 ----
  const addFilter = () => {
    if (nodeFields.length === 0) return;
    const f = nodeFields[0];
    setFilters([...filters, { fieldId: f.field_id, fieldName: f.name, operator: 'eq', value: '', valueSource: 'manual' }]);
  };

  const updateFilter = (idx: number, patch: Partial<FilterCondition>) => {
    setFilters(filters.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const removeFilter = (idx: number) => setFilters(filters.filter((_, i) => i !== idx));

  // ---- 保存 ----
  const handleConfirm = () => {
    onSave({
      action: cfg.action,
      targetAppToken,
      targetTableId,
      targetTableName,
      fieldMappings: showMapping ? mappings : [],
      filters: showFilter ? filters : [],
      filterLogic: showFilter ? filterLogic : undefined,
    });
  };

  const meta = CRUD_ACTION_META[cfg.action];

  // ---- 根据动作类型动态标签 ----
  const mappingLabel: Record<string, string> = {
    create_record: '设置新增内容',
    update_record: '设置更新内容',
  };
  const emptyMappingHint: Record<string, string> = {
    create_record: '点击下方「添加」选择要写入的字段',
    update_record: '点击下方「添加」选择要更新的字段',
  };
  const noFilterHint: Record<string, string> = {
    read_records: '未设置筛选条件 — 将查询所有记录',
    update_record: '未设置筛选条件 — 将更新所有记录',
    delete_record: '未设置筛选条件 — 将删除所有记录',
  };

  // ---- 当前选中的 app/table 名称用于展示 ----
  const selectedAppName = apps.find((a) => a.app_token === targetAppToken)?.name ?? '';
  const selectedTargetLabel = targetAppToken
    ? (targetTableName ? `${selectedAppName}-${targetTableName}` : selectedAppName)
    : '';

  // ---- 预加载上一节点的字段（确保变量选择器有数据） ----
  const [prevFieldsCache, setPrevFieldsCache] = useState<Record<string, Field[]>>({});

  useEffect(() => {
    const currentIdx = allNodes.findIndex((n) => n.id === node.id);
    for (let i = currentIdx - 1; i >= 0; i--) {
      const pn = allNodes[i];
      if (pn.type === 'trigger' || pn.type === 'end') continue;
      // 加载当前节点之前所有非 trigger/end 节点的字段
      if (pn.type === 'action' && pn.actionConfig?.targetAppToken && pn.actionConfig?.targetTableId) {
        const key = pn.id;
        if (!nodeFieldsCache[key] && !prevFieldsCache[key]) {
          onListFields(pn.actionConfig.targetAppToken, pn.actionConfig.targetTableId)
            .then((fields) => setPrevFieldsCache((prev) => ({ ...prev, [key]: fields })))
            .catch(() => {});
        }
      }
    }
  }, [allNodes, node.id, nodeFieldsCache, prevFieldsCache, onListFields]);

  const mergedFieldCache = { ...nodeFieldsCache, ...prevFieldsCache };

  // 可用变量选项（系统 + Webhook + 之前所有节点输出 + 字段级变量）
  const variableOptions = buildVariableOptions(allNodes, node.id, mergedFieldCache);

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 bg-black/20 z-50" onClick={onClose} />

      {/* 面板 */}
      <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white shadow-lg z-50 flex flex-col animate-scale-in origin-right overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <div className="flex items-center gap-2.5">
            {(() => { const Icon = ACTION_ICONS[cfg.action]; return <Icon className="w-5 h-5" />; })()}
            <span className="text-base font-semibold text-neutral-800">{meta.label}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* 内容区 — 所有配置在同一页 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* ====== 选择数据源 ====== */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">选择数据表</label>

            {/* 多维表格选择 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setTableDropdownOpen(!tableDropdownOpen)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 bg-white border border-neutral-200 rounded-md text-sm text-left hover:border-neutral-300 transition-colors"
              >
                <span className={!selectedAppName ? 'text-neutral-300' : 'text-neutral-700'}>
                  {selectedAppName || '选择数据表'}
                </span>
                <svg className={`w-4 h-4 text-neutral-400 transition-transform ${tableDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                </svg>
              </button>

              {/* 下拉列表 */}
              {tableDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setTableDropdownOpen(false)} />
                  <div className="absolute z-50 mt-1 w-full bg-white border border-neutral-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
                    {apps.length === 0 ? (
                      <div className="p-4 text-sm text-neutral-400 text-center">暂无可用多维表格</div>
                    ) : (
                      apps.map((app) => (
                        <AppTableGroupItem
                          key={app.app_token}
                          app={app}
                          selectedAppToken={targetAppToken}
                          selectedTableId={targetTableId}
                          onSelect={(atoken, tId, tName) => {
                            setTargetAppToken(atoken);
                            setTargetTableId(tId);
                            setTargetTableName(tName);
                            setTableDropdownOpen(false);
                          }}
                          onListTables={onListTables}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 已选中的数据源提示 */}
            {selectedTargetLabel && (
              <div className="flex items-center gap-2 text-xs text-neutral-500 bg-neutral-50 rounded-lg px-3 py-2">
                <span>当前目标：</span>
                <span className="font-medium text-neutral-700">{selectedTargetLabel}</span>
              </div>
            )}
          </div>

          {/* ====== 字段映射（create_record / update_record） ====== */}
          {showMapping && (
            <div className="space-y-3">
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{mappingLabel[cfg.action] || '设置字段内容'}</label>

              {loadingFields && (
                <div className="text-xs text-neutral-400 flex items-center gap-1.5 py-2">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  加载字段中...
                </div>
              )}

              {!loadingFields && targetAppToken && targetTableId && (
                <>
                  {mappings.length === 0 && (
                    <div className="text-sm text-neutral-400 py-2 text-center border border-dashed border-neutral-200 rounded-md">
                      {emptyMappingHint[cfg.action] || '点击下方「添加」选择字段'}
                    </div>
                  )}

                  <div className="space-y-2">
                    {mappings.map((m, idx) => (
                      <FieldMappingRow
                        key={m.fieldId}
                        mapping={m}
                        idx={idx}
                        availableFields={nodeFields}
                        usedFieldIds={mappings.map((mm) => mm.fieldId)}
                        canRemove={mappings.length >= 2}
                        onChange={(patch) => updateMapping(m.fieldId, patch)}
                        onRemove={() => setMappings(mappings.filter((mm) => mm.fieldId !== m.fieldId))}
                        variableOptions={variableOptions}
                      />
                    ))}
                  </div>

                  {/* 添加按钮 */}
                  {nodeFields.length > 0 && mappings.length < nodeFields.length && (
                    <button
                      onClick={() => {
                        const unused = nodeFields.find((f) => !mappings.some((mm) => mm.fieldId === f.field_id));
                        if (unused) setMappings([...mappings, makeEmptyMapping(unused)]);
                      }}
                      className="flex items-center gap-1 text-sm text-amber-500 hover:text-amber-600 font-medium"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                      添加
                    </button>
                  )}
                </>
              )}

              {!loadingFields && targetAppToken && targetTableId && nodeFields.length === 0 && (
                <div className="text-sm text-neutral-400 py-4 text-center">暂无可用字段</div>
              )}
            </div>
          )}

          {/* ====== 筛选条件（read_records / update_record / delete_record） ====== */}
          {showFilter && (
            <div className="space-y-3">
              {/* 筛选标题 + AND/OR 模式切换 + 添加按钮 */}
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">筛选条件</label>
                {filters.length >= 2 && (
                  <div className="flex items-center bg-neutral-100 rounded-md p-0.5">
                    <button
                      onClick={() => setFilterLogic('and')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${filterLogic === 'and' ? 'bg-white text-neutral-700 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}
                    >
                      AND — 全部满足
                    </button>
                    <button
                      onClick={() => setFilterLogic('or')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${filterLogic === 'or' ? 'bg-white text-neutral-700 shadow-sm' : 'text-neutral-400 hover:text-neutral-600'}`}
                    >
                      OR — 任一满足
                    </button>
                  </div>
                )}
              </div>

              {/* 无数据表提示 */}
              {!targetAppToken || !targetTableId ? (
                <div className="text-sm text-neutral-400 py-4 text-center">请先选择目标数据表</div>
              ) : loadingFields ? (
                <div className="text-xs text-neutral-400 flex items-center gap-1.5 py-2">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  加载字段中...
                </div>
              ) : (
                <>
                  {/* ====== 筛选行列表 ====== */}
                  {filters.length > 0 && (
                    <div className="space-y-2">
                      {filters.map((f, i) => (
                        <FilterRow
                          key={i}
                          filter={f}
                          availableFields={nodeFields}
                          canRemove={true}
                          variableOptions={variableOptions}
                          onChange={(patch) => updateFilter(i, patch)}
                          onRemove={() => removeFilter(i)}
                        />
                      ))}
                    </div>
                  )}

                  {/* 空筛选条件 */}
                  {filters.length === 0 && (
                    <div className="text-sm text-neutral-400 py-3 text-center border border-dashed border-neutral-200 rounded-md">
                      {noFilterHint[cfg.action] || '未设置筛选条件'}
                    </div>
                  )}

                  {/* 添加筛选按钮 */}
                  {nodeFields.length > 0 && (
                    <button
                      onClick={addFilter}
                      className="flex items-center gap-1 text-sm text-amber-500 hover:text-amber-600 font-medium"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                      添加条件
                    </button>
                  )}
                </>
              )}

              {/* ====== read_records / delete_record 操作说明 ====== */}
              {!showMapping && targetAppToken && (
                <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3.5 space-y-2">
                  <div className="flex items-center gap-2">
                    {(() => { const Icon = ACTION_ICONS[cfg.action]; return <Icon className="w-4 h-4 text-amber-500" />; })()}
                    <span className="text-sm font-medium text-neutral-700">{meta.label}</span>
                  </div>
                  <p className="text-xs text-neutral-500 leading-relaxed">
                    {cfg.action === 'read_records' && '根据筛选条件查询数据表中的记录。未设置筛选条件时将返回所有记录。'}
                    {cfg.action === 'delete_record' && '根据筛选条件删除数据表中的记录。请务必在筛选条件中指定匹配规则，否则将删除所有记录。'}
                  </p>
                  {filters.length === 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 rounded-md px-2.5 py-1.5">
                      <AlertTriangle className="w-3 h-3" />
                      {cfg.action === 'read_records' && '建议设置筛选条件以限定查询范围'}
                      {cfg.action === 'delete_record' && '强烈建议设置筛选条件，防止误删数据'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-neutral-100 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-neutral-500 hover:text-neutral-700 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors">
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!targetAppToken || !targetTableId}
            className="px-5 py-2 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors shadow-sm shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            确定
          </button>
        </div>
      </div>
    </>
  );
}

// ====== 共享变量分组面板（分组折叠展开，默认收起） ======
function VariableGroupPanel({
  variableOptions,
  selectedKey,
  onSelect,
}: {
  variableOptions: VariableOption[];
  selectedKey?: string;
  onSelect: (v: VariableOption) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // 按 group 分组
  const varsByGroup = variableOptions.reduce<Record<string, VariableOption[]>>((acc, v) => {
    (acc[v.group] ||= []).push(v);
    return acc;
  }, {});

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <div className="py-1">
      {Object.entries(varsByGroup).map(([group, vars]) => {
        const expanded = expandedGroups[group] || false;
        const GroupIcon = GROUP_ICONS[group] || null;
        return (
          <div key={group}>
            {/* 分组标题 — 点击展开/收起 */}
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className="w-full flex items-center gap-1.5 px-3.5 py-1.5 bg-neutral-50 hover:bg-neutral-100 transition-colors sticky top-0 z-10"
            >
              <svg
                className={`w-3 h-3 text-neutral-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
              {GroupIcon ? <GroupIcon className="w-3.5 h-3.5 text-neutral-400" /> : <Pin className="w-3.5 h-3.5 text-neutral-400" />}
              <span className="text-xs font-semibold text-neutral-600">{group}</span>
              <span className="ml-auto text-[10px] text-neutral-300">{vars.length}</span>
            </button>

            {/* 展开后的变量列表 */}
            {expanded && (
              <div className="pb-1">
                {vars.map((v) => {
                  const FieldIcon = v.fieldType ? FIELD_TYPE_ICON[v.fieldType] : null;
                  return (
                  <button
                    key={v.id}
                    onClick={() => { onSelect(v); }}
                    className={`w-full flex items-center gap-2 px-5 py-2.5 hover:bg-amber-50/50 transition-colors text-left ${
                      selectedKey && (selectedKey.includes(v.label) || selectedKey === v.id)
                        ? 'bg-amber-50/50'
                        : ''
                    }`}
                  >
                    {FieldIcon ? (
                      <FieldIcon className="w-4 h-4 text-neutral-400 shrink-0" />
                    ) : (
                      <span className="w-4 h-4 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0 text-xs text-neutral-600 truncate">{v.label.startsWith(v.group + '丨') ? v.label.slice(v.group.length + 1) : v.label}</div>
                    {selectedKey && (selectedKey.includes(v.label) || selectedKey === v.id) && (
                      <Check className="w-3 h-3 text-amber-500 shrink-0" />
                    )}
                  </button>
                )})}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ====== 字段映射行组件（每行：字段下拉 | 值输入 ⊕变量选择） ======

/** 变量选项类型 */
interface VariableOption { id: string; label: string; desc: string; group: string; icon?: string; fieldType?: string; }

/** 基础变量选项 — 系统变量永远可用 */
const BASE_VARIABLE_OPTIONS: VariableOption[] = [
  { id: 'sys_time', label: '系统时间', desc: '当前系统时间（ISO 格式）', group: '系统变量' },
  { id: 'sys_date', label: '系统日期', desc: '当前日期（yyyy-MM-dd）', group: '系统变量' },
];

/** 筛选条件运算符中文标签 */
const FILTER_OP_LABEL: Record<string, string> = {
  eq: '等于',
  ne: '不等于',
  contains: '包含',
  gt: '大于',
  lt: '小于',
  gte: '大于等于',
  lte: '小于等于',
};

/** 获取节点在 workflow 中的序号（1-based，过滤 trigger/end 后的实际节点顺序） */
function getNodeSeq(allNodes: WorkflowNode[], nodeId: string): number {
  let seq = 0;
  for (const n of allNodes) {
    if (n.type === 'trigger' || n.type === 'end') continue;
    seq++;
    if (n.id === nodeId) return seq;
  }
  return 0;
}

/** 序号 → 显示字符（1. / 2. / …） */
function formatSeq(seq: number): string {
  return `${seq}.`;
}

/** 构建动态变量选项：系统变量 + Webhook 变量 + 之前所有节点输出 */
function buildVariableOptions(
  allNodes: WorkflowNode[],
  currentNodeId: string,
  fieldCache?: Record<string, Field[]>,
): VariableOption[] {
  const options = [...BASE_VARIABLE_OPTIONS];

  // 从 trigger 节点的 webhookBodyTemplate JSON 解析 Webhook 变量
  const triggerNode = allNodes.find((n) => n.type === 'trigger');
  const template = triggerNode?.triggerConfig?.webhookBodyTemplate ?? '';
  const templateKeys: string[] = (() => {
    if (!template.trim()) return [];
    try {
      const obj = JSON.parse(template);
      const content = obj?.content ?? obj;
      return flattenKeys(content);
    } catch {
      return [];
    }
  })();

  if (templateKeys.length > 0) {
    templateKeys.forEach((k) => {
      options.push({ id: `webhook:${k}`, label: `Webhook 触发丨${k}`, desc: '来自重解析后的 Webhook JSON', group: 'Webhook 触发' });
    });
  } else {
    // 回退：从已有节点引用中收集
    const wpKeys = collectWebhookParams(allNodes);
    if (wpKeys.length > 0) {
      wpKeys.forEach((k) => {
        options.push({ id: `webhook:${k}`, label: `Webhook 触发丨${k}`, desc: '来自 Webhook 触发的 content 字段', group: 'Webhook 触发' });
      });
    } else if (triggerNode) {
      options.push({ id: 'webhook_payload', label: 'Webhook 触发', desc: '引用 Webhook content 中的字段', group: 'Webhook 触发' });
    }
  }

  // 取当前节点之前所有步骤（非 trigger/end）的节点输出
  const currentIdx = allNodes.findIndex((n) => n.id === currentNodeId);
  const prevNodes: WorkflowNode[] = [];
  for (let i = currentIdx - 1; i >= 0; i--) {
    const n = allNodes[i];
    if (n.type !== 'trigger' && n.type !== 'end') {
      prevNodes.push(n);
    }
  }
  prevNodes.reverse(); // 升序：最早节点在前
  for (const n of prevNodes) {
    if (n.type === 'action' && n.actionConfig) {
      const ac = n.actionConfig;
      const meta = CRUD_ACTION_META[ac.action];
      const seq = formatSeq(getNodeSeq(allNodes, n.id));
      const label = `${seq}${meta?.label || n.title}`;
      const fields = fieldCache?.[n.id] ?? [];
      const groupName = label; // 分组标题：序号+节点名称

      // 先添加字段级变量（上一条记录的所有字段原文，作为默认常用变量）
      if (fields.length > 0 && (ac.action === 'create_record' || ac.action === 'read_records' || ac.action === 'update_record' || ac.action === 'delete_record')) {
        const ctxLabel = ac.action === 'create_record' ? '新增' : ac.action === 'read_records' ? '查询' : ac.action === 'update_record' ? '更新' : '删除';
        for (const f of fields) {
          options.push({
            id: `prev:${n.id}:fields:${f.name}`,
            label: `${label}丨${f.name}`,
            desc: `${ctxLabel}记录中字段「${f.name}」`,
            group: groupName,
            fieldType: f.type,
          });
        }
      }

      // 通用变量（记录 ID、完整记录等）已移除，只保留数据表字段级变量
    }
    if (n.type === 'http_request' && n.httpRequestConfig?.saveResponse) {
      const seq = formatSeq(getNodeSeq(allNodes, n.id));
      const label = `${seq}${n.title}`;
      const groupName = label;
      options.push(
        { id: `prev:${n.id}:response`, label: `${label}丨响应数据`, desc: 'HTTP 请求的完整响应体', group: groupName },
        { id: `prev:${n.id}:status_code`, label: `${label}丨状态码`, desc: 'HTTP 响应状态码（如 200, 404）', group: groupName },
        { id: `prev:${n.id}:response_time`, label: `${label}丨响应时间`, desc: 'HTTP 请求耗时（毫秒）', group: groupName },
      );
    }
  }

  return options;
}

function FieldMappingRow({
  mapping,
  idx,
  availableFields,
  usedFieldIds,
  canRemove,
  onChange,
  onRemove,
  variableOptions,
}: {
  mapping: FieldMapping;
  idx: number;
  availableFields: Field[];
  usedFieldIds: string[];
  canRemove: boolean;
  onChange: (patch: Partial<FieldMapping>) => void;
  onRemove: () => void;
  variableOptions: VariableOption[];
}) {
  const [showVarPicker, setShowVarPicker] = useState(false);

  return (
    <div className="flex gap-2 items-start">
      {/* 字段名下拉 */}
      <select
        value={mapping.fieldId}
        onChange={(e) => {
          const f = availableFields.find((ff) => ff.field_id === e.target.value);
          if (f) onChange({ fieldId: f.field_id, fieldName: f.name, fieldType: f.type });
        }}
        className="w-[140px] shrink-0 px-3 py-2 border border-neutral-200 rounded-lg text-sm bg-white text-neutral-700 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300"
      >
        {availableFields.map((f) => (
          <option key={f.field_id} value={f.field_id} disabled={f.field_id !== mapping.fieldId && usedFieldIds.includes(f.field_id)}>
            {f.name}
          </option>
        ))}
      </select>

      {/* 值输入区 — ⊕ 按钮嵌入在输入框内部右侧 */}
      <div className="flex-1 relative">
        <input
          type="text"
          value={
            mapping.source === 'manual' ? mapping.manualValue :
            mapping.source === 'variable' ? mapping.variableLabel :
            mapping.webhookKey
          }
          onChange={(e) => {
            if (mapping.source === 'manual') onChange({ manualValue: e.target.value });
            else if (mapping.source === 'variable') onChange({ variableLabel: e.target.value });
            else onChange({ webhookKey: e.target.value });
          }}
          placeholder={
            mapping.source === 'manual' ? '请输入值' :
            mapping.source === 'variable' ? '变量引用' :
            'Webhook 变量 (如 time)'
          }
          readOnly={mapping.source === 'variable'}
          className={`w-full pl-3 pr-9 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 ${
            mapping.source === 'variable'
              ? 'border-purple-200 bg-purple-50/50 text-purple-700 placeholder:text-purple-300'
              : 'border-neutral-200 text-neutral-700 placeholder:text-neutral-300 focus:border-amber-300'
          }`}
        />
        {/* ⊕ 内嵌按钮 */}
        <button
          type="button"
          onClick={() => setShowVarPicker(!showVarPicker)}
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center transition-colors ${
            showVarPicker
              ? 'bg-amber-100 text-amber-500'
              : 'text-neutral-400 hover:text-amber-500 hover:bg-amber-50'
          }`}
          title="插入变量"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
          </svg>
        </button>

        {/* 变量选择弹出面板 — 分组折叠展开 */}
        {showVarPicker && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowVarPicker(false)} />
            <div className="absolute z-50 mt-1.5 w-full bg-white border border-neutral-200 rounded-md shadow-lg overflow-hidden max-h-72 overflow-y-auto">
              <VariableGroupPanel
                variableOptions={variableOptions}
                selectedKey={mapping.source === 'variable' ? mapping.variableKey : mapping.source === 'webhook' ? `webhook:${mapping.webhookKey}` : undefined}
                onSelect={(v) => {
                  if (v.id.startsWith('webhook:')) {
                    const key = v.id.slice('webhook:'.length);
                    onChange({ source: 'webhook', webhookKey: key, manualValue: '', variableKey: '', variableLabel: '' });
                  } else if (v.group === 'Webhook 触发') {
                    onChange({ source: 'webhook', webhookKey: 'content.', manualValue: '', variableKey: '', variableLabel: '' });
                  } else if (v.id.startsWith('prev:') || v.group === '系统变量') {
                    onChange({ source: 'variable', variableKey: v.id, variableLabel: v.label, manualValue: '', webhookKey: '' });
                  } else {
                    onChange({ source: 'manual', manualValue: `$\{${v.label}}`, webhookKey: '', variableKey: '', variableLabel: '' });
                  }
                  setShowVarPicker(false);
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* 删除按钮 — 仅在可删除时显示 */}
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-neutral-300 hover:text-red-400 hover:bg-red-50 transition-colors"
          title="删除此行"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      )}
    </div>
  );
}

// ====== 筛选条件行组件（字段 | 运算符 | 值 ⊕变量选择） ======
function FilterRow({
  filter,
  availableFields,
  canRemove,
  variableOptions,
  onChange,
  onRemove,
}: {
  filter: FilterCondition;
  availableFields: Field[];
  canRemove: boolean;
  variableOptions: VariableOption[];
  onChange: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
}) {
  const vs = filter.valueSource || 'manual';
  const [showVarPicker, setShowVarPicker] = useState(false);

  return (
    <div className="flex items-start gap-2 bg-neutral-50 rounded-md p-2.5 border border-neutral-100">
      {/* 字段下拉 */}
      <select
        value={filter.fieldId}
        onChange={(e) => {
          const field = availableFields.find((ff) => ff.field_id === e.target.value);
          onChange({ fieldId: e.target.value, fieldName: field?.name ?? '' });
        }}
        className="px-2 py-1.5 border border-neutral-200 rounded-lg text-xs bg-white text-neutral-600 focus:outline-none min-w-0 flex-1"
      >
        {availableFields.map((ff) => (
          <option key={ff.field_id} value={ff.field_id}>{ff.name}</option>
        ))}
      </select>

      {/* 运算符下拉 */}
      <select
        value={filter.operator}
        onChange={(e) => onChange({ operator: e.target.value as FilterOp })}
        className="px-2 py-1.5 border border-neutral-200 rounded-lg text-xs bg-white text-neutral-600 focus:outline-none w-[72px] shrink-0"
      >
        <option value="eq">等于</option>
        <option value="ne">不等于</option>
        <option value="contains">包含</option>
        <option value="gt">大于</option>
        <option value="lt">小于</option>
        <option value="gte">大于等于</option>
        <option value="lte">小于等于</option>
      </select>

      {/* 值输入区 — ⊕ 按钮在内 */}
      <div className="flex-1 relative min-w-0">
        <input
          type="text"
          value={vs === 'variable' ? (filter.variableKey || '') : filter.value}
          onChange={(e) => {
            if (vs === 'variable') onChange({ variableKey: e.target.value });
            else onChange({ value: e.target.value });
          }}
          placeholder={vs === 'variable' ? '变量引用' : '值'}
          className={`w-full pl-3 pr-9 py-1.5 border rounded-lg text-xs focus:outline-none ${
            vs === 'variable'
              ? 'border-purple-200 bg-purple-50/50 text-purple-700 placeholder:text-purple-300'
              : 'border-neutral-200 text-neutral-600 placeholder:text-neutral-300'
          }`}
        />
        {/* ⊕ 内嵌变量按钮 */}
        <button
          type="button"
          onClick={() => setShowVarPicker(!showVarPicker)}
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-xs transition-colors ${
            showVarPicker
              ? 'bg-amber-100 text-amber-500'
              : vs === 'variable' ? 'text-purple-400 hover:text-amber-500 hover:bg-amber-50' : 'text-neutral-400 hover:text-amber-500 hover:bg-amber-50'
          }`}
          title="插入变量"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
          </svg>
        </button>

        {/* 变量选择弹出面板 — 分组折叠展开 */}
        {showVarPicker && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowVarPicker(false)} />
            <div className="absolute z-50 mt-1.5 w-full bg-white border border-neutral-200 rounded-md shadow-lg overflow-hidden max-h-80 overflow-y-auto">
              {/* 手动输入选项 */}
              <button
                onClick={() => { onChange({ valueSource: 'manual', variableKey: '' }); setShowVarPicker(false); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-neutral-50 transition-colors text-left ${vs === 'manual' ? 'bg-amber-50/50' : ''}`}
              >
                <Pencil className="w-3.5 h-3.5 text-neutral-400" />
                <div>
                  <div className="text-sm font-medium text-neutral-700">手动输入</div>
                  <div className="text-[11px] text-neutral-400">直接填写固定值</div>
                </div>
                {vs === 'manual' && <Check className="ml-auto w-3 h-3 text-amber-500" />}
              </button>
              {/* 分隔线 */}
              <div className="border-t border-neutral-100" />
              {/* 分组折叠变量 */}
              <VariableGroupPanel
                variableOptions={variableOptions}
                selectedKey={vs === 'variable' ? filter.variableKey : undefined}
                onSelect={(v) => {
                  onChange({ valueSource: 'variable', variableKey: v.label, value: '' });
                  setShowVarPicker(false);
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* 删除按钮 */}
      {canRemove && (
        <button
          onClick={onRemove}
          className="shrink-0 text-neutral-300 hover:text-red-400 transition-colors mt-0.5"
          title="删除此条件"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      )}
    </div>
  );
}

// ====== 下拉列表中的 App 分组项（默认收起，点击展开加载 tables） ======
function AppTableGroupItem({
  app,
  selectedAppToken,
  selectedTableId,
  onSelect,
  onListTables,
}: {
  app: App;
  selectedAppToken: string;
  selectedTableId: string;
  onSelect: (appToken: string, tableId: string, tableName: string) => void;
  onListTables: (appToken: string) => Promise<Table[]>;
}) {
  const [tables, setTables] = useState<Table[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  // 展开时懒加载
  const toggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) {
      setLoading(true);
      onListTables(app.app_token)
        .then((data) => setTables(data))
        .catch(() => setTables([]))
        .finally(() => { setLoading(false); setLoaded(true); });
    }
  };

  return (
    <div>
      {/* App 分组标题 — 可点击展开/收起 */}
      <button
        type="button"
        onClick={toggleExpand}
        className="w-full flex items-center gap-1.5 px-3.5 py-1.5 bg-neutral-50 hover:bg-neutral-100 transition-colors sticky top-0 z-10"
      >
        <svg
          className={`w-3 h-3 text-neutral-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
        </svg>
        <span className="text-xs font-semibold text-neutral-600">{app.name}</span>
      </button>

      {/* 展开后的数据表列表 */}
      {expanded && (
        <div className="pb-1">
          {loading ? (
            <div className="px-8 py-2 text-xs text-neutral-400">加载中...</div>
          ) : tables.length === 0 ? (
            <div className="px-8 py-2 text-xs text-neutral-300">暂无数据表</div>
          ) : (
            tables.map((t) => (
              <button
                key={t.table_id}
                type="button"
                onClick={(e) => { e.stopPropagation(); onSelect(app.app_token, t.table_id, t.name); }}
                className={`w-full text-left px-8 py-2 text-sm transition-colors flex items-center gap-2 ${
                  selectedAppToken === app.app_token && selectedTableId === t.table_id
                    ? 'bg-amber-50 text-amber-600 font-medium'
                    : 'hover:bg-neutral-50 text-neutral-600'
                }`}
              >
                <span className="text-xs text-neutral-300">▸</span>
                {t.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ====== 判断节点是否已配置 ======
function isNodeConfigured(node: WorkflowNode): boolean {
  if (node.type === 'action') return !!(node.actionConfig?.targetAppToken && node.actionConfig?.targetTableId);
  if (node.type === 'filter') return !!(node.filterConfig?.conditions.length);
  if (node.type === 'delay') return !!(node.delayConfig?.duration);
  if (node.type === 'http_request') return !!(node.httpRequestConfig?.url);
  if (node.type === 'im_message') return !!(node.imConfig?.msgType === 'text' ? node.imConfig?.textContent : node.imConfig?.cardJson);
  if (node.type === 'trigger') return true;
  return false;
}

// ====== 节点是否可删除 ======
function isNodeDeletable(node: WorkflowNode): boolean {
  return node.type !== 'trigger' && node.type !== 'end';
}

// ====== 节点卡片（画布上） ======
function FlowNodeCard({
  node,
  apps,
  onConfig,
  onDelete,
  onCopy,
  onUpdateInline,
  draggable,
  onDragStart,
}: {
  node: WorkflowNode;
  apps: App[];
  onConfig: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onCopy: (nodeId: string) => void;
  onUpdateInline?: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  draggable?: boolean;
  onDragStart?: (e: React.MouseEvent, nodeId: string) => void;
}) {
  const style = NODE_STYLE[node.type] || NODE_STYLE.action;
  const meta = CRUD_ACTION_META[node.type] || null;
  const configured = isNodeConfigured(node);
  const deletable = isNodeDeletable(node);

  // 目标数据表名摘要（仅 CRUD action）
  let targetInfo = '';
  if (node.type === 'action' && node.actionConfig?.targetAppToken && node.actionConfig?.targetTableId) {
    const appName = apps.find((a) => a.app_token === node.actionConfig!.targetAppToken)?.name ?? '';
    const tableName = node.actionConfig.targetTableName || '';
    targetInfo = tableName ? `当前目标：${appName}-${tableName}` : `当前目标：${appName}`;
  }

  // 摘要文本
  let summaryText = '';
  if (node.type === 'filter' && node.filterConfig) {
    summaryText = node.filterConfig.conditions.length > 0
      ? `${node.filterConfig.conditions.length} 个条件 · ${node.filterConfig.matchMode === 'all' ? '全部匹配(AND)' : '任一匹配(OR)'}`
      : '点击「配置」设置筛选条件';
  } else if (node.type === 'delay' && node.delayConfig) {
    const unitLabel: Record<string, string> = { seconds: '秒', minutes: '分钟', hours: '小时', days: '天' };
    summaryText = `等待 ${node.delayConfig.duration} ${unitLabel[node.delayConfig.unit] || node.delayConfig.unit}`;
  } else if (node.type === 'http_request' && node.httpRequestConfig) {
    summaryText = node.httpRequestConfig.url
      ? `${node.httpRequestConfig.method} ${node.httpRequestConfig.url.substring(0, 50)}${node.httpRequestConfig.url.length > 50 ? '...' : ''}`
      : '点击「配置」设置请求参数';
  } else if (node.type === 'im_message' && node.imConfig) {
    summaryText = node.imConfig.msgType === 'text'
      ? `文本: ${node.imConfig.textContent?.substring(0, 30) || '未配置'}`
      : '卡片消息';
  }

  const borderClass = configured
    ? `${style.border}`
    : 'border-red-300 ring-1 ring-red-200';

  // 点击卡片打开配置（end 节点无配置）
  const handleCardClick = () => {
    if (node.type !== 'end') onConfig(node.id);
  };

  return (
    <div
      onClick={handleCardClick}
      className={`${style.bg} border rounded-lg p-3 w-[300px] transition-all hover:shadow-md cursor-pointer relative ${borderClass} ${configured ? '' : 'shadow-sm'}`}
    >
      {/* 右上角操作按钮（hover 显示） */}
      {deletable && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          {/* 复制按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); onCopy(node.id); }}
            className="w-6 h-6 rounded flex items-center justify-center bg-white/80 text-neutral-400 hover:text-blue-500 hover:bg-blue-50 transition-colors shadow-sm"
            title="复制节点"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          {/* 删除按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
            className="w-6 h-6 rounded flex items-center justify-center bg-white/80 text-neutral-400 hover:text-red-400 hover:bg-red-50 transition-colors shadow-sm"
            title="删除节点"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* 拖拽手柄 + 标题栏 */}
      <div className="flex items-center gap-2">
        {/* 拖拽手柄 */}
        {draggable && onDragStart && (
          <div
            onMouseDown={(e) => { e.preventDefault(); onDragStart(e, node.id); }}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-500 transition-colors flex-shrink-0"
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        {/* 图标 */}
        <div className={`w-8 h-8 rounded-lg ${style.iconBg} flex items-center justify-center ${style.text} flex-shrink-0`}>
          {node.type === 'trigger' ? <TriggerIcon /> : node.type === 'end' ? <EndIcon /> : (() => { const Icon = ACTION_ICONS[node.type] || (node.type === 'action' && node.actionConfig ? ACTION_ICONS[node.actionConfig.action] : Settings); return <Icon className="w-4 h-4" />; })()}
        </div>
        <div className="flex-1 min-w-0 pr-14">
          <div className={`font-semibold text-sm ${style.text} truncate`}>
            {meta ? meta.label : node.title}
          </div>
          {targetInfo && (
            <div className="text-[11px] text-neutral-400 truncate mt-0.5">{targetInfo}</div>
          )}
        </div>
      </div>

      {/* 摘要 */}
      {node.type === 'action' && node.actionConfig && (
        <div className="mt-2.5 space-y-1.5">
          {node.actionConfig.fieldMappings.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {node.actionConfig.fieldMappings.map((m) => (
                <span key={m.fieldId} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/70 border border-neutral-100 rounded-md text-[10px] text-neutral-500">
                  {m.fieldName}
                  <span className="text-amber-400">=</span>
                  {m.source === 'manual' ? (m.manualValue || '(空)') : m.source === 'variable' ? `$\{${m.variableLabel || '?'}\}` : `$\{${m.webhookKey || '?'}\}`}
                </span>
              ))}
            </div>
          )}
          {node.actionConfig.filters.length > 0 && (
            <div className="text-[10px] text-neutral-400">
              {node.actionConfig.filters.map((f, i) => (
                <span key={i}>{i > 0 && ' · '}{f.fieldName} {FILTER_OP_LABEL[f.operator] || f.operator} &ldquo;{f.valueSource === 'variable' ? `$\{${f.variableKey || '?'}\}` : f.value}&rdquo;</span>
              ))}
            </div>
          )}
          {node.actionConfig.fieldMappings.length === 0 && node.actionConfig.filters.length === 0 && (
            <div className="text-xs text-neutral-400">点击卡片设置操作参数</div>
          )}
        </div>
      )}
      {summaryText && node.type !== 'action' && (
        <div className="mt-2.5">
          {/* delay 节点：内联编辑器 */}
          {node.type === 'delay' && node.delayConfig && onUpdateInline ? (
            <DelayInlineEditor
              config={node.delayConfig}
              onChange={(cfg) => onUpdateInline(node.id, { delayConfig: cfg })}
            />
          ) : (
            <div className="text-xs text-neutral-500">{summaryText}</div>
          )}
          {/* 未配置提示 */}
          {!configured && node.type !== 'delay' && (
            <div className="text-[10px] text-red-400 mt-1">此节点尚未配置，流程执行时将被跳过</div>
          )}
        </div>
      )}
    </div>
  );
}

// ====== 延时节点内联编辑器 ======
function DelayInlineEditor({
  config,
  onChange,
}: {
  config: import('@/types').DelayConfig;
  onChange: (cfg: import('@/types').DelayConfig) => void;
}) {
  const unitLabel: Record<string, string> = { seconds: '秒', minutes: '分钟', hours: '小时', days: '天' };
  return (
    <div className="flex items-center gap-2 bg-white/60 rounded-md px-2 py-1.5 border border-neutral-100">
      <span className="text-xs text-neutral-400 flex-shrink-0">等待</span>
      <input
        type="number"
        min={1}
        value={config.duration}
        onChange={(e) => onChange({ ...config, duration: Math.max(1, Number(e.target.value)) })}
        className="w-14 px-1.5 py-0.5 border border-neutral-200 rounded text-xs text-center focus:outline-none focus:ring-2 focus:ring-orange-200"
        onClick={(e) => e.stopPropagation()}
      />
      <select
        value={config.unit}
        onChange={(e) => onChange({ ...config, unit: e.target.value as import('@/types').DelayConfig['unit'] })}
        className="px-1.5 py-0.5 border border-neutral-200 rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-orange-200"
        onClick={(e) => e.stopPropagation()}
      >
        {Object.entries(unitLabel).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
    </div>
  );
}

// ====== 触发节点配置面板（右侧滑出） ======

/** 收集工作流中所有引用了 webhook 的参数名 */
function collectWebhookParams(nodes: WorkflowNode[]): string[] {
  const params = new Set<string>();
  for (const node of nodes) {
    for (const m of node.actionConfig?.fieldMappings ?? []) {
      if (m.source === 'webhook' && m.webhookKey) {
        // 去掉 content. 前缀得到参数名
        const key = m.webhookKey.startsWith('content.') ? m.webhookKey.slice('content.'.length) : m.webhookKey;
        if (key) params.add(key);
      }
    }
  }
  return [...params].sort();
}

function TriggerConfigPanel({
  node,
  onSave,
  onClose,
}: {
  node: WorkflowNode;
  onSave: (config: import('@/types').TriggerConfig) => void;
  onClose: () => void;
}) {
  const tcfg = node.triggerConfig!;
  const [triggerKind, setTriggerKind] = useState<TriggerKind>(tcfg.triggerKind || 'webhook');
  const [secretToken, setSecretToken] = useState(tcfg.secretToken);
  const [cronExpression, setCronExpression] = useState(tcfg.cronExpression || '');
  const [copied, setCopied] = useState(false);
  const [jsonTemplate, setJsonTemplate] = useState(tcfg.webhookBodyTemplate || '');
  const [jsonError, setJsonError] = useState('');

  // 从 JSON template 提取所有扁平化的 key（content 层级的键）
  const parsedKeys: string[] = (() => {
    if (!jsonTemplate.trim()) return [];
    try {
      const obj = JSON.parse(jsonTemplate);
      const content = obj?.content ?? obj;
      return flattenKeys(content);
    } catch {
      return [];
    }
  })();

  const fullUrl = resolveWebhookUrl(tcfg.webhookUrl);


  const copyUrl = () => {
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSave = () => onSave({
    ...tcfg,
    triggerKind,
    secretToken: secretToken.trim(),
    cronExpression: triggerKind === 'scheduled' ? cronExpression : undefined,
    webhookBodyTemplate: jsonTemplate,
  });

  const handleJsonChange = (value: string) => {
    setJsonTemplate(value);
    if (!value.trim()) {
      setJsonError('');
      return;
    }
    try {
      JSON.parse(value);
      setJsonError('');
    } catch (e: any) {
      setJsonError(e.message);
    }
  };

  // 快捷插入键值对到 content 中
  const insertKeyValue = () => {
    const key = prompt('请输入键名 (key)：');
    if (!key) return;
    const val = prompt('请输入默认值（可选）：', '') || '...';
    try {
      const obj = jsonTemplate.trim() ? JSON.parse(jsonTemplate) : { msg_type: 'text', content: {} };
      if (!obj.content || typeof obj.content !== 'object') {
        obj.content = {};
      }
      obj.content[key] = val;
      const formatted = JSON.stringify(obj, null, 2);
      setJsonTemplate(formatted);
      setJsonError('');
    } catch {
      // 如果当前 JSON 不合法，构建新的
      const obj = { msg_type: 'text', content: { [key]: val } };
      setJsonTemplate(JSON.stringify(obj, null, 2));
      setJsonError('');
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-50" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[520px] bg-white shadow-lg z-50 flex flex-col animate-scale-in origin-right overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 shrink-0">
          <span className="text-base font-semibold text-neutral-800">触发配置</span>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 触发器类型选择 */}
          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3 block">触发器类型</label>
            <div className="space-y-2">
              {(Object.entries(TRIGGER_KIND_META) as [TriggerKind, typeof TRIGGER_KIND_META['webhook']][]).map(([kind, meta]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setTriggerKind(kind)}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                    triggerKind === kind
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                  }`}
                >
                  {(() => { const Icon = TRIGGER_ICONS[kind] || Settings; return <Icon className="w-5 h-5" />; })()}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${triggerKind === kind ? 'text-blue-700' : 'text-neutral-700'}`}>
                      {meta.label}
                    </div>
                    <div className="text-xs text-neutral-400 mt-0.5">{meta.desc}</div>
                  </div>
                  {kind !== 'webhook' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-400">即将推出</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Webhook 配置 */}
          {triggerKind === 'webhook' && (
            <>
              <div>
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">Webhook 地址</label>
                <div className="flex gap-2">
                  <input type="text" value={fullUrl} readOnly className="flex-1 px-3 py-2 border border-neutral-200 rounded-lg text-sm text-neutral-500 bg-neutral-50 font-mono select-all" />
                  <button onClick={copyUrl} className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${copied ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-600 border border-neutral-200'}`}>
                    {copied ? <><Check className="w-3.5 h-3.5 inline" /> 已复制</> : '复制'}
                  </button>
                </div>
                <p className="text-[11px] text-neutral-400 mt-1.5">外部系统向此地址发送 POST 请求即可触发自动化流程</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">
                  POST JSON 重解析 <span className="font-normal text-neutral-300">（编辑 JSON 重新解析外部传入的数据）</span>
                </label>
                <p className="text-[11px] text-neutral-400 mb-3">
                  外部 POST 的原始 JSON 可能无法被飞书直接解析。在此定义重解析后的 JSON 结构，解析后的键值将自动作为下游节点的变量选项。
                </p>

                {/* JSON 编辑器 */}
                <textarea
                  value={jsonTemplate}
                  onChange={(e) => handleJsonChange(e.target.value)}
                  placeholder={`{\n  "msg_type": "text",\n  "content": {\n    "order_id": "...",\n    "customer_name": "...",\n    "amount": "..."\n  }\n}`}
                  rows={jsonTemplate ? Math.max(6, jsonTemplate.split('\n').length + 1) : 6}
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 ${
                    jsonError
                      ? 'border-red-200 focus:ring-red-200 focus:border-red-300 bg-red-50/30'
                      : 'border-neutral-200 focus:ring-amber-200 focus:border-amber-300'
                  }`}
                  spellCheck={false}
                />
                {jsonError && (
                  <p className="text-[11px] text-red-400 mt-1">JSON 格式错误：{jsonError}</p>
                )}

                {/* 快捷操作 */}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={insertKeyValue}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-neutral-50 hover:bg-amber-50 text-neutral-500 hover:text-amber-600 border border-neutral-200 hover:border-amber-200 transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> 快捷添加键值
                  </button>
                  {!jsonTemplate.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        const defaultJson = JSON.stringify({ msg_type: 'text', content: {} }, null, 2);
                        setJsonTemplate(defaultJson);
                        setJsonError('');
                      }}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-neutral-50 hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 border border-neutral-200 transition-colors"
                    >
                      使用模板
                    </button>
                  )}
                </div>

                {/* 解析出的 keys */}
                {parsedKeys.length > 0 && (
                  <div className="mt-3">
                    <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">
                      已解析变量 <span className="font-normal text-emerald-400">（可直接在下游节点中引用）</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {parsedKeys.map((key) => (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-md text-xs"
                        >
                          <span className="text-emerald-700 font-medium">{key}</span>
                          <span className="text-emerald-400">→</span>
                          <code className="text-[10px] text-emerald-500 font-mono">{'{' + key + '}'}</code>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* JSON 预览（只读美化） */}
                {jsonTemplate.trim() && !jsonError && (
                  <div className="bg-neutral-50 border border-neutral-100 rounded-md p-3 mt-3">
                    <div className="text-[10px] text-neutral-400 mb-1.5">重解析后传递给下游的 JSON：</div>
                    <pre className="text-xs text-neutral-600 font-mono leading-relaxed whitespace-pre-wrap bg-white border border-neutral-100 rounded-lg p-3">
                      {jsonTemplate}
                    </pre>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">安全校验 Token <span className="font-normal text-neutral-300">（可选）</span></label>
                <input type="text" value={secretToken} onChange={(e) => setSecretToken(e.target.value)} placeholder="用于验证请求来源，留空则不校验" className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm text-neutral-700 placeholder:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-300" />
                <p className="text-[11px] text-neutral-400 mt-1.5">设置后可验证请求头 <code className="px-1 py-0.5 bg-neutral-100 rounded text-neutral-500">X-Webhook-Token</code> 的值</p>
              </div>

            </>
          )}

          {/* 定时触发配置（预览） */}
          {triggerKind === 'scheduled' && (
            <div>
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">Cron 表达式</label>
              <input type="text" value={cronExpression} onChange={(e) => setCronExpression(e.target.value)} placeholder="例如: 0 9 * * * (每天早上9点)" className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm text-neutral-700 placeholder:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 font-mono" />
              <p className="text-[11px] text-neutral-400 mt-1.5">使用标准 Cron 表达式定义执行时间。需要部署定时任务服务才能生效。</p>
            </div>
          )}

          {/* 多维表格事件触发（预览） */}
          {triggerKind === 'bitable_event' && (
            <div className="text-sm text-neutral-400 py-6 text-center border border-dashed border-neutral-200 rounded-md">
              多维表格事件触发需要配置飞书开放平台的事件订阅。<br/>此功能即将推出。
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-neutral-100 flex items-center justify-between shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition-colors">取消</button>
          <button onClick={handleSave} className="px-6 py-2 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors shadow-sm shadow-blue-500/20">保存</button>
        </div>
      </div>
    </>
  );
}

// ====== 筛选节点配置面板 ======
function FilterConfigPanel({
  node,
  onSave,
  onClose,
  webhookContentKeys,
}: {
  node: WorkflowNode;
  onSave: (config: import('@/types').FilterConfig) => void;
  onClose: () => void;
  webhookContentKeys: string[];
}) {
  const cfg = node.filterConfig!;
  const [conditions, setConditions] = useState<FilterCondition[]>(cfg.conditions);
  const [matchMode, setMatchMode] = useState<'any' | 'all'>(cfg.matchMode);

  const addCondition = () => setConditions([...conditions, { fieldId: '', fieldName: '', operator: 'eq', value: '' }]);
  const removeCondition = (idx: number) => setConditions(conditions.filter((_, i) => i !== idx));
  const updateCondition = (idx: number, patch: Partial<FilterCondition>) => {
    setConditions(conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-50" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white shadow-lg z-50 flex flex-col animate-scale-in origin-right overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 shrink-0">
          <span className="text-base font-semibold text-neutral-800">筛选条件配置</span>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 匹配模式 */}
          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">匹配模式</label>
            <div className="flex gap-2">
              {(['all', 'any'] as const).map((mode) => (
                <button key={mode} type="button" onClick={() => setMatchMode(mode)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${matchMode === mode ? 'border-purple-300 bg-purple-50 text-purple-700' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'}`}>
                  {mode === 'all' ? '全部匹配 (AND)' : '任一匹配 (OR)'}
                </button>
              ))}
            </div>
          </div>

          {/* 条件列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">筛选条件</label>
              <button type="button" onClick={addCondition} className="text-xs text-purple-600 hover:text-purple-700 font-medium">+ 添加条件</button>
            </div>
            {conditions.length === 0 ? (
              <div className="text-sm text-neutral-400 py-6 text-center border border-dashed border-neutral-200 rounded-md">暂无筛选条件，点击上方按钮添加</div>
            ) : (
              <div className="space-y-3">
                {conditions.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 p-3 bg-neutral-50 rounded-lg border border-neutral-100">
                    <input type="text" value={c.fieldName} onChange={(e) => updateCondition(i, { fieldName: e.target.value })} placeholder="字段名" className="flex-1 px-2 py-1.5 border border-neutral-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-purple-200" />
                    <select value={c.operator} onChange={(e) => updateCondition(i, { operator: e.target.value as FilterOp })} className="px-2 py-1.5 border border-neutral-200 rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-purple-200">
                      <option value="eq">等于</option><option value="ne">不等于</option><option value="contains">包含</option>
                      <option value="gt">大于</option><option value="lt">小于</option><option value="gte">大于等于</option><option value="lte">小于等于</option>
                    </select>
                    <input type="text" value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="值" className="w-24 px-2 py-1.5 border border-neutral-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-purple-200" />
                    <button type="button" onClick={() => removeCondition(i)} className="text-neutral-300 hover:text-red-400 p-1"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {webhookContentKeys.length > 0 && (
            <div className="text-xs text-neutral-400">
              可用变量：{webhookContentKeys.map((k) => <code key={k} className="mx-1 px-1 py-0.5 bg-purple-50 text-purple-600 rounded">{'{' + k + '}'}</code>)}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-neutral-100 flex items-center justify-between shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition-colors">取消</button>
          <button onClick={() => onSave({ conditions, matchMode })} className="px-6 py-2 text-sm font-semibold text-white bg-purple-500 hover:bg-purple-600 rounded-lg transition-colors shadow-sm shadow-purple-500/20">保存</button>
        </div>
      </div>
    </>
  );
}

// ====== 延时节点配置面板 ======
function DelayConfigPanel({
  node,
  onSave,
  onClose,
}: {
  node: WorkflowNode;
  onSave: (config: import('@/types').DelayConfig) => void;
  onClose: () => void;
}) {
  const cfg = node.delayConfig!;
  const [duration, setDuration] = useState(cfg.duration);
  const [unit, setUnit] = useState(cfg.unit);

  const unitOptions: { value: string; label: string }[] = [
    { value: 'seconds', label: '秒' }, { value: 'minutes', label: '分钟' }, { value: 'hours', label: '小时' }, { value: 'days', label: '天' },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-50" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white shadow-lg z-50 flex flex-col animate-scale-in origin-right overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 shrink-0">
          <span className="text-base font-semibold text-neutral-800">延时配置</span>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">延迟时间</label>
            <div className="flex gap-2">
              <input type="number" min={1} value={duration} onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))} className="w-24 px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-200" />
              <select value={unit} onChange={(e) => setUnit(e.target.value as import('@/types').DelayConfig['unit'])} className="px-3 py-2 border border-neutral-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-200">
                {unitOptions.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1.5">最大延迟 5 分钟（受服务器超时限制）。延迟超过 5 分钟将被截断。</p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-100 flex items-center justify-between shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition-colors">取消</button>
          <button onClick={() => onSave({ duration, unit })} className="px-6 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors shadow-sm shadow-orange-500/20">保存</button>
        </div>
      </div>
    </>
  );
}

// ====== HTTP 请求节点配置面板 ======
function HttpRequestConfigPanel({
  node,
  onSave,
  onClose,
}: {
  node: WorkflowNode;
  onSave: (config: import('@/types').HttpRequestConfig) => void;
  onClose: () => void;
}) {
  const cfg = node.httpRequestConfig!;
  const [url, setUrl] = useState(cfg.url);
  const [method, setMethod] = useState(cfg.method);
  const [headers, setHeaders] = useState(cfg.headers);
  const [body, setBody] = useState(cfg.body);
  const [bodySource, setBodySource] = useState(cfg.bodySource);
  const [saveResponse, setSaveResponse] = useState(cfg.saveResponse);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: number; body: string; ok: boolean; durationMs: number } | null>(null);
  const [testError, setTestError] = useState('');

  const addHeader = () => setHeaders([...headers, { key: '', value: '' }]);
  const removeHeader = (idx: number) => setHeaders(headers.filter((_, i) => i !== idx));
  const updateHeader = (idx: number, patch: Partial<{ key: string; value: string }>) => {
    setHeaders(headers.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  };

  const handleTest = async () => {
    if (!url) { setTestError('请输入 URL'); return; }
    setTesting(true);
    setTestResult(null);
    setTestError('');
    const startTime = Date.now();
    try {
      const fetchHeaders: Record<string, string> = {};
      headers.filter((h) => h.key).forEach((h) => { fetchHeaders[h.key] = h.value; });
      const fetchOpts: RequestInit = { method, headers: fetchHeaders };
      if (method !== 'GET' && body) fetchOpts.body = body;
      const res = await fetch(url, fetchOpts);
      const text = await res.text();
      const durationMs = Date.now() - startTime;
      setTestResult({ status: res.status, body: text.substring(0, 2000), ok: res.ok, durationMs });
    } catch (err: unknown) {
      setTestError(`请求失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-50" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[520px] bg-white shadow-lg z-50 flex flex-col animate-scale-in origin-right overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 shrink-0">
          <span className="text-base font-semibold text-neutral-800">HTTP 请求配置</span>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">请求方法 & URL</label>
            <div className="flex gap-2">
              <select value={method} onChange={(e) => setMethod(e.target.value as import('@/types').HttpRequestConfig['method'])} className="w-24 px-2 py-2 border border-neutral-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-200 font-mono">
                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/api" className="flex-1 px-3 py-2 border border-neutral-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-200" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">请求头</label>
              <button type="button" onClick={addHeader} className="text-xs text-teal-600 hover:text-teal-700 font-medium">+ 添加</button>
            </div>
            {headers.length === 0 ? (
              <div className="text-xs text-neutral-400 py-3 text-center border border-dashed border-neutral-200 rounded-md">无自定义请求头</div>
            ) : (
              <div className="space-y-2">
                {headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" value={h.key} onChange={(e) => updateHeader(i, { key: e.target.value })} placeholder="Key" className="flex-1 px-2 py-1.5 border border-neutral-200 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-200" />
                    <input type="text" value={h.value} onChange={(e) => updateHeader(i, { value: e.target.value })} placeholder="Value" className="flex-1 px-2 py-1.5 border border-neutral-200 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-200" />
                    <button type="button" onClick={() => removeHeader(i)} className="text-neutral-300 hover:text-red-400 p-1"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {method !== 'GET' && (
            <div>
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">请求体</label>
              <div className="flex gap-2 mb-2">
                {(['manual', 'webhook'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setBodySource(s)} className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${bodySource === s ? 'border-teal-300 bg-teal-50 text-teal-700' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'}`}>
                    {s === 'manual' ? '手动输入' : 'Webhook 数据'}
                  </button>
                ))}
              </div>
              {bodySource === 'manual' && (
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder='{"key": "value"}' className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-200" />
              )}
            </div>
          )}

          {/* 测试结果 */} 
          {testResult && (
            <div className={`border rounded-lg p-3 ${testResult.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${testResult.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {testResult.status}
                </span>
                <span className="text-xs text-neutral-500">{testResult.durationMs}ms</span>
              </div>
              <pre className="text-[10px] text-neutral-600 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto bg-white/60 rounded p-2">{testResult.body || '(空响应)'}</pre>
            </div>
          )}
          {testError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-600">{testError}</div>
          )}

          <div className="flex items-center gap-2">
            <input type="checkbox" id="saveResponse" checked={saveResponse} onChange={(e) => setSaveResponse(e.target.checked)} className="w-4 h-4 rounded border-neutral-300 text-teal-500 focus:ring-teal-200" />
            <label htmlFor="saveResponse" className="text-sm text-neutral-600">保存响应到执行日志</label>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition-colors">取消</button>
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !url}
              className="px-4 py-2 text-sm font-medium text-teal-600 bg-teal-50 border border-teal-200 rounded-lg hover:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              {testing ? (
                <><span className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" /> 测试中...</>
              ) : (
                <><Play className="w-3.5 h-3.5" /> 测试请求</>
              )}
            </button>
          </div>
          <button onClick={() => onSave({ url, method, headers: headers.filter((h) => h.key), body, bodySource, saveResponse })} className="px-6 py-2 text-sm font-semibold text-white bg-teal-500 hover:bg-teal-600 rounded-lg transition-colors shadow-sm shadow-teal-500/20">保存</button>
        </div>
      </div>
    </>
  );
}

// ====== IM 消息节点配置面板 ======
function ImMessageConfigPanel({
  node,
  onSave,
  onClose,
}: {
  node: WorkflowNode;
  onSave: (config: import('@/types').ImMessageConfig) => void;
  onClose: () => void;
}) {
  const cfg = node.imConfig!;
  const [receiveIdType, setReceiveIdType] = useState(cfg.receiveIdType);
  const [receiveId, setReceiveId] = useState(cfg.receiveId);
  const [receiveIdSource, setReceiveIdSource] = useState(cfg.receiveIdSource);
  const [receiveIdWebhookKey, setReceiveIdWebhookKey] = useState(cfg.receiveIdWebhookKey);
  const [msgType, setMsgType] = useState(cfg.msgType);
  const [textContent, setTextContent] = useState(cfg.textContent);
  const [textSource, setTextSource] = useState(cfg.textSource);
  const [cardJson, setCardJson] = useState(cfg.cardJson);
  const [cardSource, setCardSource] = useState(cfg.cardSource);

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-50" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[520px] bg-white shadow-lg z-50 flex flex-col animate-scale-in origin-right overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 shrink-0">
          <span className="text-base font-semibold text-neutral-800">飞书消息配置</span>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 接收人 */}
          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">接收人</label>
            <select value={receiveIdType} onChange={(e) => setReceiveIdType(e.target.value as import('@/types').ImMessageConfig['receiveIdType'])} className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-violet-200">
              <option value="open_id">Open ID</option><option value="user_id">User ID</option><option value="union_id">Union ID</option><option value="email">邮箱</option><option value="chat_id">群聊 ID</option>
            </select>
            <div className="flex gap-2 mb-2">
              {(['manual', 'webhook'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setReceiveIdSource(s)} className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${receiveIdSource === s ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'}`}>
                  {s === 'manual' ? '手动输入' : 'Webhook 变量'}
                </button>
              ))}
            </div>
            {receiveIdSource === 'manual' ? (
              <input type="text" value={receiveId} onChange={(e) => setReceiveId(e.target.value)} placeholder="输入接收人 ID" className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-200" />
            ) : (
              <input type="text" value={receiveIdWebhookKey} onChange={(e) => setReceiveIdWebhookKey(e.target.value)} placeholder="content.xxx (Webhook 变量)" className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-200" />
            )}
          </div>

          {/* 消息类型 */}
          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">消息类型</label>
            <div className="flex gap-2">
              {(['text', 'card'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setMsgType(t)} className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${msgType === t ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'}`}>
                  {t === 'text' ? '文本消息' : '卡片消息'}
                </button>
              ))}
            </div>
          </div>

          {/* 文本消息内容 */}
          {msgType === 'text' && (
            <div>
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">文本内容</label>
              <div className="flex gap-2 mb-2">
                {(['manual', 'webhook'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setTextSource(s)} className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${textSource === s ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'}`}>
                    {s === 'manual' ? '手动输入' : 'Webhook 变量'}
                  </button>
                ))}
              </div>
              {textSource === 'manual' ? (
                <textarea value={textContent} onChange={(e) => setTextContent(e.target.value)} rows={3} placeholder="输入消息文本..." className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              ) : (
                <p className="text-xs text-neutral-400">消息文本将从 Webhook 请求的 content 中自动获取</p>
              )}
            </div>
          )}

          {/* 卡片消息内容 */}
          {msgType === 'card' && (
            <div>
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">卡片 JSON</label>
              <div className="flex gap-2 mb-2">
                {(['manual', 'webhook'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setCardSource(s)} className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${cardSource === s ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'}`}>
                    {s === 'manual' ? '手动输入' : 'Webhook 变量'}
                  </button>
                ))}
              </div>
              {cardSource === 'manual' && (
                <textarea value={cardJson} onChange={(e) => setCardJson(e.target.value)} rows={8} placeholder='{"header": {"title": {"content": "标题"}},"elements": [{"tag": "div","text": {"content": "内容"}}]}' className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-200" />
              )}
              <p className="text-[11px] text-neutral-400 mt-1">使用飞书卡片 JSON 格式，详见飞书开放平台卡片文档</p>
            </div>
          )}

          {/* 消息预览 */} 
          {((msgType === 'text' && textContent) || (msgType === 'card' && cardJson)) && (
            <div>
              <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 block">消息预览</label>
              <div className="border border-violet-200 bg-violet-50/30 rounded-lg p-3">
                {msgType === 'text' ? (
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-neutral-100">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded bg-violet-500 flex items-center justify-center text-white text-[10px] font-bold">我</div>
                      <span className="text-xs text-neutral-400">发送者</span>
                    </div>
                    <p className="text-sm text-neutral-700 whitespace-pre-wrap">{textContent}</p>
                  </div>
                ) : (
                  <div>
                    <div className="text-[10px] text-neutral-400 mb-1.5">飞书卡片结构：</div>
                    <pre className="text-[10px] text-neutral-600 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto bg-white/60 rounded p-2 border border-violet-50">
                      {(() => { try { return JSON.stringify(JSON.parse(cardJson), null, 2); } catch { return cardJson; } })()}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-neutral-100 flex items-center justify-between shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition-colors">取消</button>
          <button onClick={() => onSave({ receiveIdType, receiveId, receiveIdSource, receiveIdWebhookKey, msgType, textContent, textSource, cardJson, cardSource })} className="px-6 py-2 text-sm font-semibold text-white bg-violet-500 hover:bg-violet-600 rounded-lg transition-colors shadow-sm shadow-violet-500/20">保存</button>
        </div>
      </div>
    </>
  );
}

// ====== 连接器 ======
function Connector({ onOpenAddMenu }: { onOpenAddMenu: () => void }) {
  return (
    <div className="relative py-2 flex justify-center group/connector" style={{ height: '40px' }}>
      {/* 上竖线 */}
      <div className="absolute top-0 h-[calc(50%-10px)] w-px bg-neutral-200 group-hover/connector:bg-amber-300 transition-colors" />
      {/* 下竖线 */}
      <div className="absolute bottom-0 h-[calc(50%-10px)] w-px bg-neutral-200 group-hover/connector:bg-amber-300 transition-colors" />
      {/* 箭头 */ }
      <svg className="absolute top-1 w-3 h-3 text-neutral-200 group-hover/connector:text-amber-300 transition-colors" viewBox="0 0 12 12" fill="none">
        <path d="M6 12V3M6 3L2 7M6 3L10 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {/* 添加按钮 */}
      <button
        onClick={onOpenAddMenu}
        className="relative z-10 w-8 h-8 rounded-full bg-white border-2 border-dashed border-neutral-300 text-neutral-400 hover:border-amber-400 hover:text-amber-500 hover:bg-amber-50 flex items-center justify-center transition-all shadow-sm group-hover/connector:border-solid"
      >
        <Plus className="w-4 h-4" />
      </button>
      {/* hover 标签 */}
      <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-0.5 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-md shadow-sm opacity-0 group-hover/connector:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
        添加步骤
      </span>
    </div>
  );
}

// ====== 操作选择面板（点击 + 号弹出） ======

/** 操作项定义 */
interface OperationItem {
  id: string;
  name: string;
  desc: string;
  color: string; // 图标背景色，如 'bg-blue-100 text-neutral-500'
  /** 对应的操作类型标识 */
  actionType?: string;
}

/** 操作分组 */
const OPERATION_CATEGORIES: { title: string; items: OperationItem[] }[] = [
  {
    title: '系统内置',
    items: [
      { id: 'filter', name: '筛选', desc: '条件分支，按条件决定是否继续执行', color: 'bg-purple-100 text-purple-600', actionType: 'filter' },
      { id: 'delay', name: '延迟', desc: '等待指定时间后继续执行', color: 'bg-orange-100 text-orange-600', actionType: 'delay' },
    ],
  },
  {
    title: '多维表格',
    items: [
      ...(['create_record', 'read_records', 'update_record', 'delete_record'] as const).map((k) => ({
        id: k,
        name: CRUD_ACTION_META[k].label,
        desc: CRUD_ACTION_META[k].desc,
        color: 'bg-amber-100 text-amber-600',
        actionType: k,
      })),
    ],
  },
  {
    title: '应用连接器',
    items: [
      { id: 'http_request', name: '发送 HTTP 请求', desc: '向外部系统发送 HTTP 请求', color: 'bg-teal-100 text-teal-600', actionType: 'http_request' },
      { id: 'im_message', name: '发送飞书消息', desc: '通过飞书 IM 发送文本或卡片消息', color: 'bg-violet-100 text-violet-600', actionType: 'im_message' },
    ],
  },
];

function AddOperationPanel({
  onSelect,
  onClose,
}: {
  onSelect: (actionType: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 bg-black/20 z-50" onClick={onClose} />

      {/* 面板 */}
      <div className="fixed right-0 top-0 bottom-0 w-[520px] bg-white shadow-lg z-50 flex flex-col animate-scale-in origin-right overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <span className="text-base font-semibold text-neutral-800">操作</span>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* 内容区：按类别列出操作 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {OPERATION_CATEGORIES.map((cat) => (
            <div key={cat.title}>
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">{cat.title}</h3>
              <div className="grid grid-cols-2 gap-3">
                {cat.items.map((op) => (
                  <button
                    key={op.id}
                    onClick={() => onSelect(op.actionType!)}
                    className="p-4 rounded-md border border-neutral-100 hover:border-amber-200 hover:bg-amber-50/30 text-left transition-all group"
                  >
                    <div className={`w-9 h-9 rounded-lg ${op.color} flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform`}>
                      {(() => { const Icon = OP_ICONS[op.id] || ACTION_ICONS[op.id] || Settings; return <Icon className="w-5 h-5" />; })()}
                    </div>
                    <div className="text-sm font-semibold text-neutral-800">{op.name}</div>
                    <div className="text-xs text-neutral-400 mt-0.5">{op.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ====== 主组件 ======
export default function WorkflowManager({
  apps,
  onListTables,
  onListFields,
  onCreateRecord,
  onListRecords,
  onUpdateRecord,
  onDeleteRecord,
  targetWorkflowId,
}: WorkflowManagerProps) {
  const router = useRouter();
  const detailMode = !!targetWorkflowId;

  const [workflows, setWorkflows] = useState<Workflow[]>(() => loadWorkflows());
  const [activeWfId, setActiveWfId] = useState<string | null>(targetWorkflowId ?? null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameError, setNameError] = useState('');
  const [configNodeId, setConfigNodeId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // 操作日志
  const [showExecPanel, setShowExecPanel] = useState(false);
  const [executions, setExecutions] = useState<import('@/types').Execution[]>([]);
  const [selectedExecId, setSelectedExecId] = useState<string | null>(null);

  // 拖拽排序状态
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // 视图模式：首页（卡片列表）| 编辑器 → 详情模式强制编辑器
  const [viewMode, setViewMode] = useState<'home' | 'editor'>(detailMode ? 'editor' : 'home');

  // 卡片菜单状态 { workflowId: boolean }
  const [cardMenuOpen, setCardMenuOpen] = useState<string | null>(null);

  // 删除确认状态
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Toast 提示
  const [toast, setToast] = useState<string | null>(null);

  // 详情模式下校验目标工作流是否存在
  const targetExists = !detailMode || workflows.some((w) => w.id === targetWorkflowId);
  const [serverLoaded, setServerLoaded] = useState(false);

  // 详情模式下如果 localStorage 没有数据或找不到目标，从服务端 JSON 拉取
  useEffect(() => {
    if (!detailMode || serverLoaded) return;
    if (targetExists) { setServerLoaded(true); return; }
    // localStorage 里找不到目标工作流，尝试从服务端加载
    fetch('/api/workflows')
      .then((r) => r.json())
      .then((json) => {
        const serverWfs: Workflow[] = json.workflows ?? [];
        if (serverWfs.length > 0) {
          setWorkflows(serverWfs);
        }
        setServerLoaded(true);
      })
      .catch(() => setServerLoaded(true));
  }, [detailMode, serverLoaded, targetExists]);

  useEffect(() => {
    if (detailMode && !targetExists && serverLoaded) {
      // 服务端也找不到目标工作流，跳回首页
      router.replace('/flow');
    }
  }, [detailMode, targetExists, serverLoaded, router]);

  // Toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // 缓存每个节点的字段信息 { "nodeId": Field[] }
  const [nodeFieldsCache, setNodeFieldsCache] = useState<Record<string, Field[]>>({});

  const activeWorkflow = workflows.find((w) => w.id === activeWfId) ?? null;

  // ====== 持久化 ======
  const persist = useCallback((updated: Workflow[]) => {
    setWorkflows(updated);
    saveWorkflows(updated);
    // 同步到服务端 JSON 存储，供 webhook 接收端读取
    fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflows: updated }),
    }).catch(() => { /* 静默失败 */ });
  }, []);

  // ====== 工作流操作 ======
  const handleNewWorkflow = () => {
    const existingNames = new Set(workflows.map((w) => w.name));
    const wf = makeDefaultWorkflow(existingNames);
    const updated = [wf, ...workflows];
    persist(updated);
  };

  const handleSelectWorkflow = (id: string) => {
    setActiveWfId(id);
    setConfigNodeId(null);
  };

  const handleDeleteWorkflow = (id: string) => {
    setDeleteConfirmId(id);
  };

  const confirmDeleteWorkflow = () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    const updated = workflows.filter((w) => w.id !== id);
    persist(updated);
    if (activeWfId === id) {
      setActiveWfId(updated.length > 0 ? updated[0].id : null);
    }
    setDeleteConfirmId(null);
    setCardMenuOpen(null);
  };

  const cancelDeleteWorkflow = () => {
    setDeleteConfirmId(null);
    setCardMenuOpen(null);
  };

  const handleUpdateWorkflowName = (name: string): boolean => {
    if (!activeWorkflow) return false;
    const trimmed = name.trim();
    if (!trimmed) { setEditingName(false); setNameError(''); return true; }
    // 检查名称是否重复（排除当前工作流自身）
    const duplicate = workflows.some((w) => w.id !== activeWorkflow.id && w.name === trimmed);
    if (duplicate) {
      setNameError('名称已存在，请使用其他名称');
      return false;
    }
    setNameError('');
    const updated = workflows.map((w) =>
      w.id === activeWorkflow.id ? { ...w, name: trimmed, updatedAt: new Date().toISOString() } : w
    );
    persist(updated);
    return true;
  };

  const handleDuplicateWorkflow = (id: string) => {
    const source = workflows.find((w) => w.id === id);
    if (!source) return;
    // 生成唯一副本名称
    const baseName = `${source.name} (副本)`;
    const existingNames = new Set(workflows.map((w) => w.name));
    let copyName = baseName;
    if (existingNames.has(copyName)) {
      let i = 2;
      while (existingNames.has(`${baseName} ${i}`)) i++;
      copyName = `${baseName} ${i}`;
    }
    const copy: Workflow = {
      ...JSON.parse(JSON.stringify(source)),
      id: idGen(),
      name: copyName,
      status: 'draft' as import('@/types').WorkflowStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: source.nodes.map((n) => ({ ...n, id: n.id === 'trigger' || n.id === 'end' ? n.id : idGen() })),
    };
    const updated = [copy, ...workflows];
    persist(updated);
    setCardMenuOpen(null);
  };

  /** 进入编辑某工作流 → 跳转到独立详情路由 */
  const handleEditWorkflow = (id: string) => {
    setCardMenuOpen(null);
    router.push(`/flow/${id}`);
  };

  /** 返回首页 */
  const handleBackToHome = () => {
    if (detailMode) {
      router.push('/flow');
    } else {
      setViewMode('home');
      setActiveWfId(null);
      setConfigNodeId(null);
    }
  };

  // ====== 节点操作 ======
  /** 添加新节点到工作流 */
  const handleAddNode = (nodeKind: string, actionType?: CrdAction) => {
    if (!activeWorkflow) return;
    const meta = CRUD_ACTION_META[nodeKind];
    const newNode: WorkflowNode = {
      id: idGen(),
      type: nodeKind as NodeKind,
      title: meta?.label || nodeKind,
    };

    // 根据类型填充默认配置
    if (nodeKind === 'action' && actionType) {
      newNode.actionConfig = makeDefaultActionConfig(actionType);
      newNode.title = CRUD_ACTION_META[actionType]?.label || actionType;
    } else if (nodeKind === 'filter') {
      newNode.filterConfig = { conditions: [], matchMode: 'all' };
    } else if (nodeKind === 'delay') {
      newNode.delayConfig = { duration: 1, unit: 'minutes' };
    } else if (nodeKind === 'http_request') {
      newNode.httpRequestConfig = { url: '', method: 'GET', headers: [], body: '', bodySource: 'manual', saveResponse: false };
    } else if (nodeKind === 'im_message') {
      newNode.imConfig = { receiveIdType: 'open_id', receiveId: '', receiveIdSource: 'manual', receiveIdWebhookKey: '', msgType: 'text', textContent: '', textSource: 'manual', cardJson: '', cardSource: 'manual' };
    }

    const nodes = [...activeWorkflow.nodes];
    const endIdx = nodes.findIndex((n) => n.type === 'end');
    nodes.splice(endIdx, 0, newNode);
    const updated = workflows.map((w) =>
      w.id === activeWorkflow.id ? { ...w, nodes, updatedAt: new Date().toISOString() } : w
    );
    persist(updated);
  };

  /** 从操作菜单选中某项后 */
  const handleSelectOperation = (actionType: string) => {
    setShowAddMenu(false);
    if (['create_record', 'read_records', 'update_record', 'delete_record'].includes(actionType)) {
      handleAddNode('action', actionType as CrdAction);
    } else if (['filter', 'delay', 'http_request', 'im_message'].includes(actionType)) {
      handleAddNode(actionType);
    }
  };

  const handleDeleteNode = (nodeId: string) => {
    if (!activeWorkflow) return;
    const nodes = activeWorkflow.nodes.filter((n) => n.id !== nodeId);
    if (nodes.length < 2 || !nodes.some((n) => n.type === 'trigger') || !nodes.some((n) => n.type === 'end')) return;
    const updated = workflows.map((w) =>
      w.id === activeWorkflow.id ? { ...w, nodes, updatedAt: new Date().toISOString() } : w
    );
    persist(updated);
  };

  /** 复制节点（插入到原节点之后） */
  const handleCopyNode = (nodeId: string) => {
    if (!activeWorkflow) return;
    const srcNode = activeWorkflow.nodes.find((n) => n.id === nodeId);
    if (!srcNode || srcNode.type === 'trigger' || srcNode.type === 'end') return;
    const copied: WorkflowNode = {
      ...JSON.parse(JSON.stringify(srcNode)),
      id: idGen(),
    };
    const nodes = [...activeWorkflow.nodes];
    const srcIdx = nodes.findIndex((n) => n.id === nodeId);
    nodes.splice(srcIdx + 1, 0, copied);
    const updated = workflows.map((w) =>
      w.id === activeWorkflow.id ? { ...w, nodes, updatedAt: new Date().toISOString() } : w
    );
    persist(updated);
  };

  /** 延时节点内联更新 */
  const handleDelayInlineUpdate = (nodeId: string, patch: Partial<WorkflowNode>) => {
    if (!activeWorkflow) return;
    const nodes = activeWorkflow.nodes.map((n) =>
      n.id === nodeId ? { ...n, ...patch } : n
    );
    const updated = workflows.map((w) =>
      w.id === activeWorkflow.id ? { ...w, nodes, updatedAt: new Date().toISOString() } : w
    );
    // 使用 setWorkflows 直接更新，避免频繁写 localStorage
    setWorkflows(updated);
  };

  /** 拖拽开始 */
  const handleDragStart = (_e: React.MouseEvent, nodeId: string) => {
    setDragNodeId(nodeId);
    // 阻止文本选择
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
  };

  /** 拖拽经过 */
  const handleDragOver = (idx: number) => {
    if (dragNodeId === null) return;
    setDragOverIdx(idx);
  };

  /** 拖拽释放（交换节点位置） */
  const handleDrop = (targetIdx: number) => {
    if (!activeWorkflow || !dragNodeId) {
      setDragNodeId(null);
      setDragOverIdx(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      return;
    }

    const nodes = [...activeWorkflow.nodes];
    const sourceIdx = nodes.findIndex((n) => n.id === dragNodeId);
    if (sourceIdx === -1 || sourceIdx === targetIdx) {
      setDragNodeId(null);
      setDragOverIdx(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      return;
    }

    // 不允许拖拽 trigger 和 end 节点
    const sourceNode = nodes[sourceIdx];
    const targetNode = nodes[targetIdx];
    if (sourceNode.type === 'trigger' || sourceNode.type === 'end' ||
        targetNode.type === 'trigger' || targetNode.type === 'end') {
      setDragNodeId(null);
      setDragOverIdx(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      return;
    }

    // 执行交换
    const [moved] = nodes.splice(sourceIdx, 1);
    nodes.splice(targetIdx, 0, moved);

    const updated = workflows.map((w) =>
      w.id === activeWorkflow.id ? { ...w, nodes, updatedAt: new Date().toISOString() } : w
    );
    persist(updated);

    setDragNodeId(null);
    setDragOverIdx(null);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  const handleSaveNodeConfig = async (nodeId: string, config: ActionConfigType) => {
    if (!activeWorkflow) return;
    const actionMeta = CRUD_ACTION_META[config.action];

    if (config.targetAppToken && config.targetTableId) {
      try {
        const fields = await onListFields(config.targetAppToken, config.targetTableId);
        setNodeFieldsCache((prev) => ({ ...prev, [nodeId]: fields }));
      } catch { /* ignore */ }
    }

    const nodes = activeWorkflow.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, title: actionMeta?.label || n.title, actionConfig: config }
        : n
    );
    const updated = workflows.map((w) =>
      w.id === activeWorkflow.id ? { ...w, nodes, updatedAt: new Date().toISOString() } : w
    );
    persist(updated);
    setConfigNodeId(null);
  };

  const handleSaveGenericNodeConfig = (nodeId: string, patch: Partial<WorkflowNode>) => {
    if (!activeWorkflow) return;
    const nodes = activeWorkflow.nodes.map((n) =>
      n.id === nodeId ? { ...n, ...patch } : n
    );
    const updated = workflows.map((w) =>
      w.id === activeWorkflow.id ? { ...w, nodes, updatedAt: new Date().toISOString() } : w
    );
    persist(updated);
    setConfigNodeId(null);
  };

  const handleSaveTriggerConfig = (nodeId: string, config: import('@/types').TriggerConfig) => {
    if (!activeWorkflow) return;
    const nodes = activeWorkflow.nodes.map((n) =>
      n.id === nodeId ? { ...n, triggerConfig: config } : n
    );
    const updated = workflows.map((w) =>
      w.id === activeWorkflow.id ? { ...w, nodes, updatedAt: new Date().toISOString() } : w
    );
    persist(updated);
    setConfigNodeId(null);
  };

  // ====== 状态切换 ======
  const handleToggleStatus = () => {
    if (!activeWorkflow) return;
    const next: import('@/types').WorkflowStatus = activeWorkflow.status === 'enabled' ? 'disabled' : 'enabled';
    const updated = workflows.map((w) =>
      w.id === activeWorkflow.id ? { ...w, status: next, updatedAt: new Date().toISOString() } : w,
    );
    persist(updated);
  };

  const handleSaveDraft = () => {
    if (!activeWorkflow) return;
    // 检查未配置的节点
    const unconfigured = activeWorkflow.nodes.filter(
      (n) => n.type !== 'end' && n.type !== 'trigger' && !isNodeConfigured(n)
    );
    if (unconfigured.length > 0) {
      const names = unconfigured.map((n) => {
        if (n.type === 'action' && n.actionConfig) {
          return CRUD_ACTION_META[n.actionConfig.action]?.label || n.title;
        }
        return CRUD_ACTION_META[n.type]?.label || n.title;
      }).join('、');
      setToast(`还有 ${unconfigured.length} 个节点未配置完整：${names}`);
    }
    const updated = workflows.map((w): Workflow =>
      w.id === activeWorkflow.id ? { ...w, status: 'draft' as import('@/types').WorkflowStatus, updatedAt: new Date().toISOString() } : w,
    );
    persist(updated);
  };

  // ====== 操作日志 ======
  const loadExecutions = useCallback(async () => {
    try {
      const res = await fetch(`/api/executions?workflowId=${activeWorkflow?.id ?? ''}`);
      const json = await res.json();
      if (json.code === 0) {
        setExecutions(json.data.executions);
        // 默认选中最新一条
        if (json.data.executions.length > 0 && !selectedExecId) {
          setSelectedExecId(json.data.executions[0].id);
        }
      }
    } catch { /* ignore */ }
  }, [activeWorkflow?.id, selectedExecId]);

  /** 打开操作日志面板时加载 */
  const openExecPanel = async () => {
    setShowExecPanel(true);
    await loadExecutions();
  };

  const configNode = configNodeId ? activeWorkflow?.nodes.find((n) => n.id === configNodeId) : null;

  // ====== 本月运行次数 ======
  const [monthlyCounts, setMonthlyCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch('/api/executions')
      .then((r) => r.json())
      .then((json) => {
        if (json.code === 0) {
          const allExecs: import('@/types').Execution[] = json.data.executions ?? [];
          const now = new Date();
          const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const counts: Record<string, number> = {};
          for (const e of allExecs) {
            if (e.triggerTime.startsWith(thisMonth)) {
              counts[e.workflowId] = (counts[e.workflowId] || 0) + 1;
            }
          }
          setMonthlyCounts(counts);
        }
      })
      .catch(() => {});
  }, [workflows.length]);

  // ====== 首页：卡片视图 ======
  if (viewMode === 'home' && !detailMode) {
    return (
      <>
      <div>
        {/* 标题栏 */}
        <h2 className="text-lg font-bold text-neutral-800">机器人指令</h2>

        {/* 卡片网格 */}
        <div className="grid grid-cols-4 gap-5">
          {/* 新建卡片（始终显示） */}
          <button
            onClick={() => {
              const existingNames = new Set(workflows.map((w) => w.name));
              const wf = makeDefaultWorkflow(existingNames);
              persist([wf, ...workflows]);
            }}
            className="group rounded-lg border-2 border-dashed border-neutral-200 hover:border-amber-300 hover:bg-amber-50/30 p-8 flex flex-col items-center justify-center gap-3 transition-all min-h-[180px] w-full"
          >
            <div className="w-12 h-12 rounded-md bg-neutral-100 group-hover:bg-amber-100 flex items-center justify-center text-neutral-400 group-hover:text-amber-500 transition-colors">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
            </div>
            <span className="text-sm font-medium text-neutral-400 group-hover:text-amber-600 transition-colors">+ 新建机器人指令</span>
          </button>

          {/* 工作流卡片 */}
          {workflows.map((wf) => {
            const actionCount = wf.nodes.filter((n) => n.type === 'action').length;
            const isMenuOpen = cardMenuOpen === wf.id;
            return (
              <div
                key={wf.id}
                onClick={() => handleEditWorkflow(wf.id)}
                className={`rounded-lg border transition-all cursor-pointer w-full ${
                  isMenuOpen ? 'border-amber-300 shadow-md shadow-amber-500/10' : 'border-neutral-200 hover:border-neutral-300 hover:shadow-md'
                } bg-white overflow-hidden`}
              >
                {/* 卡片头部 */}
                <div className="p-5 pb-0">
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-base font-semibold text-neutral-800 truncate pr-2">{wf.name || '未命名自动化'}</h3>
                    <div className="relative flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); setCardMenuOpen(isMenuOpen ? null : wf.id); }}
                        onMouseEnter={() => setCardMenuOpen(wf.id)}
                        className="w-7 h-7 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"/></svg>
                      </button>
                      {/* 下拉菜单 */}
                      {isMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setCardMenuOpen(null)} />
                          <div
                            className="absolute right-0 top-full mt-1 w-32 bg-white border border-neutral-200 rounded-md shadow-lg z-50 py-1 overflow-hidden animate-scale-in origin-top-right"
                            onMouseLeave={() => setCardMenuOpen(null)}
                          >
                            <button onClick={() => handleEditWorkflow(wf.id)} className="w-full px-3.5 py-2 text-left text-sm text-neutral-600 hover:bg-neutral-50 flex items-center gap-2">
                              <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                              编辑
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleDuplicateWorkflow(wf.id); }} className="w-full px-3.5 py-2 text-left text-sm text-neutral-600 hover:bg-neutral-50 flex items-center gap-2">
                              <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                              创建副本
                            </button>
                            <div className="border-t border-neutral-100 my-1" />
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteWorkflow(wf.id); }} className="w-full px-3.5 py-2 text-left text-sm text-red-500 hover:bg-red-50 flex items-center gap-2">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 流程图标预览 */}
                  <div className="flex items-center justify-center gap-2 py-4">
                    {/* Webhook 图标 */}
                    <div className="w-10 h-10 rounded-md bg-neutral-50 border border-blue-100 flex items-center justify-center text-neutral-500">
                      <TriggerIcon />
                    </div>
                    {/* 箭头 */}
                    <svg className="w-4 h-4 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                    {/* 动作图标 */}
                    <div className="w-10 h-10 rounded-md bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500">
                      <ClipboardList className="w-5 h-5" />
                    </div>
                  </div>
                </div>

                {/* 卡片底部 */}
                <div className="px-5 pb-5 pt-2 flex items-center justify-between">
                  <span className="text-xs text-neutral-400">本月运行次数 {monthlyCounts[wf.id] ?? 0}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = wf.status === 'enabled' ? ('disabled' as const) : ('enabled' as const);
                      const updated = workflows.map((w) => (w.id === wf.id ? { ...w, status: next, updatedAt: new Date().toISOString() } : w));
                      persist(updated);
                    }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${wf.status === 'enabled' ? 'bg-amber-500' : 'bg-neutral-200'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${wf.status === 'enabled' ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ====== 删除确认弹窗 ====== */}
      <ConfirmDialog
        open={deleteConfirmId !== null}
        title="删除工作流"
        message={<>确定要删除工作流 <span className="font-semibold text-neutral-800">「{workflows.find((w) => w.id === deleteConfirmId)?.name}」</span> 吗？此操作不可恢复。</>}
        confirmLabel="删除"
        onConfirm={confirmDeleteWorkflow}
        onCancel={cancelDeleteWorkflow}
      />
      </>
    );
  }

  // ====== 编辑器视图 ======
  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* ====== 左侧：工作流列表（详情模式隐藏） ====== */}
      {!detailMode && (
      <div className="w-[260px] border-r border-neutral-100 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-neutral-50">
          <button
            onClick={handleNewWorkflow}
            className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-md transition-colors shadow-sm shadow-amber-500/20 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
            新建自动化
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {workflows.length === 0 ? (
            <div className="p-6 text-center text-sm text-neutral-400">
              暂无自动化流程
              <br />
              点击上方按钮创建
            </div>
          ) : (
            <div className="space-y-1">
              {workflows.map((wf) => (
                <div
                  key={wf.id}
                  onClick={() => handleSelectWorkflow(wf.id)}
                  className={`group flex items-center gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-all ${
                    activeWfId === wf.id
                      ? 'bg-amber-50 border border-amber-100'
                      : 'hover:bg-neutral-50 border border-transparent'
                  }`}
                >
                  <span className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0"><Zap className="w-3.5 h-3.5 text-neutral-400" /></span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${activeWfId === wf.id ? 'text-amber-700' : 'text-neutral-700'}`}>
                      {wf.name || '未命名自动化'}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="text-[10px] text-neutral-400">
                        {wf.nodes.filter((n) => n.type === 'action').length} 个步骤
                      </div>
                      {wf.status === 'enabled' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 text-emerald-600">已启用</span>
                      )}
                      {wf.status === 'draft' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-neutral-100 text-neutral-400">草稿</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteWorkflow(wf.id); }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md hover:bg-red-50 flex items-center justify-center text-neutral-300 hover:text-red-400 transition-all flex-shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-neutral-100 text-[10px] text-neutral-400 text-center">
          支持新增 · 查询 · 更新 · 删除
        </div>
      </div>
      )}

      {/* ====== 右侧：编辑器 ====== */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeWorkflow ? (
          <div className="flex-1 flex items-center justify-center text-neutral-400">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-3 text-neutral-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.246l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.246"/>
              </svg>
              <p className="text-sm">选择一个自动化流程或新建</p>
            </div>
          </div>
        ) : (
          <>
            {/* 工具栏 */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                {/* 返回首页 */}
                <button
                  onClick={handleBackToHome}
                  className="w-8 h-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400 transition-colors"
                  title="返回首页"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
                </button>
                {!editingName ? (
                  <button
                    onClick={() => { setNameInput(activeWorkflow.name); setNameError(''); setEditingName(true); }}
                    className="text-sm font-semibold text-neutral-800 hover:text-amber-600 transition-colors min-w-[120px] text-left"
                  >
                    {activeWorkflow.name || '未命名自动化'}
                  </button>
                ) : (
                  <div>
                    <form
                      onSubmit={(e) => { e.preventDefault(); if (handleUpdateWorkflowName(nameInput)) setEditingName(false); }}
                      className="flex items-center gap-1.5"
                    >
                      <input
                        autoFocus
                        value={nameInput}
                        onChange={(e) => { setNameInput(e.target.value); setNameError(''); }}
                        onBlur={() => { if (handleUpdateWorkflowName(nameInput)) setEditingName(false); }}
                        placeholder="输入名称"
                        className={`px-2.5 py-1 text-sm font-semibold text-neutral-800 border rounded-lg outline-none focus:ring-2 w-[200px] ${nameError ? 'border-red-300 focus:ring-red-200' : 'border-amber-300 focus:ring-amber-200'}`}
                      />
                    </form>
                    {nameError && (
                      <p className="text-[11px] text-red-500 mt-0.5 ml-0.5">{nameError}</p>
                    )}
                  </div>
                )}
                <span className="text-xs text-neutral-400">{activeWorkflow.nodes.filter((n) => n.type === 'action').length} 个步骤</span>
              </div>

              <div className="flex items-center gap-2">
                {/* 操作日志 */}
                <button
                  onClick={openExecPanel}
                  className="px-3 py-1.5 text-xs font-medium text-neutral-500 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 hover:border-neutral-300 transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
                  </svg>
                  操作日志
                </button>

                {/* 保存为草稿 */}
                <button
                  onClick={handleSaveDraft}
                  disabled={activeWorkflow.status === 'draft'}
                  className="px-3 py-1.5 text-xs font-medium text-neutral-500 bg-white border border-neutral-200 rounded-lg hover:bg-neutral-50 hover:border-neutral-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  保存为草稿
                </button>

                {/* 保存 */}
                <button
                  onClick={handleSaveDraft}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 bg-amber-500 text-white hover:bg-amber-600 shadow-sm shadow-amber-500/20"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                  保存
                </button>
              </div>
            </div>

            {/* 操作日志面板（模态） */}
            {showExecPanel && (
              <OperationLogPanel
                executions={executions}
                selectedId={selectedExecId}
                onSelectId={setSelectedExecId}
                onClose={() => { setShowExecPanel(false); setSelectedExecId(null); }}
                onRefresh={loadExecutions}
              />
            )}

            {/* 流程画布 */} 
            <div
              className="flex-1 overflow-y-auto"
              onMouseUp={() => {
                if (dragNodeId) {
                  setDragNodeId(null);
                  setDragOverIdx(null);
                  document.body.style.userSelect = '';
                  document.body.style.cursor = '';
                }
              }}
              onMouseLeave={() => {
                if (dragNodeId) {
                  setDragNodeId(null);
                  setDragOverIdx(null);
                  document.body.style.userSelect = '';
                  document.body.style.cursor = '';
                }
              }}
            >
              <div className="flex flex-col items-center gap-0 py-4">
                {activeWorkflow.nodes.map((node, i) => (
                  <div
                    key={node.id}
                    className={`flex flex-col items-center ${dragOverIdx === i ? 'animate-pulse' : ''}`}
                    onMouseUp={(e) => { e.preventDefault(); handleDrop(i); }}
                    onMouseEnter={() => handleDragOver(i)}
                  >
                    {/* 节点卡片 + 序号 */}
                    <div className="flex items-center gap-2">
                      {/* 序号标记 */}
                      {(() => {
                        const seq = getNodeSeq(activeWorkflow.nodes, node.id);
                        if (seq > 0) {
                          return (
                            <div className="w-6 h-6 rounded-full bg-white border border-neutral-200 flex items-center justify-center text-[11px] font-bold text-neutral-500 flex-shrink-0 shadow-sm">
                              {seq}
                            </div>
                          );
                        }
                        return <div className="w-6 flex-shrink-0" />;
                      })()}
                      <div
                        className={`relative group transition-transform duration-150 ${dragNodeId === node.id ? 'opacity-50 scale-95' : ''}`}
                      >
                        <FlowNodeCard
                          node={node}
                          apps={apps}
                          onConfig={setConfigNodeId}
                          onDelete={handleDeleteNode}
                          onCopy={handleCopyNode}
                          onUpdateInline={node.type === 'delay' ? handleDelayInlineUpdate : undefined}
                          draggable={isNodeDeletable(node)}
                          onDragStart={handleDragStart}
                        />
                      </div>
                    </div>
                    {/* 连接器 */}
                    {i < activeWorkflow.nodes.length - 1 && (
                      <Connector onOpenAddMenu={() => setShowAddMenu(true)} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 底部说明 */}
            <div className="px-6 py-2 border-t border-neutral-100 text-center flex-shrink-0">
              <p className="text-[11px] text-neutral-400">
                拖拽手柄重排节点 · 点击节点卡片配置参数 · 流程按从上到下顺序执行
              </p>
            </div>
          </>
        )}
      </div>

      {/* ====== 操作选择菜单 ====== */}
      {showAddMenu && (
        <AddOperationPanel
          onSelect={handleSelectOperation}
          onClose={() => setShowAddMenu(false)}
        />
      )}

      {/* ====== 动作配置面板 ====== */}
      {configNode && configNode.type === 'action' && configNode.actionConfig && (
        <ActionConfigPanel
          node={configNode}
          apps={apps}
          allNodes={activeWorkflow?.nodes ?? []}
          nodeFieldsCache={nodeFieldsCache}
          onListTables={onListTables}
          onListFields={onListFields}
          onSave={(cfg) => handleSaveNodeConfig(configNode.id, cfg)}
          onClose={() => setConfigNodeId(null)}
        />
      )}

      {/* ====== 触发配置面板 ====== */}
      {configNode && configNode.type === 'trigger' && configNode.triggerConfig && (
        <TriggerConfigPanel
          node={configNode}
          onSave={(cfg) => handleSaveTriggerConfig(configNode.id, cfg)}
          onClose={() => setConfigNodeId(null)}
        />
      )}

      {/* ====== 筛选配置面板 ====== */}
      {configNode && configNode.type === 'filter' && configNode.filterConfig && (
        <FilterConfigPanel
          node={configNode}
          webhookContentKeys={collectWebhookParams(activeWorkflow?.nodes ?? [])}
          onSave={(cfg) => handleSaveGenericNodeConfig(configNode.id, { filterConfig: cfg })}
          onClose={() => setConfigNodeId(null)}
        />
      )}

      {/* ====== 延时配置面板 ====== */}
      {configNode && configNode.type === 'delay' && configNode.delayConfig && (
        <DelayConfigPanel
          node={configNode}
          onSave={(cfg) => handleSaveGenericNodeConfig(configNode.id, { delayConfig: cfg })}
          onClose={() => setConfigNodeId(null)}
        />
      )}

      {/* ====== HTTP 配置面板 ====== */}
      {configNode && configNode.type === 'http_request' && configNode.httpRequestConfig && (
        <HttpRequestConfigPanel
          node={configNode}
          onSave={(cfg) => handleSaveGenericNodeConfig(configNode.id, { httpRequestConfig: cfg })}
          onClose={() => setConfigNodeId(null)}
        />
      )}

      {/* ====== IM 消息配置面板 ====== */}
      {configNode && configNode.type === 'im_message' && configNode.imConfig && (
        <ImMessageConfigPanel
          node={configNode}
          onSave={(cfg) => handleSaveGenericNodeConfig(configNode.id, { imConfig: cfg })}
          onClose={() => setConfigNodeId(null)}
        />
      )}

      {/* ====== 删除确认弹窗 ====== */}
      <ConfirmDialog
        open={deleteConfirmId !== null}
        title="删除工作流"
        message={<>确定要删除工作流 <span className="font-semibold text-neutral-800">「{workflows.find((w) => w.id === deleteConfirmId)?.name}」</span> 吗？此操作不可恢复。</>}
        confirmLabel="删除"
        onConfirm={confirmDeleteWorkflow}
        onCancel={cancelDeleteWorkflow}
      />

      {/* ====== Toast 提示 ====== */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] animate-toast-in">
          <div className="flex items-center gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg shadow-lg max-w-md">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-800">{toast}</p>
            <button
              onClick={() => setToast(null)}
              className="ml-1 text-amber-400 hover:text-amber-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ====== 操作日志面板（模态） ======

function OperationLogPanel({
  executions,
  selectedId,
  onSelectId,
  onClose,
  onRefresh,
}: {
  executions: import('@/types').Execution[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const selected = executions.find((e) => e.id === selectedId) ?? null;

  /** 格式化时间 */
  const fmtTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  /** 格式化耗时 */
  const fmtDuration = (ms: number) => ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 bg-black/20 z-50" onClick={onClose} />

      {/* 面板 — 右侧滑出，与 webhook 配置面板风格一致 */}
      <div className="fixed right-0 top-0 bottom-0 w-[600px] bg-white shadow-lg z-50 flex flex-col animate-scale-in origin-right overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
            <span className="text-base font-semibold text-neutral-800">操作日志</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onRefresh} className="text-xs text-amber-500 hover:text-amber-600 font-medium px-2 py-1">
              刷新
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* 内容区：左侧日志列表 + 右侧详情 */}
        <div className="flex-1 flex min-h-0">
          {/* 左侧列表 */}
          <div className="w-[240px] border-r border-neutral-100 flex flex-col shrink-0">
            <div className="flex-1 overflow-y-auto">
              {executions.length === 0 ? (
                <div className="p-6 text-center text-sm text-neutral-400">暂无执行记录</div>
              ) : (
                executions.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => onSelectId(e.id)}
                    className={`w-full text-left px-4 py-3 border-b border-neutral-50 transition-colors ${
                      selectedId === e.id ? 'bg-amber-50/60' : 'hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${e.status === 'success' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      <span className={`text-xs font-medium ${e.status === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {e.status === 'success' ? '已完成' : '失败'}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-neutral-700 truncate">{e.workflowName}</div>
                    <div className="text-[11px] text-neutral-400 mt-0.5">{fmtTime(e.triggerTime)}</div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 右侧详情 */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
                选择一条日志查看详情
              </div>
            ) : (
              <>
                {/* 头部信息 */}
                <div className="px-6 py-4 border-b border-neutral-100 shrink-0 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${selected.status === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${selected.status === 'success' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      {selected.status === 'success' ? '已完成' : '失败'}
                    </span>
                    <span className="text-sm font-semibold text-neutral-800 truncate">{selected.workflowName}</span>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-neutral-400">
                    <span>{fmtTime(selected.triggerTime)} (UTC+8)</span>
                    <span>运行时间 {fmtDuration(selected.durationMs)}</span>
                    <span>执行 ID: {selected.id.slice(0, 16)}</span>
                  </div>
                </div>

                {/* 步骤详情 */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                  {selected.steps.map((step, i) => (
                    <div key={i} className="border border-neutral-100 rounded-md overflow-hidden">
                      {/* 步骤标题栏 */}
                      <button
                        className="w-full flex items-center gap-2.5 px-4 py-3 bg-white hover:bg-neutral-50 transition-colors"
                        onClick={(e) => {
                          const el = (e.currentTarget.nextElementSibling as HTMLElement);
                          el.classList.toggle('hidden');
                          const icon = e.currentTarget.querySelector('.expand-icon') as HTMLElement;
                          if (icon) icon.style.transform = el.classList.contains('hidden') ? '' : 'rotate(180deg)';
                        }}
                      >
                        <span className={step.success ? 'text-emerald-500' : 'text-red-500'}>
                          {step.success ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                        </span>
                        <span className="text-sm font-medium text-neutral-700">{step.title}</span>
                        <span className="ml-auto text-xs text-neutral-400">{fmtDuration(step.durationMs || 0)}</span>
                        <svg className="expand-icon w-3.5 h-3.5 text-neutral-300 transition-transform rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
                      </button>

                      {/* 展开内容 */}
                      <div className="px-4 py-3 bg-neutral-50/80 border-t border-neutral-100 text-xs text-neutral-600 space-y-1.5 hidden">
                        <div><span className="text-neutral-400">结果：</span>{step.success ? step.message : <span className="text-red-500">{step.message}</span>}</div>
                        {i === 0 && (
                          <>
                            <div><span className="text-neutral-400">content：</span>{JSON.stringify(selected.requestSummary.content)}</div>
                            <div><span className="text-neutral-400">time：</span>{new Date(selected.triggerTime).toLocaleString('zh-CN')}</div>
                            {selected.requestSummary.token && (
                              <div><span className="text-neutral-400">__token__：</span>{selected.requestSummary.token}</div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* 请求体摘要 */}
                  <div className="bg-neutral-50 border border-neutral-100 rounded-md p-4">
                    <div className="text-[10px] text-neutral-400 uppercase tracking-wider font-semibold mb-2">请求原始数据</div>
                    <pre className="text-xs text-neutral-600 font-mono whitespace-pre-wrap leading-relaxed">
{JSON.stringify({ __body__: JSON.stringify({ content: selected.requestSummary.content }), __token__: selected.requestSummary.token }, null, 2)}
                    </pre>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

