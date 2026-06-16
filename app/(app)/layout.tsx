import Sidebar from '@/app/components/Sidebar';
import AuthGuard from '@/app/components/AuthGuard';

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthGuard>
      <div className="flex h-full">
        <Sidebar />
        <main
          className="flex-1 overflow-hidden flex flex-col"
          style={{ marginLeft: 'var(--sidebar-width)' }}
        >
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
