import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { authorizeEmployeeAdmin, passwordFlowRedirect, reserveEmployeeAuthEmailRequest, writeEmployeeAudit } from '@/lib/server/employee-management';

const actionSchema = z.object({ action: z.enum(['disable', 'enable', 'reset_password', 'resend_invite']) });
type RouteContext = { params: Promise<{ userId: string }> };
type EmployeeAdminAuthorization = NonNullable<Awaited<ReturnType<typeof authorizeEmployeeAdmin>>>;

async function requestPasswordReset(
  admin: EmployeeAdminAuthorization,
  userId: string,
  email: string,
  origin: string,
  actorId: string,
  auditAction: string,
) {
  const temporaryPassword = randomBytes(48).toString('base64url');
  const { error: authError } = await admin.admin.auth.admin.updateUserById(userId, {
    password: temporaryPassword,
    ban_duration: 'none',
  });
  if (authError) throw authError;

  const supabase = await createSupabaseServerClient();
  const { error: emailError } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: passwordFlowRedirect(origin, 'recovery'),
  });
  if (emailError) throw emailError;

  await writeEmployeeAudit(admin.admin, actorId, auditAction, userId, {
    email,
    result: 'recovery_email_sent',
    password_exposed: false,
  });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeEmployeeAdmin();
    if (!authorization) return NextResponse.json({ error: '只有啟用中的管理員可以管理帳號狀態' }, { status: 403 });
    const { userId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '不支援的帳號操作' }, { status: 400 });
    if (parsed.data.action === 'disable' && userId === authorization.actorId) {
      return NextResponse.json({ error: '請由另一位管理員停用你的帳號' }, { status: 409 });
    }

    const { data: profile, error: profileError } = await authorization.admin
      .from('profiles')
      .select('id, email, role, active, account_status')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return NextResponse.json({ error: '找不到此使用者' }, { status: 404 });

    const { action } = parsed.data;
    if (action === 'disable') {
      if (profile.role === 'admin' && profile.active && profile.account_status === 'active') {
        const { count, error: countError } = await authorization.admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('active', true)
          .eq('account_status', 'active');
        if (countError) throw countError;
        if ((count ?? 0) <= 1) return NextResponse.json({ error: '不可停用最後一位啟用中的管理員' }, { status: 409 });
      }

      const { error: updateError } = await authorization.admin.from('profiles')
        .update({ active: false, account_status: 'disabled' })
        .eq('id', userId);
      if (updateError) throw updateError;
      const { error: banError } = await authorization.admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
      if (banError) {
        await writeEmployeeAudit(authorization.admin, authorization.actorId, 'employee_deactivation_auth_ban_failed', userId, { email: profile.email });
        return NextResponse.json({ error: '帳號已由系統停用，但 Supabase Auth 封鎖未完成，請立即重試' }, { status: 502 });
      }
      await writeEmployeeAudit(authorization.admin, authorization.actorId, 'employee_deactivated', userId, { email: profile.email });
      return NextResponse.json({ ok: true, account_status: 'disabled' });
    }

    if (action === 'reset_password' && profile.role === 'admin' && profile.active && profile.account_status === 'active') {
      const { count, error: countError } = await authorization.admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('active', true)
        .eq('account_status', 'active');
      if (countError) throw countError;
      if ((count ?? 0) <= 1) return NextResponse.json({ error: '不可重設最後一位啟用中管理員的密碼' }, { status: 409 });
    }

    if (action === 'reset_password' && profile.account_status === 'disabled') {
      return NextResponse.json({ error: '請使用重新啟用操作，停用帳號不接受密碼重設' }, { status: 409 });
    }
    if (action === 'enable' && profile.account_status !== 'disabled') {
      return NextResponse.json({ error: '此帳號目前不是停用狀態' }, { status: 409 });
    }
    if (action === 'reset_password' && profile.account_status === 'pending_password_setup') {
      return NextResponse.json({ error: '此帳號仍待首次設定密碼，請重新寄送邀請' }, { status: 409 });
    }
    if (action === 'resend_invite' && profile.account_status !== 'pending_password_setup') {
      return NextResponse.json({ error: '此帳號已離開首次設定狀態' }, { status: 409 });
    }
    const withinLimit = await reserveEmployeeAuthEmailRequest(authorization.admin, authorization.actorId, profile.email, 'recovery');
    if (!withinLimit) return NextResponse.json({ error: '密碼郵件次數已達上限，請稍後再試' }, { status: 429 });

    const nextStatus = 'password_reset_pending';
    const { error: stateError } = await authorization.admin.from('profiles')
      .update({ active: false, account_status: nextStatus })
      .eq('id', userId);
    if (stateError) throw stateError;

    try {
      await requestPasswordReset(
        authorization,
        userId,
        profile.email,
        new URL(request.url).origin,
        authorization.actorId,
        action === 'enable' ? 'employee_reactivation_requested' : action === 'resend_invite' ? 'employee_invite_resent' : 'employee_password_reset_requested',
      );
    } catch (emailError) {
      await writeEmployeeAudit(authorization.admin, authorization.actorId, 'employee_password_reset_delivery_failed', userId, {
        email: profile.email,
        account_status: nextStatus,
      });
      return NextResponse.json({ error: '帳號已鎖定且舊密碼已失效，但重設郵件未寄出；請重新執行操作' }, { status: 502 });
    }

    return NextResponse.json({ ok: true, account_status: nextStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = message.includes('admin credentials') ? 503 : 500;
    return NextResponse.json({ error: status === 503 ? '尚未設定伺服器端 Supabase Admin 憑證' : '帳號操作失敗' }, { status });
  }
}
