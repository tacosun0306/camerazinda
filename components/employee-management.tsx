'use client';

import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import { useStaffProfile } from '@/components/app-shell';

type EmployeeRole = 'admin' | 'manager' | 'sales' | 'technician';
type AccountStatus = 'pending_password_setup' | 'active' | 'password_reset_pending' | 'disabled';
type Employee = {
  id: string;
  email: string;
  full_name: string;
  role: EmployeeRole;
  store_name: string;
  active: boolean;
  account_status: AccountStatus;
  created_at: string;
};
type Store = { id: string; name: string };
type AuditEntry = {
  id: number;
  actor_name: string;
  action: string;
  entity_id: string | null;
  target_name: string;
  details: Record<string, unknown>;
  created_at: string;
};
type EmployeeForm = { email: string; full_name: string; role: EmployeeRole; store_name: string };

const roles: { value: EmployeeRole; label: string }[] = [
  { value: 'admin', label: '系統管理員' },
  { value: 'manager', label: '店長' },
  { value: 'sales', label: '門市人員' },
  { value: 'technician', label: '維修技師' },
];
const accountStatuses: Record<AccountStatus, string> = {
  pending_password_setup: '待首次設定密碼',
  active: '正常啟用',
  password_reset_pending: '待重新設定密碼',
  disabled: '已停用',
};
const auditActions: Record<string, string> = {
  employee_invited: '建立帳號並寄送邀請',
  employee_invite_resent: '重新寄送首次設定連結',
  employee_profile_updated: '修改姓名、角色或分店',
  employee_deactivated: '停用帳號',
  employee_reactivation_requested: '重新啟用並要求重設密碼',
  employee_password_reset_requested: '要求重設密碼',
  employee_password_setup_completed: '完成密碼設定',
  employee_password_reset_delivery_failed: '密碼郵件寄送失敗',
  employee_deactivation_auth_ban_failed: 'Auth 停用失敗',
};

const roleLabel = (value: EmployeeRole) => roles.find((role) => role.value === value)?.label ?? value;
const statusClass = (status: AccountStatus) => status === 'active'
  ? 'bg-[#e6efe8] text-fern'
  : status === 'disabled'
    ? 'bg-[#fae8e2] text-[#bd5039]'
    : 'bg-[#f5eed9] text-[#816925]';

async function readApiError(response: Response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? '操作失敗，請稍後重試');
  return result;
}

