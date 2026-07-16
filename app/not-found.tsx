import { Metadata } from 'next';
import NotFoundRandom from '@/app/components/NotFoundRandom';

export const metadata: Metadata = {
  title: '404 找不到啦~',
};

/** Next.js 全局 404 页面 — 随机展示两个版本之一 */
export default function NotFoundPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Raleway:wght@300;400;500;600;700;800;900&display=swap"
        rel="stylesheet"
      />
      <NotFoundRandom />
    </>
  );
}
