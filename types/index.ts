// ====== 飞书 Bitable 类型定义 ======

/** 飞书记录 */
export interface BitableRecord {
  record_id: string;
  fields: Record<string, unknown>;
  created_time: string;
  updated_time: string;
}

/** 字段类型 */
export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'single_select'
  | 'multi_select'
  | 'checkbox'
  | 'person'
  | 'phone'
  | 'email'
  | 'url'
  | 'file'
  | 'formula'
  | 'lookup'
  | 'created_time'
  | 'created_by'
  | 'updated_time'
  | 'updated_by';

/** 可用字段类型选项 */
export const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'single_select', label: '单选' },
  { value: 'multi_select', label: '多选' },
  { value: 'checkbox', label: '复选框' },
  { value: 'person', label: '人员' },
  { value: 'phone', label: '电话' },
  { value: 'email', label: '邮箱' },
  { value: 'url', label: '链接' },
];

/** 字段定义 */
export interface Field {
  field_id: string;
  name: string;
  type: FieldType;
}

/** 数据表 */
export interface Table {
  table_id: string;
  name: string;
  fields?: Field[];
  created_time: string;
  updated_time: string;
}

/** 云文件类型 */
export type DriveFileType = 'bitable' | 'docx' | 'sheet';

/** 用户名片信息 */
export interface UserProfile {
  open_id: string;
  name: string;
  avatar_url?: string;
  email?: string;
  mobile?: string;
  en_name?: string;
  nickname?: string;
  description?: string;
}

/** 多维表格应用（也用作通用云文件展示） */
export interface App {
  app_token: string;
  name: string;
  url: string;
  folder_token: string;
  create_time: string;
  update_time: string;
  creator_id: string;
  creator_name?: string;
  creator_profile?: UserProfile;
  owner_id: string;
}

// ====== API 请求/响应类型 ======

/** API action 类型 */
export type BitableAction =
  | 'list'
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'listTables'
  | 'createTable'
  | 'deleteTable'
  | 'listFields'
  | 'listApps'
  | 'createApp'
  | 'listDocs'
  | 'createDoc'
  | 'listSheets'
  | 'createSheet'
  | 'deleteFile'
  | 'getOAuthUrl'
  | 'exchangeAuthCode';

/** 通用 API 请求体 */
export interface BitableRequest {
  action: BitableAction;
  appToken?: string;
  tableId?: string;
  recordId?: string;
  fields?: Record<string, unknown> | { name: string; type: FieldType }[];
  tableName?: string;
  appName?: string;
  pageSize?: number;
  pageToken?: string;
  folderToken?: string;
  useUserToken?: boolean;
  userToken?: string | null;
  tokenExpire?: string | null;
}

/** 通用 API 响应 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
}

// ====== 飞书 API 原始响应类型 ======

/** 记录列表响应 */
export interface ListRecordsData {
  records: BitableRecord[];
  has_more: boolean;
  page_token: string;
  total: number;
}

/** 数据表列表响应 */
export interface ListTablesData {
  items: Table[];
  has_more: boolean;
  page_token: string;
}

/** 应用列表响应 */
export interface ListAppsData {
  files: App[];
  has_more: boolean;
  page_token: string;
}

/** OAuth URL 响应 */
export interface OAuthUrlData {
  url: string;
}

export interface UserAccessTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  user_access_token: string;
  expire: number;
  token_type: string;
}

export interface OAuthState {
  state: string;
  redirectUri: string;
}

/** Toast 通知消息 */
export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  text: string;
}

// ====== 工作流自动化 ======

/** CRUD 动作类型 */
export type CrdAction = 'create_record' | 'read_records' | 'update_record' | 'delete_record';

/** 工作流节点类型 */
export type NodeKind = 'trigger' | 'action' | 'filter' | 'delay' | 'http_request' | 'im_message' | 'end';

/** 触发器类型 */
export type TriggerKind = 'webhook' | 'scheduled' | 'bitable_event';

/** 字段值来源 */
export type ValueSource = 'manual' | 'webhook' | 'variable';

/** CRUD 操作的比较运算符 */
export type FilterOp = 'eq' | 'ne' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte';

/** 字段映射：一条 action 节点中一个字段的值配置 */
export interface FieldMapping {
  /** 目标字段 id */
  fieldId: string;
  /** 字段名（展示用） */
  fieldName: string;
  /** 字段类型 */
  fieldType: string;
  /** 值来源 */
  source: ValueSource;
  /** 手动填写的值 */
  manualValue: string;
  /** webhook 中对应的 key */
  webhookKey: string;
  /** 上一节点变量 key（source=variable 时） */
  variableKey: string;
  /** 上一节点变量展示标签（source=variable 时） */
  variableLabel: string;
}

/** 筛选条件（用于 read/update/delete 定位记录） */
export interface FilterCondition {
  fieldId: string;
  fieldName: string;
  operator: FilterOp;
  value: string;
  /** 值来源 */
  valueSource?: 'manual' | 'variable';
  /** 变量引用键（valueSource='variable' 时使用） */
  variableKey?: string;
}

/** 动作节点的配置 */
export interface ActionConfig {
  action: CrdAction;
  /** 目标多维表格 app_token（每个节点独立选择） */
  targetAppToken: string;
  /** 目标数据表 table_id（每个节点独立选择） */
  targetTableId: string;
  /** 目标数据表名称（展示用） */
  targetTableName?: string;
  /** 字段映射（create/update 时使用） */
  fieldMappings: FieldMapping[];
  /** 筛选条件（read/update/delete 时使用） */
  filters: FilterCondition[];
  /** 筛选条件之间的逻辑关系 */
  filterLogic?: 'and' | 'or';
}

