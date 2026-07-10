'use client';

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type Node as RFNode,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Save, Plus, Trash2, Copy, Zap,
  Loader2, LayoutGrid, ScrollText, X,
} from 'lucide-react';

import ExecutionList from '@/app/components/executions/ExecutionList';

import { useWorkflowEditorStore, NODE_TYPES } from '@/lib/workflow-engine/editor-store';
import { nodeRegistry } from '@/lib/workflow-engine/node-registry';
import RightPanel from './panels/RightPanel';
import CustomEdge from './edges/CustomEdge';
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
    addNode, deleteNode, duplicateNode,
    getWorkflow, initFromScratch, setWorkflow, setApps,
    layoutNodes, workflowId,
  } = useWorkflowEditorStore();

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [saving, setSaving] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // 从 Registry 动态生成 nodeTypes
  const nodeTypes = useMemo(() => nodeRegistry.getReactFlowNodeTypes(), []);

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
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/reactflow-type');
    const actionType = e.dataTransfer.getData('application/reactflow-action-type');
    if (kind) addNode(kind as never, (actionType || undefined) as never);
  }, [addNode]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: RFNode) => {
    if (node.type !== NODE_TYPES.END) setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const onPaneClick = useCallback(() => setSelectedNodeId(null), [setSelectedNodeId]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setSaving(true);
    try { await onSave(getWorkflow()); } finally { setSaving(false); }
  }, [getWorkflow, onSave]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId &&
          document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        deleteNode(selectedNodeId);
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
  }, [selectedNodeId, deleteNode, duplicateNode, handleSave]);

  return (
    <div className="flex h-full w-full relative" style={{ background: 'var(--bg)' }}>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between h-11 px-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <input type="text" value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className="text-sm font-semibold text-neutral-900 bg-transparent border-none outline-none focus:bg-neutral-50 rounded px-2 py-0.5 min-w-[120px]"
              placeholder="工作流名称" />
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
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
                      onClick={() => { addNode(item.kind as never, (item.actionType || undefined) as never); setShowAddMenu(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-50 flex items-center gap-2 ${item.color}`}>
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
                <button onClick={() => deleteNode(selectedNodeId)} className="p-1.5 rounded-md hover:bg-red-50 transition-colors" title="删除 (Delete)">
                  <Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
              </>
            )}

            <div className="w-px h-5 bg-neutral-200" />
            <button
              onClick={() => setShowLogs(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors"
              title="查看运行日志"
            >
              <ScrollText className="w-3.5 h-3.5" />运行日志
            </button>
            <button
              onClick={layoutNodes}
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
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
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
        </div>
      </div>

      {/* 右侧统一面板 */}
      <RightPanel onListTables={onListTables} onListFields={onListFields} />

      {/* 运行日志内嵌弹层 */}
      {showLogs && (
        <div className="absolute inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between h-11 px-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
              <ScrollText className="w-4 h-4 text-neutral-500" />
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
