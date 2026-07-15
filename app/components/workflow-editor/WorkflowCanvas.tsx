'use client';

import React, { useCallback, useEffect, useRef, useState, useMemo, type FC } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  type Node as RFNode,
  type NodeProps,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Save, Plus, Trash2, Copy, Zap,
  Loader2, LayoutGrid, FileText, X,
} from 'lucide-react';

import ExecutionList from '@/app/components/executions/ExecutionList';

import { useWorkflowEditorStore, NODE_TYPES } from '@/lib/workflow-engine/editor-store';
import { nodeRegistry } from '@/lib/workflow-engine/node-registry';
import RightPanel from './panels/RightPanel';
import CustomEdge from './edges/CustomEdge';
import { withDeleteButton } from './nodes/withDeleteButton';
import type { Workflow, Field, CrdAction } from '@/types';

const edgeTypes = { default: CustomEdge };

interface WorkflowCanvasProps {
  apps: { app_token: string; name: string }[];
  workflow?: Workflow | null;
  onListTables?: (appToken: string) => Promise<{ table_id: string; name: string }[]>;
  onListFields?: (appToken: string, tableId: string) => Promise<Field[]>;
  onSave?: (workflow: Workflow) => Promise<void>;
  targetWorkflowId?: string;
}

function WorkflowCanvasInner({
  apps, workflow, onListTables, onListFields, onSave,
}: Omit<WorkflowCanvasProps, 'targetWorkflowId'>) {
  const {
    nodes, edges, onNodesChange, onEdgesChange, onConnect,
    workflowName, setWorkflowName, workflowStatus,
    selectedNodeId, setSelectedNodeId,
    addNode, deleteNode, duplicateNode, reorderNode, insertNodeAt,
    getWorkflow, initFromScratch, setWorkflow, setApps,
    layoutNodes, workflowId,
    draggingId, dragPreview, beginNodeDrag, updateDragPreview, endNodeDrag,
  } = useWorkflowEditorStore();

  const rf = useReactFlow();
  // 拖拽抓取点相对节点左上角的偏移（flow 坐标），用于让浮动幽灵精确跟随光标
  const grabOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // 浮动幽灵：克隆被拖节点的真实卡片 DOM（完整外观），配合当前缩放比展示
  const [ghost, setGhost] = useState<{ html: string; zoom: number } | null>(null);
  // 插入指示线（屏幕坐标）：拖拽时提示节点会插到哪两个节点之间
  const [dropLine, setDropLine] = useState<{ top: number; left: number; width: number } | null>(null);
  // 是否正在从右侧节点列表拖拽到画板（用于显示插入指示线）
  const [externalDrag, setExternalDrag] = useState(false);
  // 受控视口：外部管理视图位置，节点变化不会导致自动滚动
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const titleSizerRef = useRef<HTMLSpanElement>(null);
  const [titleInputWidth, setTitleInputWidth] = useState(80);

  // 根据插入预览端点计算指示线位置（落在「上方节点出手柄 → 下方节点入手柄」连线中点）。
  // 上方端点优先取链内上方节点，否则取链外入口节点（如触发器）；下方同理（如结束）。
  const computeDropLine = useCallback((info: {
    aboveId: string | null; belowId: string | null;
    entrySourceId: string | null; exitTargetId: string | null;
  } | null): { top: number; left: number; width: number } | null => {
    if (!info || (!info.aboveId && !info.belowId && !info.entrySourceId && !info.exitTargetId)) return null;
    const rectOf = (id: string) =>
      (document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement | null)?.getBoundingClientRect() ?? null;
    const aboveRect = info.aboveId ? rectOf(info.aboveId) : (info.entrySourceId ? rectOf(info.entrySourceId) : null);
    const belowRect = info.belowId ? rectOf(info.belowId) : (info.exitTargetId ? rectOf(info.exitTargetId) : null);
    if (!aboveRect || !belowRect) return null;

    const handleOut = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.bottom });
    const handleIn = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top });
    const a = handleOut(aboveRect), b = handleIn(belowRect);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const w = Math.max(Math.abs(a.x - b.x) + 24, belowRect.width);
    return { top: cy, left: cx - w / 2, width: w };
  }, []);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [saving, setSaving] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // 从 Registry 动态生成 nodeTypes；非核心节点（触发器/结束除外）右上角加删除按钮
  const nodeTypes = useMemo(() => {
    const coreRfTypes = new Set(nodeRegistry.getCoreRfTypes());
    const base = nodeRegistry.getReactFlowNodeTypes();
    const wrapped: Record<string, FC<NodeProps>> = {};
    for (const [rfType, Comp] of Object.entries(base)) {
      wrapped[rfType] = coreRfTypes.has(rfType) ? Comp : withDeleteButton(Comp);
    }
    return wrapped;
  }, []);

  // 从 Registry 动态生成添加菜单项
  const addNodeItems = useMemo(() => {
    return nodeRegistry.getAddableItems().map((p) => ({
      key: p.actionType ? `${p.kind}:${p.actionType}` : p.kind,
      kind: p.kind,
      actionType: p.actionType as CrdAction | undefined,
      label: p.displayName,
      color: p.color,
    }));
  }, []);

  useEffect(() => { setApps(apps); }, [apps, setApps]);

  // 根据标题内容动态计算输入框宽度，上限 240px
  useEffect(() => {
    if (titleSizerRef.current) {
      const textWidth = titleSizerRef.current.scrollWidth;
      setTitleInputWidth(Math.min(Math.max(textWidth + 20, 64), 240));
    }
  }, [workflowName]);

  useEffect(() => {
    if (workflow && workflow.nodes.length > 0) {
      setWorkflow(workflow);
    } else {
      initFromScratch();
      // 新工作流：覆盖 initFromScratch 生成的 ID，保持与路由一致
      if (workflow) {
        useWorkflowEditorStore.setState({
          workflowId: workflow.id,
          workflowName: workflow.name,
          workflowStatus: workflow.status,
        });
      }
    }
    // 初始加载后适配视口（仅在加载时执行一次）
    requestAnimationFrame(() => {
      rf.fitView({ padding: 0.3 });
      // 同步到受控视口状态，后续节点变化不会改变视图
      requestAnimationFrame(() => { setViewport(rf.getViewport()); });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // 仅当拖拽源来自右侧节点列表时显示插入指示线
    if (!e.dataTransfer.types.includes('application/reactflow-type')) return;
    setExternalDrag(true);
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const info = useWorkflowEditorStore.getState().getInsertPreview(p);
    setDropLine(computeDropLine(info));
  }, [rf, computeDropLine]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/reactflow-type');
    const actionType = e.dataTransfer.getData('application/reactflow-action-type');
    if (kind) {
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      insertNodeAt(kind as never, (actionType || undefined) as never, p);
    }
    setExternalDrag(false);
    setDropLine(null);
  }, [insertNodeAt, rf]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: RFNode) => {
    if (node.type !== NODE_TYPES.END) setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const onPaneClick = useCallback(() => setSelectedNodeId(null), [setSelectedNodeId]);

  // 幽灵拖拽开始：记录抓取偏移，并克隆被拖节点真实卡片作为浮动幽灵
  const onNodeDragStart = useCallback((event: MouseEvent | TouchEvent, node: RFNode) => {
    const ce = 'clientX' in event ? event : event.touches[0];
    beginNodeDrag(node.id);
    const p = rf.screenToFlowPosition({ x: ce.clientX, y: ce.clientY });
    grabOffset.current = { x: p.x - node.position.x, y: p.y - node.position.y };

    // 克隆真实节点 DOM，保留完整卡片外观；重置定位相关样式便于独立渲染
    const el = document.querySelector(`.react-flow__node[data-id="${node.id}"]`) as HTMLElement | null;
    if (el) {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.style.transform = 'none';
      clone.style.position = 'static';
      clone.style.pointerEvents = 'none';
      clone.style.margin = '0';
      clone.classList.remove('selected');
      setGhost({ html: clone.outerHTML, zoom: rf.getZoom() });
    }
  }, [beginNodeDrag, rf]);

  // 拖拽中：更新预览坐标（浮动幽灵）+ 计算插入指示线；真实节点与连线保持不动
  const onNodeDrag = useCallback((event: MouseEvent | TouchEvent, node: RFNode) => {
    const ce = 'clientX' in event ? event : event.touches[0];
    const p = rf.screenToFlowPosition({ x: ce.clientX, y: ce.clientY });
    const previewY = p.y - grabOffset.current.y;
    updateDragPreview({ x: p.x - grabOffset.current.x, y: previewY });

    // 根据落点计算会插入到哪个位置，绘制指示横线
    const info = useWorkflowEditorStore.getState().getReorderPreview(node.id, previewY);
    setDropLine(computeDropLine(info));
  }, [updateDragPreview, rf, computeDropLine]);

  // 拖拽结束：按落点预览 y 重排线性片段（被挤占节点下沉），随后清空拖拽态与幽灵
  const onNodeDragStop = useCallback((_event: MouseEvent | TouchEvent, node: RFNode) => {
    const preview = useWorkflowEditorStore.getState().dragPreview;
    reorderNode(node.id, preview?.y);
    setGhost(null);
    setDropLine(null);
    // 延迟清空拖拽态，确保 ReactFlow 的「提交位置」变更被冻结
    Promise.resolve().then(endNodeDrag);
  }, [reorderNode, endNodeDrag]);

  // 拖拽中：真实被拖节点半透明化作为占位，连线仍停留原槽位（不移动）
  const displayNodes = useMemo(() => {
    if (!draggingId) return nodes;
    return nodes.map((n) =>
      n.id === draggingId ? { ...n, style: { ...(n.style || {}), opacity: 0.25 } } : n,
    );
  }, [nodes, draggingId]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setSaving(true);
    try { await onSave(getWorkflow()); } finally { setSaving(false); }
  }, [getWorkflow, onSave]);

  const handleDeleteNode = useCallback(() => {
    if (!selectedNodeId) return;
    deleteNode(selectedNodeId);
  }, [selectedNodeId, deleteNode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId &&
          document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        handleDeleteNode();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        if (selectedNodeId) duplicateNode(selectedNodeId);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeId, handleDeleteNode, duplicateNode, handleSave]);

  return (
    <div className="flex h-full w-full relative" style={{ background: 'var(--bg)' }}>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between h-11 px-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <span ref={titleSizerRef} className="text-sm font-semibold invisible absolute whitespace-nowrap pointer-events-none" aria-hidden="true">
              {workflowName || '工作流名称'}
            </span>
            <input type="text" value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              style={{ width: `${titleInputWidth}px` }}
              className="text-sm font-semibold text-neutral-900 bg-transparent border-none outline-none focus:bg-neutral-50 rounded px-2 py-0.5 flex-shrink"
              placeholder="工作流名称" />
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
              workflowStatus === 'enabled' ? 'bg-emerald-100 text-emerald-700' :
              workflowStatus === 'disabled' ? 'bg-red-100 text-red-700' :
              'bg-neutral-100 text-neutral-500'
            }`}>
              {workflowStatus === 'enabled' ? '已启用' : workflowStatus === 'disabled' ? '已禁用' : '草稿'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative" ref={addMenuRef}>
              <button onClick={() => setShowAddMenu(!showAddMenu)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors">
                <Plus className="w-3.5 h-3.5" />添加节点
              </button>
              {showAddMenu && (
                <div className="absolute top-full right-0 mt-1 w-48 rounded-lg shadow-lg border border-neutral-200 bg-white z-50 py-1">
                  {addNodeItems.map((item) => (
                    <button key={item.key}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/reactflow-type', item.kind);
                        if (item.actionType) e.dataTransfer.setData('application/reactflow-action-type', item.actionType);
                        e.dataTransfer.effectAllowed = 'move';
                        setShowAddMenu(false);
                      }}
                      onClick={() => { addNode(item.kind as never, (item.actionType || undefined) as never); setShowAddMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-50 flex items-center gap-2 cursor-grab ${item.color}`}>
                      <Zap className="w-3 h-3" />{item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedNodeId && (
              <>
                <div className="w-px h-5 bg-neutral-200" />
                <button onClick={() => duplicateNode(selectedNodeId)} className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors" title="复制 (Ctrl+D)">
                  <Copy className="w-3.5 h-3.5 text-neutral-500" /></button>
                <button onClick={handleDeleteNode} className="p-1.5 rounded-md hover:bg-red-50 transition-colors" title="删除 (Delete)">
                  <Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
              </>
            )}

            <div className="w-px h-5 bg-neutral-200" />
            <button
              onClick={() => setShowLogs(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors"
              title="查看运行日志"
            >
              <FileText className="w-3.5 h-3.5" />运行日志
            </button>
            <button
              onClick={() => { layoutNodes(); requestAnimationFrame(() => { rf.fitView({ padding: 0.3 }); requestAnimationFrame(() => { setViewport(rf.getViewport()); }); }); }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors"
              title="自动布局"
            >
              <LayoutGrid className="w-3.5 h-3.5" />布局
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-neutral-800 text-white hover:bg-neutral-900 transition-colors disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative" style={{ background: 'var(--canvas-bg)' }}>
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            viewport={viewport}
            onViewportChange={setViewport}
            minZoom={0.25}
            maxZoom={2}
            defaultEdgeOptions={{
              type: 'default',
              style: { stroke: 'var(--canvas-edge)', strokeWidth: 1.5 },
              markerEnd: { type: 'arrowclosed', width: 12, height: 12, color: 'var(--canvas-edge)' },
            }}
            connectionLineStyle={{ stroke: '#6366f1', strokeWidth: 2 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--canvas-dot)" />
            <Controls className="!rounded-lg !border !border-neutral-200 !shadow-sm" />
            <MiniMap
              className="!rounded-lg !border !border-neutral-200 !shadow-sm"
              nodeColor={(n) => nodeRegistry.getMiniMapColor((n.type as string) || '')}
            />
          </ReactFlow>

          {/* 插入指示线：提示松手后节点会落到的位置（拖拽已有节点 / 从列表拖入均显示） */}
          {(draggingId || externalDrag) && dropLine && (
            <div
              className="fixed z-[59] pointer-events-none"
              style={{ left: dropLine.left, top: dropLine.top, width: dropLine.width }}
            >
              <div className="relative border-t-2 border-blue-500">
                <span className="absolute -left-1 -top-[5px] block w-2 h-2 rounded-full bg-blue-500" />
                <span className="absolute -right-1 -top-[5px] block w-2 h-2 rounded-full bg-blue-500" />
              </div>
            </div>
          )}

          {/* 浮动幽灵：拖拽时跟随光标，展示被拖节点的完整卡片外观 */}
          {draggingId && dragPreview && ghost && (() => {
            const screen = rf.flowToScreenPosition({ x: dragPreview.x, y: dragPreview.y });
            return (
              <div
                className="fixed z-[60] pointer-events-none"
                style={{ left: screen.x, top: screen.y }}
              >
                <div
                  style={{
                    transform: `scale(${ghost.zoom})`,
                    transformOrigin: 'top left',
                    opacity: 0.9,
                    filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.18))',
                  }}
                  dangerouslySetInnerHTML={{ __html: ghost.html }}
                />
              </div>
            );
          })()}
        </div>
      </div>

      {/* 右侧统一面板 */}
      <RightPanel onListTables={onListTables} onListFields={onListFields} />

      {/* 运行日志内嵌弹层 */}
      {showLogs && (
        <div className="absolute inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between h-11 px-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
              <FileText className="w-4 h-4 text-neutral-500" />
              运行日志
            </div>
            <button
              onClick={() => setShowLogs(false)}
              className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors"
              title="关闭"
            >
              <X className="w-4 h-4 text-neutral-500" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ExecutionList workflowId={workflowId} compact />
          </div>
        </div>
      )}
    </div>
  );
}

export default function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
