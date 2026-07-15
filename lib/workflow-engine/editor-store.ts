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
  type NodeChange,
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

  // 拖拽编排（幽灵拖拽：拖拽时真实节点/连线保持不动，仅预览坐标跟随光标）
  draggingId: string | null;
  dragPreview: { x: number; y: number } | null;
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
  /** 从节点列表拖入画板：在落点所在的执行顺序位置插入新节点（拼接进对应线性片段并重连连线） */
  insertNodeAt: (kind: NodeKind, actionType: CrdAction | undefined, pos: { x: number; y: number }) => void;
  deleteNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  onConnect: (connection: Connection) => void;
  updateNodeData: (nodeId: string, data: Partial<AppNodeData>) => void;
  /** 拖拽节点后，按落点（垂直位置）重排其所在线性片段的执行顺序：仅按新顺序
   *  重建连线（箭头方向即执行顺序），松手后自动吸附成整齐一列。
   *  dropY 为松手时光标对应的预览 y；省略时用节点当前 y。 */
  reorderNode: (draggedId: string, dropY?: number) => void;
  /** 拖拽中：根据落点 y 计算插入位置，返回用于绘制插入指示线的参考端点。
   *  aboveId/belowId 为链内相邻节点；entrySourceId/exitTargetId 为链外
   *  （如触发器/结束）的入/出口节点，用于把节点拖到片段最顶端/最底端时
   *  指示线仍能落在「触发器→首节点」「末节点→结束」这条连接线的中点。
   *  返回 null 表示当前不可重排（非线性片段等）。 */
  getReorderPreview: (draggedId: string, dropY: number) => {
    aboveId: string | null;
    belowId: string | null;
    entrySourceId: string | null;
    exitTargetId: string | null;
  } | null;
  /** 从节点列表拖入画板时，根据落点坐标计算插入位置，返回用于绘制插入指示线的参考端点。
   *  返回 null 表示当前画布无可插入的线性片段。 */
  getInsertPreview: (pos: { x: number; y: number }) => {
    aboveId: string | null;
    belowId: string | null;
    entrySourceId: string | null;
    exitTargetId: string | null;
  } | null;
  /** 拖拽开始：记录被拖节点并初始化预览坐标 */
  beginNodeDrag: (id: string) => void;
  /** 拖拽中：更新预览坐标（用于浮动幽灵） */
  updateDragPreview: (pos: { x: number; y: number }) => void;
  /** 拖拽结束：清空拖拽态 */
  endNodeDrag: () => void;
  setApps: (apps: { app_token: string; name: string }[]) => void;
  setWorkflowName: (name: string) => void;
  setWorkflowStatus: (status: Workflow['status']) => void;
  getWorkflow: () => Workflow;
  reset: () => void;
  initFromScratch: () => void;
  layoutNodes: () => void;

  // 未保存修改标记：任一编辑操作置 true，加载/保存后置 false
  isDirty: boolean;
  markSaved: () => void;
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

// ====== 拖拽重排：线性片段收集 ======

/**
 * 从被拖拽节点沿「纯线性」连线（每个节点都单入单出）向前/向后收集所在片段。
 * 遇到分支/汇聚（多入或多出）立即停止，因此判断(switch)、loop 等节点不会被纳入。
 * 返回按连接顺序排列的节点 id 数组（含 draggedId）。
 */
function collectLinearChain(edges: AppEdge[], draggedId: string): string[] {
  const incoming = new Map<string, string[]>(); // target -> sources
  const outgoing = new Map<string, string[]>(); // source -> targets
  for (const e of edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.target);
  }

  const chain: string[] = [draggedId];
  let cur = draggedId;
  while (true) {
    const ins = incoming.get(cur) || [];
    if (ins.length !== 1) break;
    const prev = ins[0];
    if ((outgoing.get(prev) || []).length !== 1) break;
    if ((incoming.get(prev) || []).length !== 1) break;
    chain.unshift(prev);
    cur = prev;
  }
  cur = draggedId;
  while (true) {
    const outs = outgoing.get(cur) || [];
    if (outs.length !== 1) break;
    const next = outs[0];
    if ((incoming.get(next) || []).length !== 1) break;
    if ((outgoing.get(next) || []).length !== 1) break;
    chain.push(next);
    cur = next;
  }
  return chain;
}

