'use client';

/** 文件列表（云文档 / 在线表格）加载骨架屏：对齐 docs/sheets 实际 7 列表头 + 行布局 */
export function FileListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-xl bg-white border border-neutral-200 overflow-x-auto">
      {/* Header */}
      <div className="flex items-center h-10 px-5 gap-4 text-xs font-medium text-neutral-400 bg-neutral-50 border-b border-neutral-100 min-w-[740px]">
        <span className="flex-1 min-w-0">名称</span>
        <span className="w-[140px]">创建人</span>
        <span className="w-[100px]">位置</span>
        <span className="w-[280px] hidden xl:block">链接</span>
        <span className="w-[130px] text-right">更新时间</span>
        <span className="w-[110px] text-right">创建时间</span>
        <span className="w-[72px]" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center px-5 py-3 gap-4 border-b border-neutral-50 last:border-b-0 min-w-[740px]"
        >
          {/* 名称：图标 + 文件名 */}
          <div className="flex-1 min-w-0 flex items-center gap-2.5">
            <div className="w-4 h-4 rounded bg-neutral-200 animate-pulse" />
            <div
              className="h-4 rounded bg-neutral-200 animate-pulse"
              style={{ width: `${40 + (i * 13) % 40}%` }}
            />
          </div>
          {/* 创建人 */}
          <div className="w-[140px]">
            <div className="h-3 w-16 rounded bg-neutral-200 animate-pulse" />
          </div>
          {/* 位置 */}
          <div className="w-[100px]">
            <div className="h-3 w-10 rounded bg-neutral-200 animate-pulse" />
          </div>
          {/* 链接 (xl only) */}
          <div className="w-[280px] hidden xl:block">
            <div className="h-3 w-48 rounded bg-neutral-200 animate-pulse" />
          </div>
          {/* 更新时间 */}
          <div className="w-[130px] flex justify-end">
            <div className="h-3 w-[72px] rounded bg-neutral-200 animate-pulse" />
          </div>
          {/* 创建时间 */}
          <div className="w-[110px] flex justify-end">
            <div className="h-3 w-[64px] rounded bg-neutral-200 animate-pulse" />
          </div>
          {/* 操作按钮 */}
          <div className="w-[72px] flex justify-end">
            <div className="w-7 h-7 rounded-md bg-neutral-200 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 多维表格：数据表列表加载骨架屏（对齐 AppGrid 实际卡片结构） */
export function TableListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="p-5 rounded-2xl border border-neutral-200 bg-white"
        >
          {/* 顶部：图标 + 来源标签 */}
          <div className="flex items-start justify-between mb-4">
            <div className="w-11 h-11 rounded-xl bg-neutral-200 animate-pulse" />
            <div className="flex items-center gap-1.5">
              <div className="w-3.5 h-3.5 rounded bg-neutral-200 animate-pulse" />
              <div className="h-3 w-10 rounded bg-neutral-200 animate-pulse" />
            </div>
          </div>

          {/* 标题 */}
          <div className="h-5 w-3/4 rounded bg-neutral-200 animate-pulse" />

          {/* URL（约 60% 卡片有） */}
          <div className="flex items-center gap-1.5 mt-2">
            <div className="w-3.5 h-3.5 rounded bg-neutral-200 animate-pulse" />
            <div
              className="h-3 rounded bg-neutral-200 animate-pulse"
              style={{ width: `${40 + (i * 7) % 40}%` }}
            />
          </div>

          {/* 底部：分隔线 + 时间 + 状态 */}
          <div className="flex items-center justify-between pt-4 mt-4 border-t border-neutral-100">
            <div className="flex items-center gap-1.5">
              <div className="w-3.5 h-3.5 rounded bg-neutral-200 animate-pulse" />
              <div className="h-3 w-24 rounded bg-neutral-200 animate-pulse" />
            </div>
            <div className="flex items-center gap-1">
              <div className="h-3 w-10 rounded bg-neutral-200 animate-pulse" />
              <div className="w-3.5 h-3.5 rounded bg-neutral-200 animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 多维表格：数据表行列表加载骨架屏（对齐 TableManager 横向列表行布局） */
export function TableRowSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="h-full overflow-y-auto pr-1">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-neutral-200 animate-pulse" />
          <div className="h-5 w-24 rounded bg-neutral-200 animate-pulse" />
          <div className="h-5 w-6 rounded-full bg-neutral-200 animate-pulse" />
        </div>
      </div>

      {/* 行列表 */}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 p-4 rounded-lg border border-neutral-200 bg-white"
          >
            {/* 图标 */}
            <div className="flex-shrink-0 w-10 h-10 rounded-md bg-neutral-200 animate-pulse" />
            {/* 名称 */}
            <div
              className="flex-1 min-w-0 h-4 rounded bg-neutral-200 animate-pulse"
              style={{ width: `${50 + (i * 11) % 35}%` }}
            />
            {/* 查看按钮 */}
            <div className="flex-shrink-0 w-[60px] h-[32px] rounded-lg bg-neutral-200 animate-pulse" />
            {/* 删除按钮 */}
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-neutral-200 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 多维表格：记录表格加载骨架屏（对齐 RecordManager 表头+表体+翻页布局） */
export function RecordListSkeleton({ cols = 4, rows = 8 }: { cols?: number; rows?: number }) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* 头部操作栏 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-neutral-200 animate-pulse" />
          <div>
            <div className="h-5 w-24 rounded bg-neutral-200 animate-pulse" />
            <div className="h-3 w-16 rounded bg-neutral-200 animate-pulse mt-1.5" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-neutral-200 animate-pulse" />
          <div className="w-8 h-8 rounded-md bg-neutral-200 animate-pulse" />
        </div>
      </div>

      {/* 表格 */}
      <div className="flex-1 min-h-0 flex flex-col rounded-md border border-neutral-200 overflow-auto">
        <div className="min-w-max">
          {/* 表头 */}
          <div className="flex items-center gap-3 px-4 py-3 bg-neutral-100 sticky top-0 z-10">
            <div className="w-8 shrink-0 h-3 rounded bg-neutral-300 animate-pulse" />
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="w-[120px] shrink-0 flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-neutral-300 animate-pulse" />
                <div className="flex-1 h-3 rounded bg-neutral-300 animate-pulse" />
              </div>
            ))}
            <div className="w-20 shrink-0 h-3 rounded bg-neutral-300 animate-pulse ml-auto" />
          </div>

          {/* 表体 */}
          <div className="divide-y divide-neutral-50">
            {Array.from({ length: rows }).map((_, r) => (
              <div
                key={r}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="w-8 shrink-0 h-3 rounded bg-neutral-200 animate-pulse" />
                {Array.from({ length: cols }).map((_, c) => (
                  <div
                    key={c}
                    className="w-[120px] shrink-0 h-3.5 rounded bg-neutral-200 animate-pulse"
                  />
                ))}
                <div className="w-20 shrink-0 flex justify-end">
                  <div className="w-7 h-7 rounded-lg bg-neutral-200 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 翻页控件 */}
      <div className="flex items-center justify-between mt-4 px-1">
        <div className="h-3 w-32 rounded bg-neutral-200 animate-pulse" />
        <div className="flex items-center gap-0.5">
          <div className="w-8 h-8 rounded-md bg-neutral-200 animate-pulse" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-8 h-8 rounded-md bg-neutral-200 animate-pulse" />
          ))}
          <div className="w-8 h-8 rounded-md bg-neutral-200 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
