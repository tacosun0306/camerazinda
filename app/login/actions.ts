'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const loginSchema = z.object({
  email: z.string().email('請輸入有效的電子郵件'),
  password: z.string().min(8, '密碼至少需要 8 個字元'),
});

export async function signIn(formData: FormData) {
  const parsed = loginSchema.safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) redirect('/login?error=invalid');

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    redirect('/login?error=configuration');
  }
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect('/login?error=credentials');
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('active, account_status')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.account_status !== 'active') {
    await supabase.auth.signOut({ scope: 'local' });
    if (profile?.account_status === 'pending_password_setup') redirect('/login?error=first_setup');
    if (profile?.account_status === 'password_reset_pending') redirect('/login?error=password_reset');
    redirect('/login?error=profile');
  }
  const next = formData.get('next');
  if (typeof next === 'string' && next.startsWith('/inventory') && !next.startsWith('//') && !next.includes('\\')) {
    redirect(next);
  }
  redirect('/dashboard');
}