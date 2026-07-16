'use client';

import Link from 'next/link';

// 绘本风 404 — 考拉
export default function NotFoundToggle() {
  return (
    <>
      {/* ==================== 主容器 ==================== */}
      <div style={{
        minHeight: '100vh', width: '100%', backgroundColor: '#faf8f5',
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif',
        fontWeight: 300, position: 'relative', overflow: 'hidden',
      }}>
        {/* 背景光晕层 */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', top: '-10%', left: '-20%',
            width: '60vw', height: '60vw', maxWidth: 700, maxHeight: 700,
            background: 'radial-gradient(ellipse, rgba(251,191,36,0.13), transparent 70%)',
          }} />
          <div style={{
            position: 'absolute', bottom: '-5%', right: '-10%',
            width: '50vw', height: '50vw', maxWidth: 600, maxHeight: 600,
            background: 'radial-gradient(ellipse, rgba(251,191,36,0.08), transparent 70%)',
          }} />
          {/* 点缀圆点 */}
          <div style={{
            position: 'absolute', top: '15%', left: '12%',
            width: 6, height: 6, borderRadius: '50%', backgroundColor: '#fbbf24',
            opacity: 0.35, animation: 'koala-float 4s ease-in-out infinite',
          }} />
          <div style={{
            position: 'absolute', top: '22%', right: '18%',
            width: 4, height: 4, borderRadius: '50%', backgroundColor: '#f59e0b',
            opacity: 0.3, animation: 'koala-float 3.5s ease-in-out 0.8s infinite',
          }} />
        </div>

        <div style={{ position: 'relative', width: '100%', minHeight: '100vh' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: '100vh', padding: '40px 20px',
          }}>
            {/* ==================== 考拉图像 ==================== */}
            <div
              style={{
                width: 'clamp(220px, 38vw, 340px)',
                height: 'clamp(280px, 46vw, 400px)',
                marginBottom: -20,
                filter: 'drop-shadow(0 6px 20px rgba(120,53,15,0.10))',
                animation: 'koala-float 4s ease-in-out infinite',
              }}
              aria-label="睡着的考拉"
              role="img"
            >
              <img
                src="/404-v2/koala-sleeping.svg"
                alt="睡着的考拉"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>

            {/* ==================== 404 文字区域 ==================== */}
            <div style={{
              position: 'relative', zIndex: 99, textAlign: 'center', marginTop: -30,
            }}>
              {/* 数字 */}
              <h1 style={{
                fontSize: 'clamp(90px, 16vw, 190px)',
                fontWeight: 900, lineHeight: 1, margin: 0,
                fontFamily: '"ZCOOL KuaiLe", "Comic Sans MS", cursive, sans-serif',
                color: '#D97706',
                letterSpacing: '-0.02em',
                position: 'relative', display: 'inline-block',
              }}>
                <span style={{ display: 'inline-block', animation: 'koala-float 3.5s ease-in-out infinite' }}>4</span>
                <span style={{ display: 'inline-block', animation: 'koala-float 3.5s ease-in-out 0.18s infinite', color: '#F59E0B' }}>0</span>
                <span style={{ display: 'inline-block', animation: 'koala-float 3.5s ease-in-out 0.36s infinite' }}>4</span>
                {/* 装饰圆点 */}
                <span style={{
                  position: 'absolute', top: 10, right: -20,
                  width: 18, height: 18, borderRadius: '50%', backgroundColor: '#F59E0B',
                  animation: 'koala-dot 2s ease-in-out infinite',
                }} />
              </h1>

              {/* 描述 */}
              <p style={{
                fontSize: 'clamp(14px, 1.8vw, 17px)',
                lineHeight: 1.7, fontWeight: 350,
                color: '#92400E', margin: '28px 0 32px',
                letterSpacing: '0.02em',
                maxWidth: 480,
              }}>
                您访问的页面不存在、已被移除或地址有误。
              </p>

              {/* 按钮组 */}
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link
                  href="/"
                  className="notfound-btn"
                  style={{
                    fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF',
                    background: 'linear-gradient(45deg, #F59E0B, #D97706)',
                    padding: '12px 44px', borderRadius: 9999,
                    textDecoration: 'none', cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
                    letterSpacing: '0.03em',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    boxShadow: 'rgba(217,119,6,0.5) 0px 5px 15px',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #FBBF24, #B45309)';
                    e.currentTarget.style.boxShadow = 'rgba(217,119,6,0.7) 0px 8px 25px, rgba(217,119,6,0.5) 0px 0px 45px';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'linear-gradient(45deg, #F59E0B, #D97706)';
                    e.currentTarget.style.boxShadow = 'rgba(217,119,6,0.5) 0px 5px 15px';
                  }}
                >
                  返回首页
                </Link>


              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== 全局动画 ==================== */}
      <style>{`
        @keyframes koala-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes koala-dot {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.6); opacity: 1; }
        }
        @media (max-width: 640px) {
          .notfound-btn { padding: 12px 32px !important; font-size: 15px !important; }
        }
        @media (max-width: 440px) {
          .notfound-btn { display: block !important; width: 100%; text-align: center; justify-content: center; }
        }
      `}</style>
    </>
  );
}
