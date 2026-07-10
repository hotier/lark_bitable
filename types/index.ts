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

/** 飞书单选/多选选项（用于把选项 id 解析为显示文字） */
export interface FeishuSelectOption {
  id: string;
  text: string;
}

/** 字段定义 */
export interface Field {
  field_id: string;
  name: string;
  type: FieldType;
  /** 单选/多选字段的选项列表（用于把选项 id 还原为显示文字） */
  options?: FeishuSelectOption[];
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
export type NodeKind =
  // 触发器
  | 'trigger'
  // 流程控制
  | 'filter' | 'delay' | 'switch' | 'loop' | 'merge' | 'try_catch'
  // 数据转换
  | 'assign' | 'aggregate' | 'code' | 'template'
  // 业务动作
  | 'action' | 'http_request' | 'im_message'
  // 通知
  | 'email' | 'bot_notify'
  // 飞书生态
  | 'create_doc' | 'create_task' | 'calendar_event' | 'upload_file' | 'approval'
  // 终点
  | 'end';

/** 节点分类 */
export type NodeCategory = 'trigger' | 'flow_control' | 'data_transform' | 'action' | 'notification' | 'lark_ecosystem' | 'core';

/** 节点分类元数据 */
export interface NodeCategoryMeta {
  id: NodeCategory;
  label: string;
  icon: string; // lucide-react icon name
  order: number;
}

export const NODE_CATEGORIES: NodeCategoryMeta[] = [
  { id: 'trigger',           label: '触发器',     icon: 'Zap',         order: 1 },
  { id: 'flow_control',     label: '流程控制',   icon: 'GitBranch',   order: 2 },
  { id: 'data_transform',   label: '数据转换',   icon: 'Shuffle',     order: 3 },
  { id: 'action',           label: '业务动作',   icon: 'Play',        order: 4 },
  { id: 'notification',     label: '通知消息',   icon: 'Bell',        order: 5 },
  { id: 'lark_ecosystem',   label: '飞书生态',   icon: 'Building2',   order: 6 },
  { id: 'core',             label: '核心',       icon: 'Circle',      order: 0 },
];

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

// ====== 流程控制节点配置 ======

/** Switch/Router 多分支节点配置 */
export interface SwitchConfig {
  /** 分支规则列表 */
  branches: SwitchBranch[];
  /** 是否有默认分支（不匹配时走 default） */
  hasDefault: boolean;
}

export interface SwitchBranch {
  id: string;
  label: string;
  fieldName: string;
  operator: FilterOp;
  value: string;
  valueSource: 'manual' | 'webhook';
}

/** 循环节点配置 */
export interface LoopConfig {
  /** 循环模式 */
  mode: 'fixed_count' | 'iterate_array' | 'while_condition';
  /** 固定循环次数 */
  count?: number;
  /** 迭代的数据来源（webhook key 或变量 key） */
  iterateSource?: string;
  /** 循环条件 */
  whileCondition?: LoopCondition;
  /** 最大迭代次数保护 */
  maxIterations: number;
  /** 并发执行数（1 = 串行） */
  concurrency: number;
}

export interface LoopCondition {
  fieldName: string;
  operator: FilterOp;
  value: string;
}

/** 合并节点配置 */
export interface MergeConfig {
  /** 合并模式 */
  mode: 'append' | 'combine' | 'join';
  /** join 模式的关联 key */
  joinKey?: string;
  /** 输入源数量 */
  inputCount: number;
}

/** Try-Catch 节点配置 */
export interface TryCatchConfig {
  /** 错误时继续执行 */
  continueOnError: boolean;
  /** 错误分支标签 */
  errorBranchLabel: string;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试间隔(ms) */
  retryDelayMs: number;
}

// ====== 数据转换节点配置 ======

/** 赋值/变量设置节点配置 */
export interface AssignConfig {
  /** 变量赋值列表 */
  variables: AssignVariable[];
}

export interface AssignVariable {
  name: string;
  value: string;
  source: 'manual' | 'webhook' | 'expression';
  webhookKey?: string;
  expression?: string;
}

/** 聚合节点配置 */
export interface AggregateConfig {
  /** 聚合操作 */
  operation: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'group_by';
  /** 目标字段 */
  fieldName: string;
  /** group_by 时的分组字段 */
  groupByField?: string;
  /** 数据来源 */
  dataSource: 'webhook' | 'previous_node';
  /** 结果变量名 */
  resultVariable: string;
}

/** 代码节点配置 */
export interface CodeConfig {
  /** 语言 */
  language: 'javascript' | 'python';
  /** 代码内容 */
  code: string;
  /** 超时(ms) */
  timeout: number;
}

/** 模板节点配置 */
export interface TemplateConfig {
  /** 模板文本（支持 {{variable}} 占位符） */
  template: string;
  /** 模板引擎类型 */
  engine: 'handlebars' | 'mustache' | 'plain';
  /** 结果变量名 */
  resultVariable: string;
}

// ====== 通知节点配置 ======

/** 邮件节点配置 */
export interface EmailConfig {
  /** 收件人 */
  to: string;
  /** 收件人来源 */
  toSource: 'manual' | 'webhook';
  /** webhook key */
  toWebhookKey: string;
  /** 主题 */
  subject: string;
  /** 主题来源 */
  subjectSource: 'manual' | 'webhook';
  /** 正文 */
  body: string;
  /** 正文来源 */
  bodySource: 'manual' | 'webhook';
  /** 正文格式 */
  bodyFormat: 'text' | 'html';
  /** 是否包含执行摘要(自动注入) */
  includeSummary: boolean;
}

/** Bot 通知节点配置 */
export interface BotNotifyConfig {
  /** 通知渠道 */
  channel: 'feishu' | 'slack' | 'dingtalk' | 'wechat_work';
  /** Webhook URL */
  webhookUrl: string;
  /** 消息标题 */
  title: string;
  /** 消息内容（支持 markdown） */
  content: string;
  /** 内容来源 */
  contentSource: 'manual' | 'webhook' | 'template';
  /** 通知级别 */
  level: 'info' | 'warning' | 'error' | 'success';
}

// ====== 飞书生态节点配置 ======

/** 创建文档节点配置 */
export interface CreateDocConfig {
  /** 文档标题 */
  title: string;
  /** 标题来源 */
  titleSource: 'manual' | 'webhook';
  /** 文档内容 */
  content: string;
  /** 内容来源 */
  contentSource: 'manual' | 'webhook';
  /** 文档类型 */
  docType: 'docx' | 'sheet' | 'slide' | 'bitable';
  /** 目标文件夹 token */
  folderToken: string;
  /** 是否共享链接 */
  shareLink: boolean;
}

/** 创建任务节点配置 */
export interface CreateTaskConfig {
  /** 任务标题 */
  title: string;
  /** 标题来源 */
  titleSource: 'manual' | 'webhook';
  /** 任务描述 */
  description: string;
  /** 负责人 open_id */
  assignee: string;
  /** 负责人来源 */
  assigneeSource: 'manual' | 'webhook';
  /** 截止时间(ISO 8601) */
  dueDate: string;
  /** 优先级 */
  priority: 'low' | 'medium' | 'high';
}

/** 日历事件节点配置 */
export interface CalendarEventConfig {
  /** 事件标题 */
  title: string;
  /** 事件描述 */
  description: string;
  /** 开始时间(ISO 8601) */
  startTime: string;
  /** 结束时间(ISO 8601) */
  endTime: string;
  /** 时间来源 */
  timeSource: 'manual' | 'webhook';
  /** 参会人 open_id 列表 (JSON 数组) */
  attendees: string;
  /** 会议室 ID */
  roomId: string;
  /** 是否需要提醒 */
  needReminder: boolean;
  /** 提醒提前分钟数 */
  reminderMinutes: number;
}

/** 上传文件节点配置 */
export interface UploadFileConfig {
  /** 文件 URL */
  fileUrl: string;
  /** 文件来源 */
  fileSource: 'manual' | 'webhook';
  /** 目标文件夹 token */
  folderToken: string;
  /** 重命名 */
  fileName: string;
  /** 文件类型 */
  fileType: 'auto' | 'docx' | 'sheet' | 'bitable' | 'image' | 'pdf';
}

/** 飞书审批节点配置 */
export interface ApprovalConfig {
  /** 审批定义 code */
  approvalCode: string;
  /** 审批标题 */
  title: string;
  /** 申请人 open_id */
  applicant: string;
  /** 审批表单字段 (JSON) */
  formData: string;
  /** 表单数据来源 */
  formDataSource: 'manual' | 'webhook';
  /** 是否等待审批完成 */
  waitForResult: boolean;
  /** 等待超时(ms) */
  waitTimeout: number;
  /** 审批人 open_id 列表 */
  approvers: string;
  /** 抄送人 open_id 列表 */
  ccList: string;
}

/** 工作流节点 */
export interface WorkflowNode {
  id: string;
  type: NodeKind;
  title: string;
  /** 触发器配置 */
  triggerConfig?: TriggerConfig;
  /** CRUD 动作配置 */
  actionConfig?: ActionConfig;
  /** 筛选配置 */
  filterConfig?: FilterConfig;
  /** 延时配置 */
  delayConfig?: DelayConfig;
  /** HTTP 请求配置 */
  httpRequestConfig?: HttpRequestConfig;
  /** IM 消息配置 */
  imConfig?: ImMessageConfig;
  /** Switch 多分支配置 */
  switchConfig?: SwitchConfig;
  /** 循环配置 */
  loopConfig?: LoopConfig;
  /** 合并配置 */
  mergeConfig?: MergeConfig;
  /** Try-Catch 配置 */
  tryCatchConfig?: TryCatchConfig;
  /** 赋值配置 */
  assignConfig?: AssignConfig;
  /** 聚合配置 */
  aggregateConfig?: AggregateConfig;
  /** 代码配置 */
  codeConfig?: CodeConfig;
  /** 模板配置 */
  templateConfig?: TemplateConfig;
  /** 邮件配置 */
  emailConfig?: EmailConfig;
  /** Bot 通知配置 */
  botNotifyConfig?: BotNotifyConfig;
  /** 创建文档配置 */
  createDocConfig?: CreateDocConfig;
  /** 创建任务配置 */
  createTaskConfig?: CreateTaskConfig;
  /** 日历事件配置 */
  calendarEventConfig?: CalendarEventConfig;
  /** 上传文件配置 */
  uploadFileConfig?: UploadFileConfig;
  /** 审批配置 */
  approvalConfig?: ApprovalConfig;
}

/** 工作流状态 */
export type WorkflowStatus = 'draft' | 'enabled' | 'disabled';

/** 工作流边（持久化用） */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

/** 工作流 */
export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  /** 边列表 — 定义节点的执行拓扑。缺失时按 nodes 数组顺序线性执行（向后兼容） */
  edges?: WorkflowEdge[];
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  /** 节点数量快照（列表端点由 jsonb_array_length 计算，减少传输体积） */
  nodeCount?: number;
}

