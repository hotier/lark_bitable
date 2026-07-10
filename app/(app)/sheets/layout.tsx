import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '在线表格',
};

export default function SheetsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