export function EmployeeManagement() {
  const profile = useStaffProfile();
  const isAdmin = profile?.role === 'admin';
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [showAudits, setShowAudits] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyUserId, setBusyUserId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Employee | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState<EmployeeForm>({ email: '', full_name: '', role: 'sales', store_name: '' });

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const result = await readApiError(await fetch('/api/admin/users', { cache: 'no-store' }));
      setEmployees(result.users as Employee[]);
      setStores(result.stores as Store[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '無法載入人員資料');
    } finally {
      setLoading(false);
    }
  }

  async function loadAudits() {
    setError('');
    try {
      const result = await readApiError(await fetch('/api/admin/users/audit', { cache: 'no-store' }));
      setAudits(result.entries as AuditEntry[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '無法載入稽核紀錄');
    }
  }

  useEffect(() => { void refresh(); }, []);

  const filtered = employees.filter((employee) =>
    `${employee.full_name} ${employee.email} ${employee.store_name} ${accountStatuses[employee.account_status]}`.toLowerCase().includes(query.toLowerCase()),
  );

  function startCreate() {
    setEditing(null);
    setForm({ email: '', full_name: '', role: 'sales', store_name: stores[0]?.name ?? '' });
    setNewOpen(true);
  }

  function startEdit(employee: Employee) {
    setEditing(employee);
    setForm({ email: employee.email, full_name: employee.full_name, role: employee.role, store_name: employee.store_name });
  }

  async function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await readApiError(await fetch(`/api/admin/users/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: form.full_name, role: form.role, store_name: form.store_name }),
        }));
        setNotice('員工資料已更新');
      } else {
        await readApiError(await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }));
        setNotice('邀請已寄出；員工完成密碼設定前無法登入');
      }
      setEditing(null);
      setNewOpen(false);
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function performAction(employee: Employee, action: 'disable' | 'enable' | 'reset_password' | 'resend_invite') {
    const confirmation = action === 'disable'
      ? `確定停用 ${employee.full_name}？所有現有登入工作階段都會失效。`
      : action === 'enable'
        ? `重新啟用 ${employee.full_name}，並寄送一次性密碼設定連結？`
        : action === 'reset_password'
          ? `使 ${employee.full_name} 的舊密碼失效並寄送重設連結？`
          : `重新寄送給 ${employee.full_name} 的首次密碼設定連結？`;
    if (!window.confirm(confirmation)) return;

    setBusyUserId(employee.id);
    setError('');
    setNotice('');
    try {
      const result = await readApiError(await fetch(`/api/admin/users/${employee.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }));
      setNotice(action === 'disable' ? '帳號已停用，既有工作階段已撤銷' : `已寄送密碼設定郵件，狀態：${accountStatuses[result.account_status as AccountStatus]}`);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '帳號操作失敗');
    } finally {
      setBusyUserId('');
    }
  }

  const modalOpen = newOpen || Boolean(editing);
  const modalTitle = editing ? '編輯員工資料' : '新增員工帳號';

  return <div className="space-y-5">
    <section className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow">STAFF & ACCESS</p><h1 className="mt-2 font-display text-[32px] leading-tight">人員管理</h1><p className="mt-2 text-sm text-[#77827c]">管理員建立帳號；員工自行完成首次密碼設定。</p></div>
      {isAdmin && <div className="flex gap-2"><button onClick={() => void refresh()} aria-label="重新載入" className="grid h-10 w-10 place-items-center rounded-md border border-[#dce2db] bg-white"><RefreshCw size={15} /></button><button onClick={startCreate} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3.5 text-xs font-semibold text-white"><Plus size={15} />新增使用者</button></div>}
    </section>

    {error && <p role="alert" className="rounded-md border border-[#f0c5b8] bg-[#fff8f5] px-4 py-3 text-sm text-[#a84834]">{error}</p>}
    {notice && <p role="status" className="rounded-md border border-[#cbdccf] bg-[#eaf2e9] px-4 py-3 text-sm text-fern">{notice}</p>}

    <section className="overflow-hidden rounded-lg border border-[#e2e7e0] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] px-4 py-4 md:px-5"><div><p className="eyebrow">{loading ? '讀取中' : `${filtered.length} 位員工`}</p><h2 className="mt-1 text-base font-semibold">員工帳號</h2></div><label className="flex h-9 w-full max-w-[280px] items-center gap-2 rounded-md border border-[#dfe5de] bg-white px-3"><Search size={15} className="text-[#89928d]" /><input aria-label="搜尋員工" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋姓名、登入帳號或門市" className="w-full border-0 bg-transparent p-0 text-xs outline-none focus:ring-0" /></label></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-[#fafbf9] text-[10px] text-[#87918a]"><tr><th className="px-4 py-3 font-semibold">姓名／登入帳號</th><th className="px-4 py-3 font-semibold">角色</th><th className="px-4 py-3 font-semibold">所屬分店</th><th className="px-4 py-3 font-semibold">帳號狀態</th><th className="px-4 py-3 font-semibold">建立日期</th><th className="px-4 py-3 font-semibold">操作</th></tr></thead><tbody className="divide-y divide-[#edf0eb]">
        {filtered.map((employee) => <tr key={employee.id}>
          <td className="px-4 py-3"><p className="font-semibold text-ink">{employee.full_name}</p><p className="mt-1 text-[11px] text-[#78827c]">{employee.email}</p></td>
          <td className="px-4 py-3">{roleLabel(employee.role)}</td>
          <td className="px-4 py-3">{employee.store_name}</td>
          <td className="px-4 py-3"><span className={`inline-flex rounded px-2 py-1 text-[10px] font-semibold ${statusClass(employee.account_status)}`}>{accountStatuses[employee.account_status]}</span></td>
          <td className="px-4 py-3 text-[#78827c]">{new Date(employee.created_at).toLocaleDateString('zh-TW')}</td>
          <td className="px-4 py-3"><div className="flex flex-wrap gap-x-3 gap-y-2">
            {isAdmin && <>
              <button onClick={() => startEdit(employee)} className="font-semibold text-fern hover:underline">編輯</button>
              {employee.account_status === 'active' && <button disabled={busyUserId === employee.id} onClick={() => void performAction(employee, 'reset_password')} className="font-semibold text-[#816925] disabled:opacity-50">重設密碼</button>}
              {employee.account_status === 'pending_password_setup' && <button disabled={busyUserId === employee.id} onClick={() => void performAction(employee, 'resend_invite')} className="font-semibold text-[#816925] disabled:opacity-50">重寄設定連結</button>}
              {employee.account_status === 'password_reset_pending' && <button disabled={busyUserId === employee.id} onClick={() => void performAction(employee, 'reset_password')} className="font-semibold text-[#816925] disabled:opacity-50">重寄重設連結</button>}
              {employee.account_status === 'disabled' && <button disabled={busyUserId === employee.id} onClick={() => void performAction(employee, 'enable')} className="font-semibold text-fern disabled:opacity-50">重新啟用</button>}
              {employee.account_status !== 'disabled' && <button disabled={busyUserId === employee.id || employee.id === profile?.id} onClick={() => void performAction(employee, 'disable')} className="font-semibold text-[#bd5039] disabled:opacity-50">{busyUserId === employee.id ? '處理中…' : '停用'}</button>}
            </>}
          </div></td>
        </tr>)}
        {!loading && filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-[#87918a]">目前沒有符合條件的人員</td></tr>}
      </tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0eb] px-4 py-3 text-[11px] text-[#87918a]"><span>密碼由 Supabase Auth 處理；管理員不會設定或查看密碼。</span>{isAdmin && <button onClick={() => { const next = !showAudits; setShowAudits(next); if (next) void loadAudits(); }} className="font-semibold text-fern hover:underline">{showAudits ? '隱藏帳號稽核紀錄' : '查看帳號稽核紀錄'}</button>}</div>
    </section>

    {showAudits && isAdmin && <section className="overflow-hidden rounded-lg border border-[#e2e7e0] bg-white"><div className="border-b border-[#edf0eb] px-4 py-4"><h2 className="text-base font-semibold">帳號管理紀錄</h2><p className="mt-1 text-xs text-[#78827c]">最近 200 筆；密碼及一次性 token 不會寫入紀錄。</p></div>{audits.length === 0 ? <p className="px-4 py-8 text-center text-sm text-[#87918a]">尚無帳號管理紀錄</p> : <ul className="divide-y divide-[#edf0eb]">{audits.map((entry) => <li key={entry.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 text-xs"><span><strong>{auditActions[entry.action] ?? entry.action}</strong><span className="ml-2 text-[#78827c]">{entry.target_name} · 操作者 {entry.actor_name}</span></span><time className="text-[#78827c]">{new Date(entry.created_at).toLocaleString('zh-TW')}</time></li>)}</ul>}</section>}

    {modalOpen && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) { setEditing(null); setNewOpen(false); } }}><form role="dialog" aria-modal="true" aria-labelledby="employee-form-title" onSubmit={submitForm} className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><p className="eyebrow">STAFF ACCOUNT</p><h2 id="employee-form-title" className="mt-1 text-lg font-semibold">{modalTitle}</h2></div><button type="button" onClick={() => { setEditing(null); setNewOpen(false); }} aria-label="關閉" className="grid h-8 w-8 place-items-center rounded-md hover:bg-[#f3f5f0]"><X size={17} /></button></div><div className="grid gap-4 sm:grid-cols-2">
      {!editing && <label className="text-xs font-semibold">登入帳號（電子郵件）<input required type="email" autoComplete="off" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" /></label>}
      <label className="text-xs font-semibold">姓名<input required maxLength={100} value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] text-sm" /></label>
      <label className="text-xs font-semibold">職務／角色<select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as EmployeeRole }))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm">{roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
      <label className="text-xs font-semibold">所屬分店<select required value={form.store_name} onChange={(event) => setForm((current) => ({ ...current, store_name: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border-[#dfe5de] bg-white text-sm"><option value="">選擇分店</option>{stores.map((store) => <option key={store.id} value={store.name}>{store.name}</option>)}</select></label>
    </div>{!editing && <p className="mt-4 text-xs leading-5 text-[#78827c]">系統會寄送一次性設定連結；不會建立共用密碼。</p>}{error && <p role="alert" className="mt-4 text-xs text-[#a84834]">{error}</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => { setEditing(null); setNewOpen(false); }} className="h-9 rounded-md border border-[#dfe5de] px-3 text-xs font-semibold">取消</button><button disabled={saving} className="h-9 rounded-md bg-ink px-4 text-xs font-semibold text-white disabled:opacity-60">{saving ? '儲存中…' : editing ? '儲存變更' : '建立並寄送邀請'}</button></div></form></div>}
  </div>;
}
