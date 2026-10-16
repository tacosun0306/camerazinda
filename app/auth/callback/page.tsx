'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function AuthCallbackPage() {
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function confirmLink() {
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const flowValue = query.get('flow') ?? query.get('type') ?? hash.get('type');
      const flow = flowValue === 'invite' || flowValue === 'recovery' ? flowValue : null;
      if (!flow) {
        setError('連結格式無效，請聯絡管理員重新寄送。');
        return;
      }
      if (query.has('error') || query.has('error_description') || hash.has('error') || hash.has('error_description')) {
        setError('此設定連結已失效或逾期，請聯絡管理員重新寄送。');
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const tokenHash = query.get('token_hash');
      const code = query.get('code');
      if (tokenHash) {
        const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: flow });
        if (verifyError) {
          setError('連結已失效或使用過，請聯絡管理員重新寄送。');
          return;
        }
      } else if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError('連結已失效或使用過，請聯絡管理員重新寄送。');
          return;
        }
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        setError('無法驗證帳號，請使用最新的郵件連結。');
        return;
      }
      const response = await fetch('/api/auth/password-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setError(result.error ?? '連結已失效或帳號狀態不符。');
        return;
      }
      if (!cancelled) window.location.replace('/account/password');
    }
    void confirmLink();
    return () => { cancelled = true; };
  }, []);

  return <main className="grid min-h-screen place-items-center bg-[#f3f5f0] px-6">
    <section className="w-full max-w-md space-y-4 text-center">
      <p className="eyebrow">ACCOUNT SECURITY</p>
      <h1 className="font-display text-2xl">驗證帳號連結</h1>
      {error ? <><p role="alert" className="text-sm text-[#a84834]">{error}</p><Link className="text-sm font-semibold text-fern underline" href="/login">返回登入</Link></> : <p className="text-sm text-[#78827c]">正在驗證一次性連結…</p>}
    </section>
  </main>;
}