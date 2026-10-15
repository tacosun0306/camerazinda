import { NextResponse } from 'next/server';
import { authorizeEmployeeAdmin } from '@/lib/server/employee-management';

export async function GET() {
  try {
    const authorization = await authorizeEmployeeAdmin();
    if (!authorization) return NextResponse.json({ error: '只有啟用中的管理員可以檢視帳號稽核紀錄' }, { status: 403 });

    const { data, error } = await authorization.admin
      .from('audit_logs')
      .select('id, actor_id, action, entity_id, details, created_at')
      .eq('entity_type', 'profile')
      .like('action', 'employee_%')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;

    const actorIds = [...new Set((data ?? []).map((entry) => entry.actor_id).filter((id): id is string => Boolean(id)))];
    const { data: profiles, error: profilesError } = actorIds.length
      ? await authorization.admin.from('profiles').select('id, full_name').in('id', actorIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const actorNames = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]));
    const targetIds = [...new Set((data ?? []).map((entry) => entry.entity_id).filter((id): id is string => Boolean(id)))];
    const { data: targets, error: targetsError } = targetIds.length
      ? await authorization.admin.from('profiles').select('id, full_name, email').in('id', targetIds)
      : { data: [], error: null };
    if (targetsError) throw targetsError;
    const targetNames = new Map((targets ?? []).map((profile) => [profile.id, `${profile.full_name} · ${profile.email}`]));

    return NextResponse.json({ entries: (data ?? []).map((entry) => ({
      ...entry,
      actor_name: entry.actor_id ? actorNames.get(entry.actor_id) ?? '已停用員工' : '系統',
      target_name: entry.entity_id ? targetNames.get(entry.entity_id) ?? '帳號資料' : '—',
    })) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const status = message.includes('admin credentials') ? 503 : 500;
    return NextResponse.json({ error: status === 503 ? '尚未設定伺服器端 Supabase Admin 憑證' : '無法載入帳號稽核紀錄' }, { status });
  }
}
