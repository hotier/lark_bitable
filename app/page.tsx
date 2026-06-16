'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowRight, Key, Table2, Workflow, FileText, Grid3X3, Sparkles, LogOut, Zap } from 'lucide-react';
import { fetchOAuthUrl, checkAuthStatus, logout as apiLogout } from '@/lib/api';

const DOT_GRID =
  `radial-gradient(circle, #d4a5741a 1px, transparent 1px)`;

/* ───── 服务入口卡片数据 ───── */
const SERVICE_CARDS = [
  {
    href: '/bitable',
    icon: Table2,
    title: '多维表格管理',
    desc: '管理表格、数据表与记录',
    accent: 'amber',
    stat: '多表格 · 全字段 · 记录 CRUD',
  },
  {
    href: '/docs',
    icon: FileText,
    title: '云文档管理',
    desc: '管理飞书云文档',
    accent: 'sky',
    stat: '文档列表 · 创建 · 删除',
  },
  {
    href: '/sheets',
    icon: Grid3X3,
    title: '在线表格管理',
    desc: '管理飞书电子表格',
    accent: 'emerald',
    stat: '表格列表 · 创建 · 删除',
  },
  {
    href: '/flow',
    icon: Workflow,
    title: '机器人指令',
    desc: 'Webhook 自动化工作流',
    accent: 'violet',
    stat: '自定义触发 · CRUD 编排',
  },
] as const;

