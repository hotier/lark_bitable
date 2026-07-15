/**
 * 工作流节点插件注册中心
 *
 * 所有工作流节点通过注册式架构管理：
 * 1. 定义 NodePlugin 接口即可注册新节点
 * 2. Registry 自动派生 React Flow nodeTypes / 侧栏列表 / 添加菜单
 * 3. 执行引擎通过 Registry 派发，无需 switch-case
 *
 * 添加新节点只需：
 *   1. 创建 lib/workflow-engine/plugins/xxx.plugin.ts
 *   2. 实现 NodePlugin 接口
 *   3. 在 lib/workflow-engine/plugins/index.ts 中 import + register
 *   4. （可选）在 app/components/workflow-editor/panels/ConfigPanel.tsx 中注册配置面板组件
 */

import type { FC } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { WorkflowNode, ExecutionStep, CrdAction, NodeCategory } from '@/types';

// ====== 执行上下文 ======

export interface ExecutionContext {
  webhookContent: Record<string, unknown>;
  nodeOutputs: Map<string, Record<string, unknown>>;
  steps: ExecutionStep[];
  startTime: number;
  hasFailure: boolean;
  stopped: boolean;
}

// ====== 节点插件接口 ======

export interface NodePlugin {
  /** 业务类型 kind（与 WorkflowNode.type 对应） */
  kind: string;

  /** React Flow 组件类型名 */
  rfType: string;

  /** 显示名称 */
  displayName: string;

  /** 描述文字 */
  description: string;

  /** 图标组件（lucide-react） */
  icon: FC<{ className?: string }>;

  /** Tailwind 文字颜色 class */
  color: string;

  /** Tailwind 背景色 class */
  bg: string;

  /** Tailwind 边框色 class */
  border: string;

  /** React Flow MiniMap 节点颜色 */
  miniMapColor: string;

  /** 节点分类 */
  category: NodeCategory;

  /** 子动作类型（仅 action 节点有，如 create_record） */
  actionType?: CrdAction;

  /** 是否为内置核心节点（trigger/end，不可删除） */
  isCore?: boolean;

  /** 默认配置 */
  defaults: () => Record<string, unknown>;

  /** React Flow 节点渲染组件 */
  component: FC<NodeProps>;

  /** 执行节点（可选；若通过 registerExecutor 注册则无需此字段） */
  execute?: (node: WorkflowNode, ctx: ExecutionContext) => Promise<ExecutionStep>;

  /**
   * 编辑器序列化：React Flow data → WorkflowNode 配置字段（不含 id/type/title）
   */
  serialize?: (data: Record<string, unknown>) => Record<string, unknown>;

  /**
   * 编辑器反序列化：WorkflowNode → React Flow data
   */
  deserialize?: (wfNode: WorkflowNode) => Record<string, unknown>;
}

// ====== 注册中心 ======

export type NodeExecutor = (node: WorkflowNode, ctx: ExecutionContext) => Promise<ExecutionStep>;

class NodeRegistry {
  private plugins: NodePlugin[] = [];
  private byKey: Map<string, NodePlugin> = new Map();
  private executors: Map<string, NodeExecutor> = new Map();

  /** 注册一个节点插件 */
  register(plugin: NodePlugin): void {
    const key = plugin.actionType ? `${plugin.kind}:${plugin.actionType}` : plugin.kind;
    this.byKey.set(key, plugin);
    this.plugins.push(plugin);
  }

  /** 注册独立 executor（用于服务端执行，避免客户端引入 Node.js SDK） */
  registerExecutor(kind: string, executor: NodeExecutor): void {
    this.executors.set(kind, executor);
  }

  /** 按 key（kind 或 kind:actionType）查找 */
  get(key: string): NodePlugin | undefined {
    return this.byKey.get(key);
  }

  /** 获取所有可添加到画布的节点项 */
  getAddableItems(): NodePlugin[] {
    return this.plugins.filter((p) => !p.isCore);
  }

  /** 按分类获取可添加节点（用于侧边栏分类菜单） */
  getAddableItemsByCategory(): Map<string, NodePlugin[]> {
    const grouped = new Map<string, NodePlugin[]>();
    for (const p of this.plugins) {
      if (p.isCore) continue;
      const cat = p.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(p);
    }
    return grouped;
  }

