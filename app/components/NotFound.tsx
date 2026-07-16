'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useRef, useEffect } from 'react';

interface NotFoundProps {
  title?: string;
  message?: string;
  showHome?: boolean;
  showBack?: boolean;
  children?: React.ReactNode;
  background?: string;
}

const DEFAULT_TITLE = '哎呀，小怪兽迷路啦~ 找不到你要的页面呢！';

export default function NotFound({
  title,
  message,
  showHome = true,
  showBack = false,
  children,
  background = 'linear-gradient(135deg, #c7e0ff, #8abfff)',
}: NotFoundProps) {
  const router = useRouter();
  const monsterRef = useRef<HTMLDivElement>(null);
  const leftPupilRef = useRef<SVGCircleElement>(null);
  const rightPupilRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const maxOffset = 4;
    function onMove(e: MouseEvent) {
      if (!monsterRef.current) return;
      const rect = monsterRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = Math.min(maxOffset, Math.max(-maxOffset, e.clientX - centerX));
      const dy = Math.min(maxOffset, Math.max(-maxOffset, e.clientY - centerY));
      [leftPupilRef.current, rightPupilRef.current].forEach((p) => {
        if (p) p.style.transform = `translate(${dx}px, ${dy}px)`;
      });
    }
    function onLeave() {
      [leftPupilRef.current, rightPupilRef.current].forEach((p) => {
        if (p) p.style.transform = 'translate(0, 0)';
      });
    }
    window.addEventListener('mousemove', onMove);
    monsterRef.current?.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      monsterRef.current?.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const displayMessage = title || DEFAULT_TITLE;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden select-none"
      style={{ background }}
    >
      {/* 背景光晕 */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-40%',
          left: '-30%',
          width: '160vw',
          height: '160vh',
          background: 'radial-gradient(circle, #d1e3ff, #5c94ff 80%)',
          filter: 'blur(180px)',
          opacity: 0.8,
          animation: 'glowPulse 6s ease-in-out infinite',
          zIndex: 0,
        }}
      />

      {/* 小怪兽 */}
      <div
        ref={monsterRef}
        className="relative z-10 w-[220px] h-[220px] sm:w-[320px] sm:h-[320px]"
        style={{ animation: 'floatSway 5s ease-in-out infinite' }}
        aria-label="Cute monster illustration"
        role="img"
      >
        <svg
          viewBox="0 0 128 128"
          className="w-full h-full"
          style={{
            overflow: 'visible',
            filter: 'drop-shadow(rgba(0, 70, 200, 0.3) 0px 6px 6px)',
          }}
        >
          <defs>
            <radialGradient
              id="faceGradient"
              cx="64"
              cy="80"
              r="54"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#9ab3ff" />
              <stop offset="100%" stopColor="#416cff" />
            </radialGradient>
          </defs>
          {/* 身体 */}
          <ellipse cx="64" cy="80" rx="54" ry="44" fill="#6e91ff" />
          <ellipse
            cx="64"
            cy="80"
            rx="54"
            ry="44"
            fill="url(#faceGradient)"
            opacity="0.6"
          />
          {/* 左角 */}
          <g
            style={{
              transformOrigin: 'center bottom',
              animation: 'hornSwing 6s ease-in-out infinite',
            }}
          >
            <path
              fill="#b7beff"
              stroke="#527bff"
              strokeWidth="2"
              d="M30 10 Q25 50 45 35 Q25 44 30 10z"
            />
          </g>
          {/* 右角 */}
          <g
            style={{
              transformOrigin: 'center bottom',
              animation: 'hornSwing 6s ease-in-out infinite',
              animationDelay: '3s',
            }}
          >
            <path
              fill="#b7beff"
              stroke="#527bff"
              strokeWidth="2"
              d="M98 10 Q103 50 83 35 Q103 44 98 10z"
            />
          </g>
          {/* 底部圆润高光 */}
          <ellipse
            cx="64"
            cy="120"
            rx="35"
            ry="9"
            fill="white"
            opacity="0.12"
          />
          {/* 左眼白 */}
          <ellipse
            cx="42"
            cy="58"
            rx="18"
            ry="16"
            fill="#fff"
            style={{
              transformOrigin: 'center center',
              animation: 'blink 5s ease infinite',
            }}
          />
          {/* 左瞳孔 */}
          <circle
            ref={leftPupilRef}
            cx="42"
            cy="58"
            r="8"
            fill="#527bff"
            style={{ transition: 'transform 0.2s ease' }}
          />
          {/* 右眼白 */}
          <ellipse
            cx="86"
            cy="58"
            rx="18"
            ry="16"
            fill="#fff"
            style={{
              transformOrigin: 'center center',
              animation: 'blink 5s ease infinite',
              animationDelay: '2.5s',
            }}
          />
          {/* 右瞳孔 */}
          <circle
            ref={rightPupilRef}
            cx="86"
            cy="58"
            r="8"
            fill="#527bff"
            style={{ transition: 'transform 0.2s ease' }}
          />
          {/* 鼻子 */}
          <ellipse
            cx="64"
            cy="75"
            rx="7"
            ry="5"
            fill="#2a62ff"
            style={{ animation: 'noseMove 3s ease-in-out infinite' }}
          />
          <ellipse
            cx="64"
            cy="75"
            rx="3"
            ry="2"
            fill="#557bff"
            style={{ animation: 'noseMove 3s ease-in-out infinite' }}
          />
          {/* 嘴巴 */}
          <path
            d="M45 95 Q64 110 83 95 Q80 100 64 105 Q48 100 45 95"
            fill="#395eff"
            stroke="#2a62ff"
            strokeWidth="2"
            style={{ animation: 'mouthMove 4s ease-in-out infinite' }}
          />
          <path
            d="M55 99 Q64 105 73 99"
            fill="#6b8aff"
            style={{ animation: 'mouthMove 4s ease-in-out infinite' }}
          />
          {/* 萌脸红晕 */}
          <circle cx="32" cy="85" r="8" fill="#86a4ff" opacity="0.5" />
          <circle cx="96" cy="85" r="8" fill="#86a4ff" opacity="0.5" />
        </svg>
      </div>

      {/* 404 大字 */}
      <h1
        className="relative z-10 font-black text-white text-center"
        style={{
          fontSize: 'clamp(5rem, 10vw, 8rem)',
          letterSpacing: '0.15em',
          margin: '0.4em 0 0.1em',
          textShadow:
            '0 0 10px #9cc2ff, 0 0 20px #6b8aff, 0 0 30px #5472ff, 0 0 40px #3e5eff',
        }}
      >
        404
      </h1>

      {/* 描述文字 */}
      <p
        className="relative z-10 text-center font-semibold text-white"
        style={{
          fontSize: 'clamp(1.3rem, 2.5vw, 1.7rem)',
          margin: '0 0 2.5em',
          textShadow: 'rgba(50,85,255,0.5) 0px 1px 5px',
        }}
      >
        {displayMessage}
      </p>

      {/* 二级描述（可选） */}
      {message && (
        <p
          className="relative z-10 text-center text-white/80"
          style={{
            fontSize: '1rem',
            margin: '-2em 0 2.5em',
            maxWidth: 400,
          }}
        >
          {message}
        </p>
      )}

      {/* 操作按钮 */}
      {(showHome || showBack || children) && (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-3">
          {showBack && (
            <button
              onClick={() => router.back()}
              className="inline-flex items-center px-8 py-3 rounded-full font-bold text-white transition-all duration-300 cursor-pointer"
              style={{
                background: 'linear-gradient(45deg, #5472ff, #6b8aff)',
                fontSize: '1.1rem',
                boxShadow: 'rgba(83,123,255,0.7) 0px 5px 15px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  'linear-gradient(135deg, #88a5ff, #527bff)';
                e.currentTarget.style.boxShadow =
                  'rgba(122,159,255,0.9) 0px 8px 25px, rgba(122,159,255,0.7) 0px 0px 45px';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  'linear-gradient(45deg, #5472ff, #6b8aff)';
                e.currentTarget.style.boxShadow =
                  'rgba(83,123,255,0.7) 0px 5px 15px';
              }}
            >
              返回上一页
            </button>
          )}
          {showHome && (
            <Link
              href="/"
              className="inline-flex items-center px-8 py-3 rounded-full font-bold text-white transition-all duration-300"
              style={{
                background: 'linear-gradient(45deg, #5472ff, #6b8aff)',
                fontSize: '1.1rem',
                boxShadow: 'rgba(83,123,255,0.7) 0px 5px 15px',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  'linear-gradient(135deg, #88a5ff, #527bff)';
                e.currentTarget.style.boxShadow =
                  'rgba(122,159,255,0.9) 0px 8px 25px, rgba(122,159,255,0.7) 0px 0px 45px';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  'linear-gradient(45deg, #5472ff, #6b8aff)';
                e.currentTarget.style.boxShadow =
                  'rgba(83,123,255,0.7) 0px 5px 15px';
              }}
            >
              返回首页
            </Link>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
