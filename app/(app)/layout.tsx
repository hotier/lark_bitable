import Sidebar from '@/app/components/Sidebar';
import AuthGuard from '@/app/components/AuthGuard';
import { NavigationGuardProvider } from '@/app/components/NavigationGuard';

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthGuard>
      <NavigationGuardProvider>
        <div className="flex h-full">
          <Sidebar />
          <main
            className="flex-1 min-w-0 overflow-hidden flex flex-col"
            style={{ marginLeft: 'var(--sidebar-width)' }}
          >
            {children}
          </main>
        </div>
      </NavigationGuardProvider>
    </AuthGuard>
  );
}
