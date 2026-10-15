import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeEmployeeAdmin, writeEmployeeAudit } from '@/lib/server/employee-management';

const editEmployeeSchema = z.object({
  full_name: z.string().trim().min(1).max(100),
  role: z.enum(['admin', 'manager', 'sales', 'technician']),
  store_name: z.string().trim().min(1).max(100),
});

type RouteContext = { params: Promise<{ userId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeEmployeeAdmin();
    if (!authorization) return NextResponse.json({ error: '只有啟用中的管理員可以編輯使用者' }, { status: 403 });
    const { userId } = await context.params;
    const parsed = editEmployeeSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: '請檢查姓名、角色及所屬分店' }, { status: 400 });

    const { data: current, error: currentError } = await authorization.admin
      .from('profiles')
      .select('id, role, active, account_status, full_name, store_name')
      .eq('id', userId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ error: '找不到此使用者' }, { status: 404 });

    const { data: store, error: storeError } = await authorization.admin
      .from('store_locations')
      .select('name')
      .eq('name', parsed.data.store_name)
      .eq('active', true)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) return NextResponse.json({ error: '所選分店不存在或已停用' }, { status: 400 });

    if (current.role === 'admin' && current.active && parsed.data.role !== 'admin') {
      const { count, error: countError } = await authorization.admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('active', true)
        .eq('account_status', 'active');
      if (countError) throw countError;
      if ((count ?? 0) <= 1) return NextResponse.json({ error: '不可移除最後一位啟用中的管理員' }, { status: 409 });
    }

    const { error: updateError } = await authorization.admin
      .from('profiles')
      .update(parsed.data)
      .eq('id', userId);
    if (updateError) throw updateError;
    await writeEmployeeAudit(authorization.admin, authorization.actorId, 'employee_profile_updated', userId, {
      before: { full_name: current.full_name, role: current.role, store_name: current.store_name },
      after: parsed.data,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = message.includes('admin credentials') ? 503 : 500;
    return NextResponse.json({ error: status === 503 ? '尚未設定伺服器端 Supabase Admin 憑證' : '無法更新使用者資料' }, { status });
  }
}