// ====== 拖拽重排：按新顺序重建连线 ======

/**
 * 重排线性片段时，依据新的顺序 newOrder 重新连接连线：
 * - 入口边（链外 → 原首节点）改向到新首节点
 * - 出口边（原末节点 → 链外）改向到新末节点
 * - 链内旧边全部移除，按 newOrder 首尾相连重建
 * 这样箭头方向永远等于真实执行顺序（始终向前指向下方），
 * 与节点被拖到画布的什么位置无关——线只是节点间的视觉连接，
 * 箭头指向才是可信的执行流。
 */
function rerouteLinearChain(
  edges: AppEdge[],
  chain: string[],
  newOrder: string[],
): AppEdge[] {
  const chainSet = new Set(chain);
  const first = newOrder[0];
  const last = newOrder[newOrder.length - 1];

  // 链两端连接到链外的进/出边（线性片段必各 ≤1 条）
  const entryEdge = edges.find((e) => chainSet.has(e.target) && !chainSet.has(e.source));
  const exitEdge = edges.find((e) => chainSet.has(e.source) && !chainSet.has(e.target));

  const kept = edges.filter((e) => {
    if (chainSet.has(e.source) && chainSet.has(e.target)) return false; // 链内边：重建
    if (entryEdge && e.id === entryEdge.id) return false; // 入口边：改向
    if (exitEdge && e.id === exitEdge.id) return false; // 出口边：改向
    return true;
  });

  const newOnes: AppEdge[] = [];
  if (entryEdge) newOnes.push({ ...entryEdge, target: first });
  for (let i = 0; i < newOrder.length - 1; i++) {
    const s = newOrder[i];
    const t = newOrder[i + 1];
    const existing = edges.find((e) => e.source === s && e.target === t);
    newOnes.push({
      id: `e${s}${t}`,
      source: s,
      target: t,
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
      style: { stroke: '#94a3b8', strokeWidth: 2 },
      ...(existing ? { sourceHandle: existing.sourceHandle, targetHandle: existing.targetHandle } : {}),
    });
  }
  if (exitEdge) newOnes.push({ ...exitEdge, source: last });

  return [...kept, ...newOnes];
}

// ====== 吸附成整齐一列（拖拽重排 / 拖拽新增落点后共用） ======

/**
 * 把整个线性片段（触发器 → 中间节点 → 结束）吸附成整齐的一列：
 * - 取链内节点 x 的中位数作为列 X 坐标
 * - 以触发器 Y 为上锚点，纵向按固定间距排布
 * - 触发器、链节点、结束节点全部参与列排布，彻底杜绝重叠
 */
function snapLinearChainColumn(
  nodes: AppNode[],
  chain: string[],
  newOrder: string[],
  triggerId: string | null,
  endId: string | null,
): AppNode[] {
  const xOf = (id: string) => nodes.find((n) => n.id === id)!.position.x;
  const SLOT = 150;
  const xs = chain.map(xOf).sort((a, b) => a - b);
  const colX = xs[Math.floor(xs.length / 2)];

  // 锚点：以触发器 Y 为列的起始行
  const topY = triggerId
    ? nodes.find((n) => n.id === triggerId)!.position.y
    : Math.min(...chain.map((id) => nodes.find((n) => n.id === id)!.position.y));

  const newPositions = new Map<string, { x: number; y: number }>();
  let row = 0;

  // 触发器（列首）
  if (triggerId) {
    newPositions.set(triggerId, { x: colX, y: topY + row * SLOT });
    row++;
  }

  // 链节点（按 newOrder 顺序）
  newOrder.forEach((id) => {
    newPositions.set(id, { x: colX, y: topY + row * SLOT });
    row++;
  });

  // 结束节点（列尾）
  if (endId) {
    newPositions.set(endId, { x: colX, y: topY + row * SLOT });
  }

  return nodes.map((n) =>
    newPositions.has(n.id) ? { ...n, position: newPositions.get(n.id)! } : n,
  );
}

