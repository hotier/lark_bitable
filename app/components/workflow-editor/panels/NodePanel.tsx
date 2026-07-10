/**
 * 节点侧边栏 - 按分类分组展示，支持折叠/展开
 *
 * 通过 NodeRegistry 获取按分类分组的可添加节点。
 * 添加新插件后自动出现在对应分类下。
 */

'use client';

import React, { useMemo, useState } from 'react';
import {
  Zap, GitBranch, Shuffle, Play, Bell, Building2,
  ChevronDown, ChevronRight, Search, X,
} from 'lucide-react';
import { nodeRegistry } from '@/lib/workflow-engine/node-registry';
import { NODE_CATEGORIES } from '@/types';

interface NodePanelProps {
  className?: string;
}

/** 分类图标映射 */
const CATEGORY_ICONS: Record<string, typeof Zap> = {
  trigger: Zap,
  flow_control: GitBranch,
  data_transform: Shuffle,
  action: Play,
  notification: Bell,
  lark_ecosystem: Building2,
};

/** 匹配节点：名称 / 描述 / 动作类型 */
function matchNode(item: {
  displayName: string;
  description: string;
  actionType?: string;
}, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  return (
    item.displayName.toLowerCase().includes(query) ||
    item.description.toLowerCase().includes(query) ||
    (item.actionType?.toLowerCase().includes(query) ?? false)
  );
}

export default function NodePanel({ className = '' }: NodePanelProps) {
  const grouped = useMemo(() => nodeRegistry.getAddableItemsByCategory(), []);
  const [search, setSearch] = useState('');
  const isSearching = search.trim().length > 0;

  // 按 order 排序的分类列表
  const sortedCategories = useMemo(() => {
    return [...grouped.keys()].sort((a, b) => {
      const metaA = NODE_CATEGORIES.find((c) => c.id === a);
      const metaB = NODE_CATEGORIES.find((c) => c.id === b);
      return (metaA?.order ?? 99) - (metaB?.order ?? 99);
    });
  }, [grouped]);

  // 搜索结果（按分类过滤后的节点）
  const filtered = useMemo(() => {
    const result = new Map<string, typeof grouped extends Map<string, infer V> ? V : never>();
    for (const [cat, items] of grouped) {
      const matched = items.filter((it) => matchNode(it, search));
      if (matched.length > 0) result.set(cat, matched);
    }
    return result;
  }, [grouped, search]);

  // 默认全部展开；搜索时自动展开所有有结果的分类
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, kind: string, actionType?: string) => {
    e.dataTransfer.setData('application/reactflow-type', kind);
    if (actionType) {
      e.dataTransfer.setData('application/reactflow-action-type', actionType);
    }
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className={`flex flex-col h-full ${className}`}
      style={{ background: 'var(--bg)', borderRight: '1px solid var(--border)' }}
    >
      <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2 dark:text-neutral-400">节点</h3>
        {/* 搜索框 */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索节点…"
            className="w-full pl-7 pr-7 py-1.5 text-xs rounded-md border bg-white outline-none focus:ring-1 focus:ring-blue-400 transition-colors dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500"
            style={{ borderColor: 'var(--border)' }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors dark:hover:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sortedCategories.map((cat) => {
          const items = filtered.get(cat);
          if (!items || items.length === 0) return null;

          const meta = NODE_CATEGORIES.find((c) => c.id === cat);
          const CatIcon = CATEGORY_ICONS[cat] || Zap;
          // 搜索时自动展开，非搜索时按用户折叠状态
          const isCollapsed = isSearching ? false : collapsed.has(cat);

          return (
            <div key={cat}>
              {/* 分类标题 */}
              <button
                onClick={() => toggle(cat)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 transition-colors sticky top-0 dark:text-neutral-500 dark:hover:text-neutral-200 dark:hover:bg-neutral-800"
                style={{ background: 'var(--bg)' }}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 flex-shrink-0" />
                )}
                <CatIcon className="w-3 h-3 flex-shrink-0 opacity-60" />
                <span className="flex-1 text-left">{meta?.label || cat}</span>
                <span className="text-[10px] text-neutral-300 dark:text-neutral-600">{items.length}</span>
              </button>

              {/* 节点列表 */}
              {!isCollapsed && (
                <div className="px-2 pb-1 space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const key = item.actionType ? `${item.kind}:${item.actionType}` : item.kind;
                    return (
                      <div
                        key={key}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.kind, item.actionType)}
                        className={`flex items-center gap-2 p-2 rounded-lg border cursor-grab active:cursor-grabbing transition-all hover:shadow-sm ${item.bg} ${item.border}`}
                      >
                        <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${item.bg}`}>
                          <Icon className={`w-3 h-3 ${item.color}`} />
                        </div>
                        <div className="min-w-0">
                          <div className={`text-[11px] font-medium ${item.color}`}>{item.displayName}</div>
                          <div className="text-[10px] text-neutral-400 truncate leading-tight dark:text-neutral-500">{item.description}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {isSearching && filtered.size === 0 && (
          <div className="px-4 py-8 text-center text-xs text-neutral-400 dark:text-neutral-500">
            未找到匹配「{search}」的节点
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
        <p className="text-[10px] text-neutral-400 leading-relaxed dark:text-neutral-500">
          拖拽节点到画布中，连线定义执行顺序
        </p>
      </div>
    </div>
  );
}
