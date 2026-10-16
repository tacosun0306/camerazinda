'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { Bell, Camera, ChevronDown, Menu, Search, X } from 'lucide-react';
import { modules } from '@/lib/modules';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type EmployeeProfile = {
  id?: string;
  full_name: string;
  role: 'admin' | 'manager' | 'sales' | 'technician';
  store_name: string;
};

const StaffContext = createContext<EmployeeProfile | null>(null);

export function useStaffProfile() {
  return useContext(StaffContext);
}

const roleLabels: Record<EmployeeProfile['role'], string> = {
  admin: '系統管理員',
  manager: '店長',
  sales: '門市人員',
  technician: '維修技師',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [repairCount, setRepairCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;
    async function loadRepairCount() {
      const { count, error } = await supabase
        .from('repair_jobs')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'picked_up');
      if (active) setRepairCount(error ? null : count ?? 0);
    }
    async function loadProfile(userId?: string) {
      let employeeId = userId;
      if (!employeeId) {
        const { data: { user } } = await supabase.auth.getUser();
        employeeId = user?.id;
      }
      if (!employeeId) return;
      const { data } = await supabase.from('profiles').select('id, full_name, role, store_name').eq('id', employeeId).maybeSingle();
      if (active && data) setProfile(data);
    }
    void loadProfile();
    void loadRepairCount();
    const handleRepairJobsChanged = () => { void loadRepairCount(); };
    window.addEventListener('repair-jobs-changed', handleRepairJobsChanged);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void loadProfile(session.user.id);
        void loadRepairCount();
      } else if (active) {
        setProfile(null);
        setRepairCount(null);
      }
    });
    return () => {
      active = false;
      window.removeEventListener('repair-jobs-changed', handleRepairJobsChanged);
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.assign('/login');
  }

  return (
    <StaffContext.Provider value={profile}>
    <div className="app-shell flex min-h-screen">
      {menuOpen && <button aria-label="關閉導覽選單" className="mobile-overlay fixed inset-0 z-40 md:hidden" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar flex shrink-0 flex-col px-4 py-5 ${menuOpen ? 'open' : ''}`}>
        <div className="flex items-center justify-between px-2 pb-8">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setMenuOpen(false)}>
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-lime text-ink"><Camera size={19} strokeWidth={2.2} /></span>
            <span><span className="block text-sm font-bold tracking-tight">CAMERA STORE</span><span className="mt-0.5 block text-[10px] font-medium tracking-[.16em] text-[#9ca9a1]">OPERATIONS OS</span></span>
          </Link>
          <button className="text-white md:hidden" aria-label="關閉選單" onClick={() => setMenuOpen(false)}><X size={20} /></button>
        </div>
        <p className="eyebrow px-3 pb-2 text-[#75827a]">工作台</p>
        <nav className="space-y-1" aria-label="主要導覽">
          {modules.filter(({ href }) => {
            if (['/schedule', '/attendance'].includes(href) && !['admin', 'manager', 'technician'].includes(profile?.role ?? '')) return false;
            if (href === '/users') return profile?.role === 'admin';
            if (['/roles', '/audit-logs'].includes(href)) return profile?.role === 'admin' || profile?.role === 'manager';
            return true;
          }).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={`nav-link ${pathname === href ? 'active' : ''}`}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              {href === '/repairs' && repairCount !== null && repairCount > 0 && <span className="ml-auto rounded-full bg-[#e36d52] px-1.5 py-0.5 text-[10px] font-bold text-white">{repairCount}</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-lg border border-[#34413b] bg-[#202c27] p-3.5">
          <div className="flex items-center justify-between"><span className="eyebrow text-[#9ca9a1]">門市狀態</span><span className="h-2 w-2 rounded-full bg-lime" /></div>
          <p className="mt-2 text-sm font-semibold">台南晶大門市</p>
          <p className="mt-1 text-xs text-[#9ca9a1]">營業中 · 10:00 – 22:00</p>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-[#e2e7e0] bg-[#f3f5f0]/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <button className="-ml-1 grid h-9 w-9 place-items-center rounded-md text-ink hover:bg-white md:hidden" aria-label="開啟導覽選單" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
            <div className="hidden items-center gap-2 text-xs text-[#77827c] sm:flex"><span>{profile?.store_name ?? '門市'}</span><span>/</span><span className="font-semibold text-ink">{modules.find((item) => item.href === pathname)?.label ?? '工作台'}</span></div>
            <span className="text-sm font-semibold sm:hidden">{modules.find((item) => item.href === pathname)?.label ?? '工作台'}</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button aria-label="搜尋" className="grid h-9 w-9 place-items-center rounded-md text-[#66736d] hover:bg-white"><Search size={18} /></button>
            <button aria-label="通知" className="relative grid h-9 w-9 place-items-center rounded-md text-[#66736d] hover:bg-white"><Bell size={18} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-coral" /></button>
            <div className="h-7 w-px bg-[#dce2db]" />
            <button onClick={signOut} className="flex items-center gap-2 rounded-md py-1 pl-1 pr-0.5 hover:bg-white" aria-label="登出"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#dce9df] text-xs font-bold text-fern">{profile?.full_name?.slice(0, 1) ?? '?'}</span><span className="hidden text-left sm:block"><span className="block text-xs font-semibold">{profile?.full_name ?? '載入員工資料'}</span><span className="block text-[10px] text-[#78827c]">{profile ? roleLabels[profile.role] : ''}</span></span><ChevronDown size={14} className="hidden text-[#78827c] sm:block" /></button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
    </StaffContext.Provider>
  );
}