// ====== 拖拽新增：从节点列表拖入并按落点插入执行顺序 ======

/** 枚举图中所有「纯线性片段」（长度 ≥ 2），每个片段按箭头方向有序。 */
function enumerateLinearChains(edges: AppEdge[]): string[][] {
  const allIds = new Set<string>();
  for (const e of edges) { allIds.add(e.source); allIds.add(e.target); }
  const visited = new Set<string>();
  const res: string[][] = [];
  for (const id of allIds) {
    if (visited.has(id)) continue;
    const chain = collectLinearChain(edges, id);
    chain.forEach((c) => visited.add(c));
    if (chain.length >= 2) res.push(chain);
  }
  return res;
}

/**
 * 根据落点 y 找到新节点应插入的片段与槽位：
 * - 若落点落在某片段中相邻两节点（箭头方向）的纵向跨度内，插入它们之间；
 * - 否则插入到离落点最近的片段的顶端/底端。
 */
function findInsertionPoint(
  chains: string[][],
  nodes: AppNode[],
  dropY: number,
): { chain: string[]; index: number } | null {
  const yOf = (id: string) => nodes.find((n) => n.id === id)!.position.y;
  let best: { chain: string[]; index: number } | null = null;
  let bestDist = Infinity;
  for (const chain of chains) {
    for (let i = 0; i < chain.length - 1; i++) {
      const ya = yOf(chain[i]);
      const yb = yOf(chain[i + 1]);
      if (dropY >= Math.min(ya, yb) && dropY <= Math.max(ya, yb)) {
        return { chain, index: i + 1 };
      }
    }
    const top = yOf(chain[0]);
    const bottom = yOf(chain[chain.length - 1]);
    const d = dropY < top ? top - dropY : dropY - bottom;
    if (d < bestDist) { bestDist = d; best = { chain, index: dropY < top ? 0 : chain.length }; }
  }
  return best;
}

// ====== Store 实现 ======

