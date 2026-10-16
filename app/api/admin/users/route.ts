import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeEmployeeAdmin, passwordFlowRedirect, reserveEmployeeAuthEmailRequest, writeEmployeeAudit } from '@/lib/server/employee-management';

const newEmployeeSchema = z.object({
  email: z.string().trim().email().max(254),
  full_name: z.string().trim().min(1).max(100),
  role: z.enum(['admin', 'manager', 'sales', 'technician']),
  store_name: z.string().trim().min(1).max(100),
});

export async function GET() {
  try {
    const authorization = await authorizeEmployeeAdmin();
    if (!authorization) return NextResponse.json({ error: '只有啟用中的管理員可以管理使用者' }, { status: 403 });
    const [{ data, error }, { data: stores, error: storesError }] = await Promise.all([
      authorization.admin
      .from('profiles')
      .select('id, email, full_name, role, store_name, active, account_status, created_at')
        .order('full_name'),
      authorization.admin.from('store_locations').select('id, name').eq('active', true).order('name'),
    ]);
    if (error) throw error;
    if (storesError) throw storesError;
    return NextResponse.json({ users: data ?? [], stores: stores ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (error instanceof Error) {
      const databaseError = error as Error & { code?: string };
      console.error('[admin/users] GET failed', {
        name: error.name,
        code: databaseError.code,
        message,
      });
    }
    const status = message.includes('admin credentials') ? 503 : 500;
    return NextResponse.json({ error: status === 503 ? '尚未設定伺服器端 Supabase Admin 憑證' : '無法載入人員資料' }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeEmployeeAdmin();
    if (!authorization) return NextResponse.json({ error: '只有啟用中的管理員可以新增使用者' }, { status: 403 });
    const parsed = newEmployeeSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '請檢查姓名、登入電子郵件、角色及分店' }, { status: 400 });

    const { email, full_name, role, store_name } = parsed.data;
    const { data: store, error: storeError } = await authorization.admin
      .from('store_locations')
      .select('name')
      .eq('name', store_name)
      .eq('active', true)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) return NextResponse.json({ error: '所選分店不存在或已停用' }, { status: 400 });
    const withinLimit = await reserveEmployeeAuthEmailRequest(authorization.admin, authorization.actorId, email, 'invite');
    if (!withinLimit) return NextResponse.json({ error: '邀請次數已達上限，請稍後再試' }, { status: 429 });

    const { data, error: inviteError } = await authorization.admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role, store_name },
      redirectTo: passwordFlowRedirect(new URL(request.url).origin, 'invite'),
    });
    if (inviteError) {
      const duplicate = /already|registered|exists/i.test(inviteError.message);
      return NextResponse.json({ error: duplicate ? '此登入電子郵件已被使用' : '無法建立帳號或寄送設定密碼邀請' }, { status: duplicate ? 409 : 502 });
    }
    if (!data.user) throw new Error('Supabase Auth did not return a user.');

    await writeEmployeeAudit(authorization.admin, authorization.actorId, 'employee_invited', data.user.id, {
      email,
      role,
      store_name,
      status: 'pending_password_setup',
    });
    return NextResponse.json({ ok: true, id: data.user.id, status: 'pending_password_setup' }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = message.includes('admin credentials') ? 503 : 500;
    return NextResponse.json({ error: status === 503 ? '尚未設定伺服器端 Supabase Admin 憑證' : '建立邀請失敗，請稍後重試' }, { status });
  }
}