/** 工作流摘要（列表卡片用，不含 nodes 内容） */
export interface WorkflowSummary {
  id: string;
  name: string;
  status: WorkflowStatus;
  createdAt: string;
  updatedAt: string;
  /** 节点数量（服务端 jsonb_array_length 计算） */
  nodeCount: number;
}

/** 所有节点操作类型的展示信息 */
export const NODE_DISPLAY_META: Record<string, { label: string; color: string; desc: string; category: NodeCategory }> = {
  // 触发器
  trigger:        { label: '触发器',   color: 'blue',   desc: '通过 HTTP POST 请求触发流程',          category: 'trigger' },
  // 流程控制
  filter:         { label: '条件筛选',        color: 'slate',  desc: '按条件过滤，决定是否继续执行',               category: 'flow_control' },
  delay:          { label: '延时等待',        color: 'orange', desc: '等待指定时间后继续执行',                   category: 'flow_control' },
  switch:         { label: '多路分支',        color: 'sky',    desc: '根据条件将数据路由到不同分支',               category: 'flow_control' },
  loop:           { label: '循环迭代',        color: 'pink',   desc: '对数组或指定次数循环执行内部步骤',            category: 'flow_control' },
  merge:          { label: '合并节点',        color: 'teal',   desc: '合并多个上游分支的数据流',                 category: 'flow_control' },
  try_catch:      { label: '异常处理',        color: 'red',    desc: '捕获执行错误并走降级分支',                 category: 'flow_control' },
  // 数据转换
  assign:         { label: '变量赋值',        color: 'indigo', desc: '设置或修改变量，供后续节点使用',            category: 'data_transform' },
  aggregate:      { label: '数据聚合',        color: 'cyan',   desc: '对数据列表进行聚合统计（计数、求和、分组等）',  category: 'data_transform' },
  code:           { label: '代码脚本',        color: 'gray',   desc: '运行 JavaScript/Python 自定义代码片段',   category: 'data_transform' },
  template:       { label: '模板渲染',        color: 'amber',  desc: '使用模板引擎将变量插入到文本中',             category: 'data_transform' },
  // 业务动作
  action:         { label: '数据表操作',       color: 'emerald', desc: '在多维表格中执行 CRUD 操作',              category: 'action' },
  http_request:   { label: 'HTTP 请求',       color: 'teal',   desc: '向外部系统发送 HTTP 请求',                category: 'action' },
  im_message:     { label: '发送消息',        color: 'violet', desc: '通过飞书 IM 发送文本或卡片消息',            category: 'action' },
  // 通知
  email:          { label: '发送邮件',        color: 'rose',   desc: '发送电子邮件通知',                       category: 'notification' },
  bot_notify:     { label: 'Bot 通知',        color: 'fuchsia',desc: '通过 Bot Webhook 推送通知到飞书/钉钉/企微等', category: 'notification' },
  // 飞书生态
  create_doc:     { label: '创建文档',        color: 'lime',   desc: '在飞书云空间创建文档/表格/幻灯片/多维表格',    category: 'lark_ecosystem' },
  create_task:    { label: '创建任务',        color: 'yellow', desc: '创建飞书待办任务并指派负责人',               category: 'lark_ecosystem' },
  calendar_event: { label: '日历事件',        color: 'green',  desc: '创建飞书日历日程并邀请参会人',               category: 'lark_ecosystem' },
  upload_file:    { label: '上传文件',        color: 'purple', desc: '上传文件到飞书云空间',                     category: 'lark_ecosystem' },
  approval:       { label: '发起审批',        color: 'orange', desc: '创建飞书审批实例并等待审批结果',             category: 'lark_ecosystem' },
  // 核心
  end:            { label: '结束',            color: 'green',  desc: '工作流终点',                             category: 'core' },
};

