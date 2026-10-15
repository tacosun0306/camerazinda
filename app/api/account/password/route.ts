import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeEmployeeAudit } from '@/lib/server/employee-management';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const passwordSchema = z.object({
  password: z.string().min(12).max(128)
    .regex(/[a-z]/, '密碼需包含小寫英文字母')
    .regex(/[A-Z]/, '密碼需包含大寫英文字母')
    .regex(/[0-9]/, '密碼需包含數字')
    .regex(/[^A-Za-z0-9]/, '密碼需包含符號'),
  confirmation: z.string(),
}).refine((value) => value.password === value.confirmation, {
  message: '兩次輸入的密碼不一致',
  path: ['confirmation'],
});

const cookieName = 'employee-password-challenge';

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: '驗證已逾期，請重新開啟郵件中的連結' }, { status: 401 });

    const parsed = passwordSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '密碼格式不符合要求' }, { status: 400 });
    const challenge = request.headers.get('cookie')
      ?.split('; ')
      .find((entry) => entry.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!challenge) return NextResponse.json({ error: '密碼設定連結已失效，請重新申請' }, { status: 403 });

    const tokenHash = createHash('sha256').update(decodeURIComponent(challenge)).digest('hex');
    const { data: flow, error: consumeError } = await supabase.rpc('consume_employee_password_setup_challenge', {
      p_token_hash: tokenHash,
    });
    if (consumeError) throw consumeError;
    if (flow !== 'invite' && flow !== 'recovery') {
      return NextResponse.json({ error: '連結已使用或逾期，請重新申請' }, { status: 403 });
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (passwordError) return NextResponse.json({ error: '密碼更新失敗，請重新申請設定連結' }, { status: 400 });

    const admin = createSupabaseAdminClient();
    const { data: profile, error: profileError } = await admin.from('profiles')
      .update({ active: true, account_status: 'active' })
      .eq('id', user.id)
      .eq('active', false)
      .select('id')
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return NextResponse.json({ error: '帳號狀態已變更，請聯絡管理員' }, { status: 409 });

    await writeEmployeeAudit(admin, user.id, 'employee_password_setup_completed', user.id, { flow });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(cookieName, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/account/password', maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ error: '無法完成密碼設定，請重新申請連結' }, { status: 500 });
  }
}