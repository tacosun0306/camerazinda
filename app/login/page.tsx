import { Camera } from 'lucide-react';
import Link from 'next/link';
import { signIn } from './actions';

const errors: Record<string, string> = {
  invalid: '請確認電子郵件格式及密碼長度。',
  credentials: '帳號或密碼錯誤，請再試一次。',
  configuration: '尚未設定 Supabase，請依 README 完成環境設定。',
  profile: '此帳號尚未啟用員工資料，請聯絡系統管理員。',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return <main className="grid min-h-screen bg-[#182421] lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 78% 30%, #7c9f6c 0, transparent 28%), linear-gradient(135deg, transparent 35%, #31463c 100%)' }} />
      <Link href="/dashboard" className="relative flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-lime text-ink"><Camera size={20} /></span><span className="text-sm font-bold tracking-wide">CAMERA STORE OS</span></Link>
      <div className="relative max-w-lg"><p className="eyebrow text-[#c7ef62]">ONE STORE. IN FOCUS.</p><h1 className="mt-5 font-display text-5xl leading-[1.1]">把店裡的每個細節，<span className="text-[#c7ef62]">都看清楚。</span></h1><p className="mt-5 max-w-md text-sm leading-7 text-[#bdc9c0]">庫存、維修、排班與團隊日常，在一個工作台清楚掌握。</p></div>
      <p className="relative text-xs text-[#8e9c93]">台南晶大門市 · 內部營運系統</p>
    </section>
    <section className="flex min-h-screen flex-col justify-center bg-[#f3f5f0] px-6 py-12 sm:px-12">
      <div className="mx-auto w-full max-w-[390px]">
        <div className="mb-10 lg:hidden"><span className="grid h-10 w-10 place-items-center rounded-lg bg-lime text-ink"><Camera size={20} /></span></div>
        <p className="eyebrow">員工工作台</p><h2 className="mt-2 font-display text-3xl">歡迎回來</h2><p className="mt-2 text-sm text-[#77827c]">登入以繼續管理門市營運。</p>
        <form action={signIn} className="mt-8 space-y-5">
          {next?.startsWith('/inventory') && !next.startsWith('//') && !next.includes('\\') && <input type="hidden" name="next" value={next} />}
          <label className="block text-xs font-semibold">電子郵件<input required name="email" type="email" autoComplete="username" placeholder="name@camera.store" className="mt-2 h-11 w-full rounded-md border-[#dce2db] bg-white px-3 text-sm focus:border-fern focus:ring-fern" /></label>
          <label className="block text-xs font-semibold">密碼<input required name="password" type="password" minLength={8} autoComplete="current-password" placeholder="至少 8 個字元" className="mt-2 h-11 w-full rounded-md border-[#dce2db] bg-white px-3 text-sm focus:border-fern focus:ring-fern" /></label>
          {error && <p role="alert" className="rounded-md bg-[#fae8e2] px-3 py-2.5 text-xs text-[#a84834]">{errors[error] ?? '登入失敗，請再試一次。'}</p>}
          <button className="h-11 w-full rounded-md bg-ink text-sm font-semibold text-white transition hover:bg-fern">登入工作台</button>
        </form>
        {!process.env.NEXT_PUBLIC_SUPABASE_URL && <div className="mt-5 rounded-md border border-[#fae8e2] bg-white p-3 text-xs leading-5 text-[#a84834]">尚未設定 Supabase，請聯絡系統管理員。</div>}
        <p className="mt-8 text-center text-[10px] text-[#98a19b]">僅供授權員工使用 · 存取行為將留存紀錄</p>
      </div>
    </section>
  </main>;
}