/** 触发节点的配置 */
export interface TriggerConfig {
  /** 触发器类型 */
  triggerKind: TriggerKind;
  /** 生成的 webhook URL（自动生成，只读） */
  webhookUrl: string;
  /** 安全校验 token（可选，用于验证请求来源） */
  secretToken: string;
  /** 定时触发：cron 表达式（如 "0 9 * * *"） */
  cronExpression?: string;
  /** 多维表格事件：监听的应用 token */
  eventAppToken?: string;
  /** 多维表格事件：监听的数据表 id */
  eventTableId?: string;
  /** 多维表格事件：监听的事件类型 */
  eventType?: 'record_created' | 'record_updated' | 'record_deleted';
  /** Webhook 请求体重解析模板 — 用户在面板中编辑的 JSON，用于重新解析外部传入的原始 JSON，解析后的结果传递给下游节点 */
  webhookBodyTemplate?: string;
}

/** 筛选节点配置 */
export interface FilterConfig {
  /** 筛选条件列表 */
  conditions: FilterCondition[];
  /** 匹配模式 */
  matchMode: 'any' | 'all';
}

/** 延时节点配置 */
export interface DelayConfig {
  /** 延时数值 */
  duration: number;
  /** 延时单位 */
  unit: 'seconds' | 'minutes' | 'hours' | 'days';
}

/** HTTP 请求节点配置 */
export interface HttpRequestConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers: { key: string; value: string }[];
  /** 请求体（JSON 字符串） */
  body: string;
  /** 请求体来源 */
  bodySource: 'manual' | 'webhook';
  /** 是否将响应存入上下文供后续节点使用 */
  saveResponse: boolean;
}

/** IM 消息节点配置 */
export interface ImMessageConfig {
  /** 接收人 ID 类型 */
  receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id';
  /** 接收人 ID */
  receiveId: string;
  /** 接收人 ID 来源 */
  receiveIdSource: 'manual' | 'webhook';
  /** webhook 中对应的 key */
  receiveIdWebhookKey: string;
  /** 消息类型 */
  msgType: 'text' | 'card';
  /** 文本内容（msgType=text 时使用） */
  textContent: string;
  /** 文本内容来源 */
  textSource: 'manual' | 'webhook';
  /** 卡片 JSON（msgType=card 时使用） */
  cardJson: string;
  /** 卡片内容来源 */
  cardSource: 'manual' | 'webhook';
}

/** 工作流节点 */
export interface WorkflowNode {
  id: string;
  type: NodeKind;
  title: string;
  /** 仅 action 节点使用 */
  actionConfig?: ActionConfig;
  /** 仅 trigger 节点使用 */
  triggerConfig?: TriggerConfig;
  /** 仅 filter 节点使用 */
  filterConfig?: FilterConfig;
  /** 仅 delay 节点使用 */
  delayConfig?: DelayConfig;
  /** 仅 http_request 节点使用 */
  httpRequestConfig?: HttpRequestConfig;
  /** 仅 im_message 节点使用 */
  imConfig?: ImMessageConfig;
}

/** 工作流状态 */
export type WorkflowStatus = 'draft' | 'enabled' | 'disabled';

/** 工作流 */
export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
}

/** 所有节点操作类型的展示信息 */
export const CRUD_ACTION_META: Record<string, { label: string; color: string; desc: string }> = {
  create_record: { label: '新增记录', color: 'emerald', desc: '在数据表中创建一条新记录' },
  read_records:  { label: '查询记录', color: 'blue',   desc: '按条件查询记录列表' },
  update_record: { label: '更新记录', color: 'amber',  desc: '按条件更新已有记录' },
  delete_record: { label: '删除记录', color: 'red',    desc: '按条件删除匹配的记录' },
  filter:        { label: '筛选',     color: 'slate',  desc: '按条件过滤，决定是否继续执行' },
  delay:         { label: '延迟',     color: 'orange', desc: '等待指定时间后继续执行' },
  http_request:  { label: 'HTTP 请求', color: 'teal',  desc: '向外部系统发送 HTTP 请求' },
  im_message:    { label: '发送消息', color: 'violet', desc: '通过飞书 IM 发送文本或卡片消息' },
};

/** 触发器类型的展示信息 */
export const TRIGGER_KIND_META: Record<TriggerKind, { label: string; desc: string }> = {
  webhook:        { label: 'Webhook',       desc: '通过 HTTP POST 请求触发流程' },
  scheduled:      { label: '定时触发',       desc: '按 Cron 表达式定时自动执行' },
  bitable_event:  { label: '多维表格事件',   desc: '当数据表记录发生变更时触发' },
};

// ====== 执行日志 ======

/** 单个步骤的执行结果 */
export interface ExecutionStep {
  /** 步骤标题（如 "新增记录"） */
  title: string;
  /** 动作类型 */
  action: string;
  /** 是否成功 */
  success: boolean;
  /** 结果消息 */
  message: string;
  /** 耗时 ms */
  durationMs?: number;
  /** 步骤出参（供后续步骤使用），如 HTTP 请求响应 */
  output?: Record<string, unknown>;
}

/** 一条执行日志 */
export interface Execution {
  /** 唯一 ID */
  id: string;
  /** 工作流 ID */
  workflowId: string;
  /** 工作流名称 */
  workflowName: string;
  /** 执行状态：success / failure */
  status: 'success' | 'failure';
  /** 触发时间 ISO */
  triggerTime: string;
  /** 总耗时 ms */
  durationMs: number;
  /** 触发来源（webhook）的请求内容摘要 */
  requestSummary: {
    content: Record<string, unknown>;
    token?: string;
  };
  /** 各步骤结果 */
  steps: ExecutionStep[];
}
