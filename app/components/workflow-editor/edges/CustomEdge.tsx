'use client';

import React, { useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  type EdgeProps,
  useReactFlow,
} from '@xyflow/react';

/**
 * 自定义边组件
 * - 直线连线，选中时高亮为 indigo
 * - hover 时显示删除按钮
 */
export default function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const { setEdges } = useReactFlow();

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEdges((eds) => eds.filter((ed) => ed.id !== id));
    },
    [id, setEdges],
  );

  const strokeColor = selected ? '#6366f1' : (style.stroke as string) || '#b0b7c3';
  const strokeWidth = selected ? 2.5 : 1.5;

  return (
    <>
      {/* 不可见的宽点击区域 */}
      <BaseEdge
        path={edgePath}
        style={{ stroke: 'transparent', strokeWidth: 20, cursor: 'pointer' }}
      />
      {/* 可见的线条 */}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth,
          transition: 'stroke 0.15s, stroke-width 0.15s',
          cursor: 'pointer',
        }}
      />

      {/* 选中时显示删除按钮 */}
      {selected && (
        <EdgeLabelRenderer>
          <button
            onClick={handleDelete}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] hover:bg-red-600 shadow-sm transition-colors nodrag nopan"
            title="删除连线"
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
