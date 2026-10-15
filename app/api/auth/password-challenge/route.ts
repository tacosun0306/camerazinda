import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const requestSchema = z.object({ flow: z.enum(['invite', 'recovery']) });
const cookieName = 'employee-password-challenge';

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: '請先驗證邀請或重設密碼連結' }, { status: 401 });

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '密碼流程無效' }, { status: 400 });
    const challenge = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(challenge).digest('hex');
    const { data: created, error: createError } = await supabase.rpc('create_employee_password_setup_challenge', {
      p_flow: parsed.data.flow,
      p_token_hash: tokenHash,
    });
    if (createError) throw createError;
    if (!created) return NextResponse.json({ error: '連結已失效、已使用或帳號狀態不符' }, { status: 403 });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(cookieName, challenge, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/account/password',
      maxAge: 15 * 60,
    });
    return response;
  } catch {
    return NextResponse.json({ error: '無法驗證密碼設定連結' }, { status: 500 });
  }
}