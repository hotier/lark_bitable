/**
 * 工作流编辑器 Zustand Store
 *
 * 通过 NodeRegistry 统一管理所有节点类型的创建/序列化。
 * 不再硬编码 NODE_TYPES/Data 接口，添加新节点无需修改此文件。
 */

import { create } from 'zustand';
import {
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
} from '@xyflow/react';
import type { Workflow, WorkflowNode, WorkflowEdge, NodeKind, CrdAction } from '@/types';
import { nodeRegistry } from './node-registry';

// 确保插件已注册
import './plugins';

// ====== 工具 ======

export function idGen(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ====== 节点/边 类型常量 ======

/** 从注册表推导 NODE_TYPES（保留向后兼容） */
export const NODE_TYPES = {
  TRIGGER: 'triggerNode',
  ACTION: 'actionNode',
  FILTER: 'filterNode',
  DELAY: 'delayNode',
  HTTP: 'httpNode',
  IM: 'imNode',
  END: 'endNode',
  SWITCH: 'switchNode',
  LOOP: 'loopNode',
  MERGE: 'mergeNode',
  TRY_CATCH: 'tryCatchNode',
  ASSIGN: 'assignNode',
  AGGREGATE: 'aggregateNode',
  CODE: 'codeNode',
  TEMPLATE: 'templateNode',
  EMAIL: 'emailNode',
  BOT_NOTIFY: 'botNotifyNode',
  CREATE_DOC: 'createDocNode',
  CREATE_TASK: 'createTaskNode',
  CALENDAR_EVENT: 'calendarEventNode',
  UPLOAD_FILE: 'uploadFileNode',
  APPROVAL: 'approvalNode',
} as const;

// ====== 泛化数据类型 ======

export type AppNodeData = Record<string, unknown> & { label: string };
export type AppNode = Node<AppNodeData>;
export type AppEdge = Edge;

// ====== Store State ======

interface WorkflowStore {
  // React Flow 核心状态
  nodes: AppNode[];
  edges: AppEdge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;

  // 工作流元数据
  workflowId: string;
  workflowName: string;
  workflowStatus: string;

  // 选中的节点
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;

  // 飞书应用列表
  apps: { app_token: string; name: string }[];

  // 操作
  setWorkflow: (wf: Workflow) => void;
  addNode: (kind: NodeKind, actionType?: CrdAction) => void;
  deleteNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  onConnect: (connection: Connection) => void;
  updateNodeData: (nodeId: string, data: Partial<AppNodeData>) => void;
  setApps: (apps: { app_token: string; name: string }[]) => void;
  setWorkflowName: (name: string) => void;
  getWorkflow: () => Workflow;
  reset: () => void;
  initFromScratch: () => void;
  layoutNodes: () => void;
}

// ====== 节点创建（通过 Registry） ======

function createNodeBase(
  kind: string,
  id: string,
  position: { x: number; y: number },
  label: string,
  data: Record<string, unknown> = {},
): AppNode {
  const rfType = nodeRegistry.kindToRFType(kind);
  return {
    id,
    type: rfType,
    position,
    data: { label, ...data } as AppNodeData,
    dragHandle: '.drag-handle',
  };
}

function createNewNode(kind: NodeKind, actionType?: CrdAction): { node: AppNode; wfNode: WorkflowNode } {
  const id = idGen();
  const displayName = nodeRegistry.getDisplayName(kind, actionType);
  const defaults = nodeRegistry.createWorkflowDefaults(kind, actionType);

  const node = createNodeBase(kind, id, { x: 250, y: 100 }, displayName, defaults);

  const wfNode: WorkflowNode = {
    id,
    type: kind,
    title: displayName,
    ...nodeRegistry.serializeNodeData(nodeRegistry.kindToRFType(kind), kind, node.data as Record<string, unknown>),
  };

  return { node, wfNode };
}

// ====== 布局计算 ======

function layoutNodes(nodes: AppNode[], edges: AppEdge[]): { nodes: AppNode[] } {
  const START_X = 400;
  const START_Y = 80;
  const VERTICAL_GAP = 160;
  const HORIZONTAL_GAP = 260;

  // 构建邻接表和入度
  const outEdges = new Map<string, string[]>();
  const inDegrees = new Map<string, number>();
  for (const n of nodes) {
    outEdges.set(n.id, []);
    inDegrees.set(n.id, 0);
  }
  for (const e of edges) {
    outEdges.get(e.source)?.push(e.target);
    inDegrees.set(e.target, (inDegrees.get(e.target) || 0) + 1);
  }

  // 找根节点（入度为 0），优先 trigger
  const roots = nodes
    .filter((n) => inDegrees.get(n.id) === 0)
    .sort((a, b) => {
      if (a.type === NODE_TYPES.TRIGGER) return -1;
      if (b.type === NODE_TYPES.TRIGGER) return 1;
      return 0;
    });

  // 拓扑层级分配（最长路径）
  const level = new Map<string, number>();
  const dfs = (id: string, currentLevel: number) => {
    const prev = level.get(id) ?? -1;
    if (currentLevel <= prev) return;
    level.set(id, currentLevel);
    for (const child of outEdges.get(id) || []) {
      dfs(child, currentLevel + 1);
    }
  };
  for (const root of roots) {
    dfs(root.id, 0);
  }

  // 确保所有节点都有层级（处理孤立节点）
  for (const n of nodes) {
    if (!level.has(n.id)) level.set(n.id, 0);
  }

  // 按层级分组
  const levelGroups = new Map<number, string[]>();
  for (const [id, l] of level) {
    if (!levelGroups.has(l)) levelGroups.set(l, []);
    levelGroups.get(l)!.push(id);
  }

  // 定位节点
  const positions = new Map<string, { x: number; y: number }>();
  for (const [l, ids] of levelGroups) {
    const count = ids.length;
    ids.forEach((id, i) => {
      const x = START_X + (i - (count - 1) / 2) * HORIZONTAL_GAP;
      const y = START_Y + l * VERTICAL_GAP;
      positions.set(id, { x, y });
    });
  }

  return {
    nodes: nodes.map((n) => {
      const pos = positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    }),
  };
}

// ====== Store 实现 ======

export const useWorkflowEditorStore = create<WorkflowStore>((set, get) => ({
  nodes: [],
  edges: [],
  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes as Node[]) as unknown as AppNode[] });
  },
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  workflowId: '',
  workflowName: '未命名工作流',
  workflowStatus: 'draft',

  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  apps: [],

  // ---- 反序列化：Workflow → React Flow ----

  setWorkflow: (wf) => {
    const nodes: AppNode[] = [];
    const edges: AppEdge[] = [];

    wf.nodes.forEach((wn) => {
      const deserialized = nodeRegistry.deserializeNodeData(wn);
      const y = 80 + nodes.length * 160;
      const node = createNodeBase(wn.type, wn.id, { x: 400, y }, deserialized.label as string || wn.title, deserialized);
      nodes.push(node);
    });

    // 如果保存了边数据，使用保存的拓扑；否则回退到线性连接
    if (wf.edges && wf.edges.length > 0) {
      for (const we of wf.edges) {
        edges.push({
          id: we.id,
          source: we.source,
          target: we.target,
          type: 'default',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        });
      }
    } else {
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({
          id: `e${nodes[i].id}${nodes[i + 1].id}`,
          source: nodes[i].id,
          target: nodes[i + 1].id,
          type: 'default',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        });
      }
    }

    // 从保存的边数据恢复布局（如果有的话）
    const layout = layoutNodes(nodes, edges);

    set({
      nodes: layout.nodes, edges,
      workflowId: wf.id,
      workflowName: wf.name,
      workflowStatus: wf.status,
      selectedNodeId: null,
    });
  },

  // ---- 新建空白工作流 ----

  initFromScratch: () => {
    const triggerId = idGen();
    const endId = idGen();

    const triggerNode = createNodeBase('trigger', triggerId, { x: 400, y: 80 }, '触发器', {
      triggerKind: 'webhook',
      webhookUrl: `/api/trigger-webhook/${triggerId}`,
    });
    const endNode = createNodeBase('end', endId, { x: 400, y: 240 }, '结束');

    const edge: AppEdge = {
      id: `e${triggerId}${endId}`,
      source: triggerId,
      target: endId,
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
      style: { stroke: '#94a3b8', strokeWidth: 2 },
    };

    set({
      nodes: [triggerNode, endNode],
      edges: [edge],
      workflowId: idGen(),
      workflowName: '未命名工作流',
      workflowStatus: 'draft',
      selectedNodeId: null,
    });
  },

  // ---- 添加节点 ----

  addNode: (kind, actionType) => {
    const { nodes, edges } = get();
    const { node: newNode } = createNewNode(kind, actionType);

    const endIdx = nodes.findIndex((n) => n.type === NODE_TYPES.END);
    const insertIdx = endIdx >= 0 ? endIdx : nodes.length;
    const prevNode = insertIdx > 0 ? nodes[insertIdx - 1] : null;
    const y = prevNode ? prevNode.position.y + 160 : 80;

    const positionedNode = { ...newNode, position: { x: 400, y } };
    const newNodes = [...nodes.slice(0, insertIdx), positionedNode, ...nodes.slice(insertIdx)];

    let newEdges = [...edges];
    if (prevNode) {
      const endNode = nodes.find((n) => n.type === NODE_TYPES.END);
      if (endNode) {
        const oldEdge = newEdges.find((e) => e.source === prevNode.id && e.target === endNode.id);
        if (oldEdge) {
          newEdges = newEdges.filter((e) => e.id !== oldEdge.id);
        }
        newEdges.push({
          id: `e${prevNode.id}${newNode.id}`,
          source: prevNode.id,
          target: newNode.id,
          type: 'default',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        });
        newEdges.push({
          id: `e${newNode.id}${endNode.id}`,
          source: newNode.id,
          target: endNode.id,
          type: 'default',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        });
      }
    }

    const layout = layoutNodes(newNodes, newEdges);
    set({ nodes: layout.nodes, edges: newEdges });
  },

  // ---- 删除节点 ----

  deleteNode: (nodeId) => {
    const { nodes, edges } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type === NODE_TYPES.TRIGGER || node.type === NODE_TYPES.END) return;

    const inEdges = edges.filter((e) => e.target === nodeId);
    const outEdges = edges.filter((e) => e.source === nodeId);

    let newEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);

    for (const inEdge of inEdges) {
      for (const outEdge of outEdges) {
        newEdges.push({
          id: `e${inEdge.source}${outEdge.target}`,
          source: inEdge.source,
          target: outEdge.target,
          type: 'default',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
          style: { stroke: '#94a3b8', strokeWidth: 2 },
        });
      }
    }

    const newNodes = nodes.filter((n) => n.id !== nodeId);
    const layout = layoutNodes(newNodes, newEdges);
    set({
      nodes: layout.nodes,
      edges: newEdges,
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
    });
  },

  // ---- 复制节点 ----

  duplicateNode: (nodeId) => {
    const { nodes } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type === NODE_TYPES.TRIGGER || node.type === NODE_TYPES.END) return;

    const newId = idGen();
    const duplicated: AppNode = {
      ...JSON.parse(JSON.stringify(node)),
      id: newId,
      position: { x: node.position.x + 50, y: node.position.y + 50 },
      selected: false,
    };

    const newNodes = [...nodes, duplicated];
    const layout = layoutNodes(newNodes, get().edges);
    set({ nodes: layout.nodes });
  },

  // ---- 连接边 ----

  onConnect: (connection) => {
    const { edges, nodes } = get();
    if (!connection.source || !connection.target) return;

    const exists = edges.some((e) => e.source === connection.source && e.target === connection.target);
    if (exists) return;

    // 环检测 (DFS)
    const adjacency = new Map<string, string[]>();
    for (const e of [...edges, { source: connection.source, target: connection.target }]) {
      if (!adjacency.has(e.source)) adjacency.set(e.source, []);
      adjacency.get(e.source)!.push(e.target);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const hasCycle = (node: string): boolean => {
      visited.add(node);
      inStack.add(node);
      for (const next of adjacency.get(node) || []) {
        if (!visited.has(next)) {
          if (hasCycle(next)) return true;
        } else if (inStack.has(next)) {
          return true;
        }
      }
      inStack.delete(node);
      return false;
    };

    for (const n of nodes) {
      if (!visited.has(n.id) && hasCycle(n.id)) return;
    }

    const newEdge: AppEdge = {
      id: `e${connection.source}${connection.target}${Date.now()}`,
      source: connection.source,
      target: connection.target,
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
      style: { stroke: '#94a3b8', strokeWidth: 2 },
    };

    set({ edges: [...edges, newEdge] });
  },

  // ---- 更新节点数据 ----

  updateNodeData: (nodeId, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } as AppNodeData } : n,
      ),
    });
  },

  setApps: (apps) => set({ apps }),
  setWorkflowName: (name) => set({ workflowName: name }),

  // ---- 序列化：React Flow → Workflow ----

  getWorkflow: () => {
    const { nodes, edges, workflowId, workflowName, workflowStatus } = get();
    const wfNodes: WorkflowNode[] = nodes.map((n) => {
      const data = n.data as Record<string, unknown>;
      const rfType = n.type as string;
      const kind = nodeRegistry.rfTypeToKind(rfType) as NodeKind;

      const base: WorkflowNode = {
        id: n.id,
        type: kind,
        title: (data.label as string) || n.id,
      };

      // 通过 Registry 序列化配置
      const serialized = nodeRegistry.serializeNodeData(rfType, kind, data);
      return { ...base, ...serialized };
    });

    // 持久化边
    const wfEdges: WorkflowEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }));

    return {
      id: workflowId,
      name: workflowName,
      nodes: wfNodes,
      edges: wfEdges,
      status: workflowStatus as Workflow['status'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  },

  reset: () => {
    set({
      nodes: [], edges: [],
      workflowId: '', workflowName: '',
      workflowStatus: 'draft',
      selectedNodeId: null,
    });
  },

  // ---- 自动布局 ----

  layoutNodes: () => {
    const { nodes, edges } = get();
    const result = layoutNodes(nodes, edges);
    set({ nodes: result.nodes });
  },
}));
