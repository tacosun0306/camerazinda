'use client';

import { useEffect } from 'react';

export function AuthRecoveryHashRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    const flowValue = hashParams.get('type') ?? query.get('type') ?? query.get('flow');
    const flow = flowValue === 'invite' || flowValue === 'recovery' ? flowValue : null;
    const hasAuthPayload = hashParams.has('access_token') || query.has('code') || query.has('token_hash');
    if (!flow || !hasAuthPayload) return;

    const callbackUrl = new URL('/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('flow', flow);
    if (query.has('code')) callbackUrl.searchParams.set('code', query.get('code') ?? '');
    if (query.has('token_hash')) callbackUrl.searchParams.set('token_hash', query.get('token_hash') ?? '');
    callbackUrl.hash = hash;
    window.location.replace(callbackUrl.toString());
  }, []);

  return null;
}
