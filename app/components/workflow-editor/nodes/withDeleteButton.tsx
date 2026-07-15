'use client';

import React from 'react';
import { X } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import { useWorkflowEditorStore } from '@/lib/workflow-engine/editor-store';

/**
 * 包裹非核心节点组件，在右上角追加一个删除按钮。
 * 触发器 / 结束节点不包裹（核心节点不可删除）。
 * 按钮通过 store.deleteNode 删除，deleteNode 内部已对核心节点做保护。
 */
export function withDeleteButton(Component: React.FC<NodeProps>): React.FC<NodeProps> {
  return function DeletableNode(props: NodeProps) {
    const deleteNode = useWorkflowEditorStore((s) => s.deleteNode);

    return (
      <div className="group relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            deleteNode(props.id);
          }}
          // 阻止冒泡到节点，避免触发选中 / 拖拽
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded opacity-0 transition-colors hover:bg-red-50 group-hover:opacity-100"
          title="删除节点"
        >
          <X className="h-3.5 w-3.5 text-neutral-400 hover:text-red-500" />
        </button>
        <Component {...props} />
      </div>
    );
  };
}
