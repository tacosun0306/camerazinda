'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('兩次輸入的密碼不一致');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, confirmation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '密碼設定失敗');
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut({ scope: 'local' });
      router.replace('/login?error=password_updated');
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '密碼設定失敗，請重試');
    } finally {
      setSaving(false);
    }
  }

  return <main className="grid min-h-screen place-items-center bg-[#f3f5f0] px-6 py-12">
    <section className="w-full max-w-md rounded-lg border border-[#dfe5de] bg-white p-6 shadow-sm">
      <p className="eyebrow">ACCOUNT SECURITY</p>
      <h1 className="mt-2 font-display text-2xl">設定新密碼</h1>
      <p className="mt-2 text-sm leading-6 text-[#78827c]">密碼需至少 12 個字元，並包含大小寫英文字母、數字及符號。設定完成後請使用新密碼重新登入。</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-xs font-semibold">新密碼<input required autoComplete="new-password" type="password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 h-11 w-full rounded-md border-[#dfe5de]" /></label>
        <label className="block text-xs font-semibold">再次輸入新密碼<input required autoComplete="new-password" type="password" minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1.5 h-11 w-full rounded-md border-[#dfe5de]" /></label>
        {error && <p role="alert" className="rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-3 py-2 text-xs text-[#a84834]">{error}</p>}
        <button disabled={saving} className="h-11 w-full rounded-md bg-ink text-sm font-semibold text-white disabled:opacity-60">{saving ? '儲存中…' : '設定密碼'}</button>
      </form>
    </section>
  </main>;
}