export const useWorkflowEditorStore = create<WorkflowStore>((set, get) => ({
  nodes: [],
  edges: [],
  draggingId: null,
  dragPreview: null,
  onNodesChange: (changes) => {
    const { draggingId, dragPreview, nodes: curNodes } = get();
    const filtered: NodeChange[] = [];
    let preview = dragPreview;
    let nextDraggingId = draggingId;

    for (const c of changes) {
      if (c.type === 'position' && c.id) {
        // 拖拽中的节点：冻结真实位置（节点与连线都保持不动），仅记录预览坐标
        if (c.dragging === true) {
          if (!nextDraggingId) nextDraggingId = c.id; // 兜底：首个拖拽事件
          if (c.id === nextDraggingId) {
            if (c.position) preview = c.position;
            continue;
          }
        } else if (c.id === draggingId) {
          // 拖拽结束时的「提交位置」也忽略，统一由 reorderNode 重排落位
          continue;
        }
      }
      filtered.push(c);
    }

    const nodes = applyNodeChanges(filtered, curNodes as Node[]) as unknown as AppNode[];
    // 仅「选择 / 尺寸测量」变化不应标记为未保存
    const meaningful = filtered.some((c) => c.type !== 'select' && c.type !== 'dimensions');

    const patch: Partial<WorkflowStore> = { nodes };
    if (nextDraggingId !== draggingId) patch.draggingId = nextDraggingId;
    if (preview !== dragPreview) patch.dragPreview = preview;
    if (meaningful) patch.isDirty = true;
    set(patch);
  },
  onEdgesChange: (changes) => {
    const edges = applyEdgeChanges(changes, get().edges);
    // 仅「选择」变化不应标记为未保存
    const meaningful = changes.some((c) => c.type !== 'select');
    set(meaningful ? { edges, isDirty: true } : { edges });
  },

  workflowId: '',
  workflowName: '未命名工作流',
  workflowStatus: 'draft',
  isDirty: false,

  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  apps: [],

  // ---- 反序列化：Workflow → React Flow ----

  setWorkflow: (wf) => {
    const nodes: AppNode[] = [];
    const edges: AppEdge[] = [];

    wf.nodes.forEach((wn, idx) => {
      const deserialized = nodeRegistry.deserializeNodeData(wn);
      // 优先使用保存的画布坐标，保证「视觉上→下」顺序不被打乱
      const pos = wn.position ?? { x: 400, y: 80 + idx * 160 };
      const node = createNodeBase(wn.type, wn.id, pos, deserialized.label as string || wn.title, deserialized);
      nodes.push(node);
    });

    // 如果保存了边数据，使用保存的拓扑；否则回退到线性连接
    if (wf.edges && wf.edges.length > 0) {
      for (const we of wf.edges) {
        // 分支节点（判断节点）的出口按 sourceHandle 着色，保持分线可辨识
        const isFail = we.sourceHandle === 'fail';
        const isPass = we.sourceHandle === 'pass';
        const color = isFail ? '#ef4444' : isPass ? '#0ea5e9' : '#94a3b8';
        edges.push({
          id: we.id,
          source: we.source,
          target: we.target,
          sourceHandle: we.sourceHandle ?? undefined,
          targetHandle: we.targetHandle ?? undefined,
          type: 'default',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
          style: { stroke: color, strokeWidth: 2 },
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

    // 仅当工作流未保存坐标时才重新布局；否则直接使用保存的画布坐标，
    // 以保证「视觉上→下顺序」== 执行顺序，不被重新排布打乱
    const hasPositions = wf.nodes.every((wn) => !!wn.position);
    const finalNodes = hasPositions ? nodes : layoutNodes(nodes, edges).nodes;

    set({
      nodes: finalNodes, edges,
      workflowId: wf.id,
      workflowName: wf.name,
      workflowStatus: wf.status,
      selectedNodeId: null,
      isDirty: false,
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
      isDirty: false,
    });
  },

  // ---- 添加节点 ----

  insertNodeAt: (kind, actionType, pos) => {
    const { nodes, edges } = get();
    const { node: newNode } = createNewNode(kind, actionType);
    const placed: AppNode = { ...newNode, position: { x: pos.x, y: pos.y } };
    const newNodesAll = [...nodes, placed];

    const chains = enumerateLinearChains(edges);
    const ins = findInsertionPoint(chains, newNodesAll, pos.y);

    if (!ins) {
      // 无合适片段（如画布还没连线）：退化为「插到结束前」
      get().addNode(kind, actionType);
      return;
    }

    const { chain, index } = ins;
    const newOrder = [...chain.slice(0, index), newNode.id, ...chain.slice(index)];
    const newEdges = rerouteLinearChain(edges, chain, newOrder);
    // 拖入完成后整列自动吸附（触发器 → ... → 结束，杜绝重叠）
    const triggerId = nodes.find((n) => n.type === NODE_TYPES.TRIGGER)?.id ?? null;
    const endId = nodes.find((n) => n.type === NODE_TYPES.END)?.id ?? null;
    const newNodes = snapLinearChainColumn(newNodesAll, chain, newOrder, triggerId, endId);
    set({ nodes: newNodes, edges: newEdges, isDirty: true });
  },

  addNode: (kind, actionType) => {
    const { nodes, edges } = get();
    const { node: newNode } = createNewNode(kind, actionType);

    const endIdx = nodes.findIndex((n) => n.type === NODE_TYPES.END);
    const insertIdx = endIdx >= 0 ? endIdx : nodes.length;
    const prevNode = insertIdx > 0 ? nodes[insertIdx - 1] : null;
    const endNode = nodes.find((n) => n.type === NODE_TYPES.END);

    // 布局固定：新节点放在结束节点下方（不与其他节点重叠），不整图重排
    const y = endNode ? endNode.position.y + 160 : (prevNode ? prevNode.position.y + 160 : 80);
    const x = endNode ? endNode.position.x : 400;
    const positionedNode = { ...newNode, position: { x, y } };
    const newNodes = [...nodes.slice(0, insertIdx), positionedNode, ...nodes.slice(insertIdx)];

    let newEdges = [...edges];
    if (prevNode && endNode) {
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

    set({ nodes: newNodes, edges: newEdges, isDirty: true });
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

    let newNodes = nodes.filter((n) => n.id !== nodeId);

    // 删除后闭合所在链的缺口：收集被删节点所在线性链（用旧边），
    // 去掉被删节点后原地压紧成一列（仅消除缺口，不触发全图重排）
    const oldChain = collectLinearChain(edges, nodeId);
    const remaining = oldChain.filter((id) => id !== nodeId);
    if (remaining.length >= 1) {
      const triggerId = nodes.find((n) => n.type === NODE_TYPES.TRIGGER)?.id ?? null;
      const endId = nodes.find((n) => n.type === NODE_TYPES.END)?.id ?? null;
      newNodes = snapLinearChainColumn(newNodes, remaining, remaining, triggerId, endId);
    }

    set({
      nodes: newNodes,
      edges: newEdges,
      selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
      isDirty: true,
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
    // 布局固定：复制节点放在原节点右下偏移处，不整图重排
    set({ nodes: newNodes, isDirty: true });
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
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'default',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
      style: { stroke: '#94a3b8', strokeWidth: 2 },
    };

    // 分支节点（如判断节点）的不同出口用不同颜色区分，便于辨识分线
    if (connection.sourceHandle === 'fail') {
      newEdge.style = { stroke: '#ef4444', strokeWidth: 2 };
      newEdge.markerEnd = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#ef4444' };
    } else if (connection.sourceHandle === 'pass') {
      newEdge.style = { stroke: '#0ea5e9', strokeWidth: 2 };
      newEdge.markerEnd = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#0ea5e9' };
    }

    set({ edges: [...edges, newEdge], isDirty: true });
  },

  // ---- 幽灵拖拽：冻结真实位置，仅维护预览坐标 ----
  beginNodeDrag: (id) => {
    const n = get().nodes.find((x) => x.id === id);
    set({ draggingId: id, dragPreview: n ? { x: n.position.x, y: n.position.y } : null });
  },
  updateDragPreview: (pos) => set({ dragPreview: pos }),
  endNodeDrag: () => set({ draggingId: null, dragPreview: null }),

  // ---- 拖拽重排执行顺序（以箭头方向为唯一真相）----
  // 思路：从被拖拽节点沿「单入单出」的连线收集所在纯线性片段，
  // 遇到分支/汇聚（多入或多出）立即停止，因此判断(switch)、loop 等节点保持原位。
  // 链内顺序以「箭头方向」为准（collectLinearChain 已沿连线收集），落点 y 只用于
  // 决定被拖节点插入第几个槽位。重排后按新顺序重建连线，使箭头永远沿「前→后」
  // 指向下方——箭头方向即真实执行顺序，与节点被拖到画布何处无关。

  reorderNode: (draggedId, dropY) => {
    const { nodes, edges } = get();
    const dragged = nodes.find((n) => n.id === draggedId);
    if (!dragged || dragged.type === NODE_TYPES.TRIGGER || dragged.type === NODE_TYPES.END) return;

    const chain = collectLinearChain(edges, draggedId);
    if (chain.length < 2) return; // 仅孤立/分支节点，无需重排

    const yOf = (id: string) => nodes.find((n) => n.id === id)!.position.y;

    // 链内顺序以箭头方向为准；落点 y 仅决定被拖节点插入第几个槽位
    const without = chain.filter((id) => id !== draggedId);
    const draggedY = dropY ?? dragged.position.y;
    let targetIndex = without.filter((id) => yOf(id) < draggedY).length;
    targetIndex = Math.max(0, Math.min(without.length, targetIndex));

    const newOrder = [...without.slice(0, targetIndex), draggedId, ...without.slice(targetIndex)];

    // 按新顺序重建连线：箭头方向永远等于真实执行顺序（箭头 = 执行流）
    const newEdges = rerouteLinearChain(edges, chain, newOrder);

    // 拖拽重排完成后整列自动吸附（触发器 → ... → 结束，杜绝重叠）
    const triggerId = nodes.find((n) => n.type === NODE_TYPES.TRIGGER)?.id ?? null;
    const endId = nodes.find((n) => n.type === NODE_TYPES.END)?.id ?? null;
    const newNodes = snapLinearChainColumn(nodes, chain, newOrder, triggerId, endId);

    set({ nodes: newNodes, edges: newEdges, isDirty: true });
  },

  // ---- 拖拽中：计算插入指示线的参考端点 ----
  getReorderPreview: (draggedId, dropY) => {
    const { nodes, edges } = get();
    const dragged = nodes.find((n) => n.id === draggedId);
    if (!dragged || dragged.type === NODE_TYPES.TRIGGER || dragged.type === NODE_TYPES.END) return null;

    const chain = collectLinearChain(edges, draggedId);
    if (chain.length < 2) return null;

    const yOf = (id: string) => nodes.find((n) => n.id === id)!.position.y;
    const without = chain.filter((id) => id !== draggedId);

    let targetIndex = without.filter((id) => yOf(id) < dropY).length;
    targetIndex = Math.max(0, Math.min(without.length, targetIndex));

    // 与 reorderNode 一致：newOrder = without[0..idx) + dragged + without[idx..]
    const aboveId = targetIndex > 0 ? without[targetIndex - 1] : null;
    const belowId = targetIndex < without.length ? without[targetIndex] : null;

    // 链外的入/出口节点（如触发器/结束），用于片段最顶/最底端的指示线定位
    const chainSet = new Set(chain);
    const entrySourceId =
      edges.find((e) => chainSet.has(e.target) && !chainSet.has(e.source))?.source ?? null;
    const exitTargetId =
      edges.find((e) => chainSet.has(e.source) && !chainSet.has(e.target))?.target ?? null;

    return { aboveId, belowId, entrySourceId, exitTargetId };
  },

  // ---- 拖入预览：从节点列表拖入画板时，计算插入指示线的参考端点 ----
  getInsertPreview: (pos) => {
    const { nodes, edges } = get();
    const chains = enumerateLinearChains(edges);
    const ins = findInsertionPoint(chains, nodes, pos.y);
    if (!ins) return null;

    const { chain, index } = ins;
    const aboveId = index > 0 ? chain[index - 1] : null;
    const belowId = index < chain.length ? chain[index] : null;

    // 链外的入/出口节点（如触发器/结束），用于片段最顶/最底端（插入到触发器下方
    // 或结束上方）时指示线仍能落在「触发器→首节点」「末节点→结束」这条连接线的中点
    const chainSet = new Set(chain);
    const entrySourceId =
      edges.find((e) => chainSet.has(e.target) && !chainSet.has(e.source))?.source ?? null;
    const exitTargetId =
      edges.find((e) => chainSet.has(e.source) && !chainSet.has(e.target))?.target ?? null;

    return { aboveId, belowId, entrySourceId, exitTargetId };
  },

  // ---- 更新节点数据 ----

  updateNodeData: (nodeId, data) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } as AppNodeData } : n,
      ),
      isDirty: true,
    });
  },

  setApps: (apps) => set({ apps }),
  setWorkflowName: (name) => set({ workflowName: name, isDirty: true }),
  setWorkflowStatus: (status) => set({ workflowStatus: status, isDirty: true }),
  markSaved: () => set({ isDirty: false }),

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
        position: { x: n.position.x, y: n.position.y },
      };

      // 通过 Registry 序列化配置
      const serialized = nodeRegistry.serializeNodeData(rfType, kind, data);
      return { ...base, ...serialized };
    });

    // 持久化边（含分支句柄）
    const wfEdges: WorkflowEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
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
