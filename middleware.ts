import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicPaths = ['/login', '/auth/callback'];
  const accountPasswordPath = '/account/password';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (publicPaths.includes(pathname)) return NextResponse.next();
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('error', 'configuration');
    loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !publicPaths.includes(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }
  if (user && !publicPaths.includes(pathname)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('active, role, account_status')
      .eq('id', user.id)
      .maybeSingle();
    if (pathname === accountPasswordPath) {
      if (!profile || profile.account_status === 'disabled') {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/login';
        loginUrl.search = '?error=profile';
        return NextResponse.redirect(loginUrl);
      }
      if (profile.account_status === 'active' && profile.active) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
      }
      if (profile.account_status !== 'pending_password_setup' && profile.account_status !== 'password_reset_pending') {
        const loginUrl = request.nextUrl.clone();
        loginUrl.pathname = '/login';
        loginUrl.search = '?error=profile';
        return NextResponse.redirect(loginUrl);
      }
    } else if (pathname === '/api/auth/password-challenge' || pathname === '/api/account/password') {
      if (!profile || profile.active || !['pending_password_setup', 'password_reset_pending'].includes(profile.account_status)) {
        return NextResponse.json({ error: 'Password setup link is invalid or expired.' }, { status: 403 });
      }
    } else if (!profile?.active || profile.account_status !== 'active') {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Account is inactive or requires password setup.' }, { status: 403 });
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = '/login';
      loginUrl.searchParams.set('error', profile?.account_status === 'pending_password_setup' ? 'first_setup' : profile?.account_status === 'password_reset_pending' ? 'password_reset' : 'profile');
      return NextResponse.redirect(loginUrl);
    }
    if (profile.role === 'sales' && ['/schedule', '/attendance'].some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    if (pathname === '/users' && profile.role !== 'admin') {
      const dashboardUrl = request.nextUrl.clone();
      dashboardUrl.pathname = '/dashboard';
      return NextResponse.redirect(dashboardUrl);
    }
    const managerOnly = ['/users', '/roles', '/audit-logs'];
    if (managerOnly.includes(pathname) && !['admin', 'manager'].includes(profile.role)) {
      const dashboardUrl = request.nextUrl.clone();
      dashboardUrl.pathname = '/dashboard';
      return NextResponse.redirect(dashboardUrl);
    }
  }
  if (user && pathname === '/login') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('active, account_status')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.account_status === 'pending_password_setup' || profile?.account_status === 'password_reset_pending') {
      return NextResponse.redirect(new URL(accountPasswordPath, request.url));
    }
    if (!profile?.active || profile.account_status !== 'active') return response;
    const nextPath = request.nextUrl.searchParams.get('next');
    if (nextPath?.startsWith('/inventory') && !nextPath.startsWith('//') && !nextPath.includes('\\')) {
      return NextResponse.redirect(new URL(nextPath, request.url));
    }
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/dashboard';
    dashboardUrl.search = '';
    return NextResponse.redirect(dashboardUrl);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};