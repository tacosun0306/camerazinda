import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function authorizeEmployeeAdmin(): Promise<{ actorId: string; admin: SupabaseClient } | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, active, account_status')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || profile?.role !== 'admin' || profile.active !== true || profile.account_status !== 'active') return null;

  return { actorId: user.id, admin: createSupabaseAdminClient() };
}

export async function writeEmployeeAudit(
  admin: SupabaseClient,
  actorId: string,
  action: string,
  targetId: string,
  details: Record<string, unknown>,
) {
  const { error } = await admin.from('audit_logs').insert({
    actor_id: actorId,
    action,
    entity_type: 'profile',
    entity_id: targetId,
    details,
  });
  if (error) throw error;
}

export async function reserveEmployeeAuthEmailRequest(
  admin: SupabaseClient,
  actorId: string,
  targetEmail: string,
  flow: 'invite' | 'recovery',
) {
  const { data, error } = await admin.rpc('reserve_employee_auth_email_request', {
    p_actor_id: actorId,
    p_target_email: targetEmail,
    p_flow: flow,
  });
  if (error) throw error;
  return data === true;
}

export function passwordFlowRedirect(origin: string, flow: 'invite' | 'recovery') {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? origin;
  const redirectUrl = new URL('/auth/callback', siteUrl);
  redirectUrl.searchParams.set('flow', flow);
  return redirectUrl.toString();
}
