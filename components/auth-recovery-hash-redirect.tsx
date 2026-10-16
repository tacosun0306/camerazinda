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
    const hasAuthError = hashParams.has('error') || hashParams.has('error_description') || query.has('error') || query.has('error_description');
    if (!flow || (!hasAuthPayload && !hasAuthError)) return;

    const callbackUrl = new URL('/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('flow', flow);
    if (query.has('code')) callbackUrl.searchParams.set('code', query.get('code') ?? '');
    if (query.has('token_hash')) callbackUrl.searchParams.set('token_hash', query.get('token_hash') ?? '');
    if (query.has('error')) callbackUrl.searchParams.set('error', query.get('error') ?? '');
    if (query.has('error_description')) callbackUrl.searchParams.set('error_description', query.get('error_description') ?? '');
    callbackUrl.hash = hash;
    window.location.replace(callbackUrl.toString());
  }, []);

  return null;
}