  /** 为 React Flow 生成 nodeTypes 对象 */
  getReactFlowNodeTypes(): Record<string, FC<NodeProps>> {
    const types: Record<string, FC<NodeProps>> = {};
    const seen = new Set<string>();
    for (const p of this.plugins) {
      if (!seen.has(p.rfType)) {
        seen.add(p.rfType);
        types[p.rfType] = p.component;
      }
    }
    return types;
  }

  /** 返回所有核心节点（trigger / end，不可删除）的 rfType 列表 */
  getCoreRfTypes(): string[] {
    return this.plugins.filter((p) => p.isCore).map((p) => p.rfType);
  }

  /** 为 MiniMap 查找节点颜色 */
  getMiniMapColor(rfType: string): string {
    const plugin = this.plugins.find((p) => p.rfType === rfType);
    return plugin?.miniMapColor || '#94a3b8';
  }

  /** kind → rfType 映射 */
  kindToRFType(kind: string): string {
    const plugin = this.plugins.find((p) => p.kind === kind);
    return plugin?.rfType || 'default';
  }

  /** rfType → kind 映射 */
  rfTypeToKind(rfType: string): string {
    const plugin = this.plugins.find((p) => p.rfType === rfType);
    return plugin?.kind || rfType;
  }

  /** 创建新节点默认 WorkflowNode 配置 */
  createWorkflowDefaults(kind: string, actionType?: string): Record<string, unknown> {
    const key = actionType ? `${kind}:${actionType}` : kind;
    const plugin = this.byKey.get(key) || this.plugins.find((p) => p.kind === kind);
    return plugin?.defaults() || {};
  }

  /** kind + actionType → 显示名 */
  getDisplayName(kind: string, actionType?: string): string {
    const key = actionType ? `${kind}:${actionType}` : kind;
    const plugin = this.byKey.get(key) || this.plugins.find((p) => p.kind === kind);
    return plugin?.displayName || kind;
  }

  /** 序列化：RF data → WorkflowNode config */
  serializeNodeData(rfType: string, kind: string, data: Record<string, unknown>): Record<string, unknown> {
    const plugin = this.plugins.find((p) => p.rfType === rfType);
    if (plugin?.serialize) return plugin.serialize(data);
    // 默认：data 即 config
    const configKey = configFieldName(kind);
    return configKey ? { [configKey]: { ...data } } : { ...data };
  }

  /** 反序列化：WorkflowNode → RF data */
  deserializeNodeData(wfNode: WorkflowNode): Record<string, unknown> {
    const plugin = this.plugins.find((p) => p.kind === wfNode.type);
    if (plugin?.deserialize) return plugin.deserialize(wfNode);
    const configKey = configFieldName(wfNode.type);
    if (configKey) {
      const config = (wfNode as unknown as Record<string, unknown>)[configKey] as Record<string, unknown> | undefined;
      return { label: wfNode.title, ...(config || {}) };
    }
    return { label: wfNode.title };
  }

  /** 执行节点（优先使用 registerExecutor 注册的执行器） */
  async execute(node: WorkflowNode, ctx: ExecutionContext): Promise<ExecutionStep> {
    const executor = this.executors.get(node.type);
    if (executor) return executor(node, ctx);

    const plugin = this.plugins.find((p) => p.kind === node.type);
    if (!plugin || !plugin.execute) {
      return {
        title: node.title,
        action: node.type,
        success: false,
        message: `未注册的执行器: ${node.type}`,
      };
    }
    return plugin.execute(node, ctx);
  }
}

function configFieldName(kind: string): string | null {
  switch (kind) {
    case 'trigger': return 'triggerConfig';
    case 'action': return 'actionConfig';
    case 'filter': return 'filterConfig';
    case 'delay': return 'delayConfig';
    case 'http_request': return 'httpRequestConfig';
    case 'im_message': return 'imConfig';
    case 'switch': return 'switchConfig';
    case 'loop': return 'loopConfig';
    case 'merge': return 'mergeConfig';
    case 'try_catch': return 'tryCatchConfig';
    case 'assign': return 'assignConfig';
    case 'aggregate': return 'aggregateConfig';
    case 'code': return 'codeConfig';
    case 'template': return 'templateConfig';
    case 'email': return 'emailConfig';
    case 'bot_notify': return 'botNotifyConfig';
    case 'create_doc': return 'createDocConfig';
    case 'create_task': return 'createTaskConfig';
    case 'calendar_event': return 'calendarEventConfig';
    case 'upload_file': return 'uploadFileConfig';
    case 'approval': return 'approvalConfig';
    default: return null;
  }
}

/** 全局单例 */
export const nodeRegistry = new NodeRegistry();
