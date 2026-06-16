'use client';

import { useEffect, useState } from 'react';

/** 通过 API 检查 HttpOnly Cookie 中的 token 是否有效 */
async function checkTokenFromCookie(): Promise<boolean> {
  try {
    const res = await fetch('/api/bitable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'authStatus' }),
    });
    const json = await res.json();
    return json?.data?.authenticated === true;
  } catch {
    return false;
  }
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    checkTokenFromCookie().then((valid) => {
      if (!valid) {
        window.location.replace('/');
      } else {
        setReady(true);
      }
    });
  }, []);

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-50">
        <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
}