/** @deprecated 使用 NODE_DISPLAY_META 替代 */
export const CRUD_ACTION_META: Record<string, { label: string; color: string; desc: string }> = {
  create_record: { label: '新增记录', color: 'emerald', desc: '在数据表中创建一条新记录' },
  read_records:  { label: '查询记录', color: 'blue',   desc: '按条件查询记录列表' },
  update_record: { label: '更新记录', color: 'amber',  desc: '按条件更新已有记录' },
  delete_record: { label: '删除记录', color: 'red',    desc: '按条件删除匹配的记录' },
  filter:        { label: '筛选',     color: 'slate',  desc: '按条件过滤，决定是否继续执行' },
  delay:         { label: '延迟',     color: 'orange', desc: '等待指定时间后继续执行' },
  http_request:  { label: 'HTTP 请求', color: 'teal',  desc: '向外部系统发送 HTTP 请求' },
  im_message:    { label: '发送消息', color: 'violet', desc: '通过飞书 IM 发送文本或卡片消息' },
  switch:        { label: '多路分支', color: 'sky',    desc: '根据条件将数据路由到不同分支' },
  loop:          { label: '循环迭代', color: 'pink',   desc: '对数组或指定次数循环执行内部步骤' },
  merge:         { label: '合并节点', color: 'teal',   desc: '合并多个上游分支的数据流' },
  try_catch:     { label: '异常处理', color: 'red',    desc: '捕获执行错误并走降级分支' },
  assign:        { label: '变量赋值', color: 'indigo', desc: '设置或修改变量，供后续节点使用' },
  aggregate:     { label: '数据聚合', color: 'cyan',   desc: '对数据列表进行聚合统计' },
  code:          { label: '代码脚本', color: 'gray',   desc: '运行自定义代码片段' },
  template:      { label: '模板渲染', color: 'amber',  desc: '使用模板引擎将变量插入到文本中' },
  email:         { label: '发送邮件', color: 'rose',   desc: '发送电子邮件通知' },
  bot_notify:    { label: 'Bot 通知', color: 'fuchsia', desc: '通过 Bot Webhook 推送通知' },
  create_doc:    { label: '创建文档', color: 'lime',   desc: '在飞书云空间创建文档/表格/幻灯片' },
  create_task:   { label: '创建任务', color: 'yellow', desc: '创建飞书待办任务并指派负责人' },
  calendar_event:{ label: '日历事件', color: 'green',  desc: '创建飞书日历日程并邀请参会人' },
  upload_file:   { label: '上传文件', color: 'purple', desc: '上传文件到飞书云空间' },
  approval:      { label: '发起审批', color: 'orange', desc: '创建飞书审批实例' },
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
  /** 列表摘要用：步骤数量（避免传输完整 steps 导致响应过大） */
  stepCount?: number;
  /** 触发器类型：webhook / scheduled / bitable_event */
  triggerKind?: TriggerKind;
  /** 触发器快照（执行时记录的具体触发配置，如 webhook 地址 / cron / 事件表） */
  triggerDetail?: Record<string, unknown>;
}