/* ───── accent class 映射 ───── */
function accentClasses(color: string) {
  const map: Record<string, { bg: string; text: string; border: string; ring: string; bar: string }> = {
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200',   ring: 'ring-amber-500/20',   bar: 'bg-amber-500' },
    sky:     { bg: 'bg-sky-50',     text: 'text-sky-600',     border: 'border-sky-200',     ring: 'ring-sky-500/20',     bar: 'bg-sky-500' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', ring: 'ring-emerald-500/20', bar: 'bg-emerald-500' },
    violet:  { bg: 'bg-violet-50',  text: 'text-violet-600',  border: 'border-violet-200',  ring: 'ring-violet-500/20',  bar: 'bg-violet-500' },
  };
  return map[color] ?? map.amber;
}

/* ═══════════════════════════════════════════════
   内联动画样式
   ═══════════════════════════════════════════════ */
const ANIM_STYLES = `
  @keyframes shimmer {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
  .animate-shimmer {
    animation: shimmer 4s ease-in-out infinite;
    background-size: 200% 200%;
  }

  @keyframes glow-pulse {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.15); }
  }
  .animate-glow-pulse {
    animation: glow-pulse 3s ease-in-out infinite;
  }

  @keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-10px); }
  }
  .animate-float {
    animation: float 5s ease-in-out infinite;
  }

  @keyframes glow-line {
    0%, 100% { background-position: -200% 0; }
    50% { background-position: 200% 0; }
  }
  .animate-glow-line {
    background: linear-gradient(90deg, transparent, #f59e0b, transparent);
    background-size: 200% 100%;
    animation: glow-line 3s ease-in-out infinite;
  }

  @keyframes spin-slower {
    to { transform: rotate(360deg); }
  }
  .animate-spin-slower {
    animation: spin-slower 4s linear infinite;
  }
`;

export default function RootPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [oauthUrl, setOauthUrl] = useState('');
  const [checking, setChecking] = useState(true);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const init = async () => {
      // Token 已在 OAuth 回调时直接写入 HttpOnly Cookie，此处只需检查
      const authed = await checkAuthStatus();
      if (authed) setIsAuthenticated(true);

      fetchOAuthUrl().then(setOauthUrl).catch(console.error);
      setChecking(false);
      setTimeout(() => setRevealed(true), 60);
    };
    init();
  }, []);

  const handleLogout = useCallback(async () => {
    await apiLogout();
    setIsAuthenticated(false);
    setRevealed(false);
    setTimeout(() => setRevealed(true), 60);
  }, []);

  /* ───── Loading ───── */
  if (checking) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-6" style={{ background: '#faf8f5' }}>
        <style>{ANIM_STYLES}</style>
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="absolute -inset-2 rounded-2xl border-2 border-amber-200 border-dashed animate-spin-slower" />
        </div>
        <span className="text-xs font-medium text-neutral-400 tracking-widest uppercase">Flybook Workspace</span>
      </div>
    );
  }

  /* ═════════════════════════════════════════
     =======  统 一 布 局  =======
     ═════════════════════════════════════════ */
  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: '#faf8f5' }}>
      <style>{ANIM_STYLES}</style>

      {/* ── 背景 ── */}
      <div className="absolute inset-0 pointer-events-none opacity-30" style={{ backgroundImage: DOT_GRID, backgroundSize: '24px 24px' }} />
      <div className="absolute top-1/4 right-[10%] w-72 h-72 rounded-full blur-[100px] opacity-[0.12] animate-glow-pulse"
        style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' }} />
      <div className="absolute bottom-1/4 left-[5%] w-80 h-80 rounded-full blur-[120px] opacity-[0.08] animate-glow-pulse"
        style={{ background: 'radial-gradient(circle, #d97706 0%, transparent 70%)', animationDelay: '1.5s' }} />
      <div className="absolute top-[60%] right-[25%] w-48 h-48 rounded-full blur-[80px] opacity-[0.1] animate-float"
        style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)', animationDelay: '2.5s' }} />
      <div className="absolute top-[20%] left-[20%] w-40 h-40 rounded-full blur-[60px] opacity-[0.08] animate-float"
        style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)', animationDelay: '1s' }} />

      {/* 飘浮颗粒 */}
      <div className="absolute top-[30%] left-[15%] w-1.5 h-1.5 rounded-full bg-amber-400/60 animate-float"
        style={{ animationDelay: '0s', animationDuration: '6s' }} />
      <div className="absolute top-[55%] right-[20%] w-2 h-2 rounded-full bg-sky-400/40 animate-float"
        style={{ animationDelay: '1.2s', animationDuration: '7s' }} />
      <div className="absolute top-[25%] right-[30%] w-1 h-1 rounded-full bg-violet-400/50 animate-float"
        style={{ animationDelay: '2.4s', animationDuration: '5.5s' }} />
      <div className="absolute bottom-[30%] left-[30%] w-1.5 h-1.5 rounded-full bg-emerald-400/40 animate-float"
        style={{ animationDelay: '3s', animationDuration: '6.5s' }} />

      {/* ═══════════ Header（仅已登录） ═══════════ */}
      {isAuthenticated && (
        <header className="relative z-40 backdrop-blur-xl border-b border-neutral-200/60" style={{ background: 'rgba(250,248,245,0.85)' }}>
          <div className="px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/25">
                <Sparkles className="size-[18px]" />
              </div>
              <div>
                <span className="text-sm font-bold text-neutral-900 tracking-tight">飞书工作台</span>
                <span className="ml-2 text-[10px] text-neutral-300 tracking-wider">WORKSPACE</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50/80 border border-emerald-200/50">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-xs font-semibold text-emerald-700">已连接飞书</span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200"
              >
                <LogOut className="w-3 h-3" />
                退出登录
              </button>
            </div>
          </div>
        </header>
      )}

      {/* ═══════════ 主体 ═══════════ */}
      <main className="relative flex-1 flex items-center justify-center px-6 py-16">
        <div className={`w-full max-w-4xl text-center transition-all duration-700 ${revealed ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>

          {/* Badge */}
          <div className="mb-8" style={{ transitionDelay: '0ms' }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium bg-white/70 backdrop-blur border border-neutral-200/60 shadow-sm">
              <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isAuthenticated ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <Zap className={`w-3 h-3 ${isAuthenticated ? 'text-emerald-500' : 'text-amber-500'}`} />
              <span className="text-neutral-500">飞书开放平台</span>
              <span className="text-neutral-300">·</span>
              <span className="text-neutral-500">OAuth 2.0</span>
              <span className="text-neutral-300">·</span>
              <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent font-semibold">
                {isAuthenticated ? '已鉴权' : '安全鉴权'}
              </span>
            </div>
          </div>

          {/* Hero */}
          <div className="mb-10" style={{ transitionDelay: '80ms' }}>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-neutral-900 leading-[1.08]">
              <span className="inline-block animate-shimmer bg-gradient-to-r from-neutral-800 via-amber-500 to-neutral-800 bg-clip-text text-transparent">
                飞书 · 统一工作台
              </span>
            </h1>
            <div className="mx-auto mt-5 h-0.5 w-40 rounded-full animate-glow-line" />
            <p className="mt-7 text-base sm:text-lg text-neutral-500 max-w-xl mx-auto leading-relaxed">
              多维表格<span className="text-amber-500 font-semibold"> · </span>
              云文档<span className="text-sky-500 font-semibold"> · </span>
              电子表格<span className="text-emerald-500 font-semibold"> · </span>
              自动化工作流
            </p>
            <p className="mt-3 text-sm text-neutral-400 max-w-lg mx-auto">
              通过飞书标准 OAuth 协议接入，一站式管理你的全部飞书资源
            </p>
          </div>

          {/* ═══════════ CTA 登录按钮（仅未登录） ═══════════ */}
          {!isAuthenticated && (
            <div className="mb-14" style={{ transitionDelay: '160ms' }}>
              {oauthUrl ? (
                <a
                  href={oauthUrl}
                  className="group relative inline-flex items-center gap-3 px-10 py-4 rounded-2xl text-base font-bold text-white shadow-2xl shadow-amber-500/25 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_20px_60px_-12px_rgba(245,158,11,0.35)] active:translate-y-0 overflow-hidden"
                  style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 50%, #f59e0b 100%)', backgroundSize: '200% 200%' }}
                >
                  <div className="absolute inset-0 rounded-2xl animate-shimmer opacity-30"
                    style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)', backgroundSize: '200% 100%' }} />
                  <Key className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">飞书授权登录</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform relative z-10" />
                </a>
              ) : (
                <div className="w-52 h-14 rounded-2xl mx-auto bg-neutral-200/60 animate-pulse" />
              )}
            </div>
          )}

          {/* ═══════════ 服务入口卡片 ═══════════ */}
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left ${isAuthenticated ? 'mb-0' : 'mb-8'}`}>
            {SERVICE_CARDS.map((card, i) => {
              const a = accentClasses(card.accent);
              const baseClass =
                'group relative flex flex-col p-6 rounded-2xl bg-white/80 backdrop-blur border border-neutral-200/70 shadow-sm transition-all duration-300';
              const hoverClass = isAuthenticated
                ? `hover:-translate-y-1 hover:shadow-xl ${a.ring}`
                : 'hover:shadow-lg';

              const inner = (
                <>
                  {/* 顶部色条 */}
                  <div className={`absolute top-0 left-4 right-4 h-0.5 rounded-full ${a.bar} scale-x-[0.8] group-hover:scale-x-100 transition-transform duration-[400ms]`} />

                  {/* 图标 */}
                  <div className={`w-11 h-11 rounded-xl ${a.bg} ${a.text} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                    <card.icon className="size-[22px]" />
                  </div>

                  {/* 标题 */}
                  <h2 className="text-sm font-bold text-neutral-900 mb-1">{card.title}</h2>
                  <p className="text-xs text-neutral-500 leading-relaxed mb-3">{card.desc}</p>

                  {/* 统计信息 */}
                  <div className="mt-auto pt-3 border-t border-neutral-100">
                    <span className="text-[11px] text-neutral-400">{card.stat}</span>
                  </div>

                  {/* 进入箭头（仅已登录） */}
                  {isAuthenticated && (
                    <div className={`absolute right-5 bottom-5 w-8 h-8 rounded-lg ${a.bg} ${a.text} flex items-center justify-center opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all duration-300`}>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  )}
                </>
              );

              if (isAuthenticated) {
                return (
                  <Link
                    key={card.href}
                    href={card.href}
                    className={`${baseClass} ${hoverClass}`}
                    style={{ transitionDelay: `${200 + i * 100}ms` }}
                  >
                    {inner}
                  </Link>
                );
              }

              return (
                <div
                  key={card.title}
                  className={`${baseClass} ${hoverClass}`}
                  style={{ transitionDelay: `${200 + i * 100}ms` }}
                >
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* ═══════════ Footer ═══════════ */}
      <footer className="relative py-5 text-center">
        <span className="text-xs text-neutral-300 tracking-widest uppercase">lark workspace</span>
      </footer>
    </div>
  );
}
