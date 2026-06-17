import type { AuthMethod, LoginSettings } from '@/providers/types';

export interface Decision {
  target: string;
  params?: Record<string, string>;
  error?: string;
}

export function decideAfterIdentifier({
  methods,
  settings,
}: {
  methods: AuthMethod[];
  settings: LoginSettings;
}): Decision {
  if (methods.length === 0) return { target: '/verify' }; // invite path (Phase 2 screen)
  if (methods.includes('passkey') && settings.passkeysType !== 'not_allowed') {
    return { target: '/login/passkey' }; // Phase 4 screen
  }
  // CODE-MIN-07: only route to external IdP login if the org policy still allows it.
  // A stale 'idp' method must not bypass a disabled-external-IdP setting.
  if (methods.includes('idp') && settings.allowExternalIdp) return { target: '/sso' }; // Phase 3 screen
  if (methods.includes('password')) {
    if (!settings.allowPassword) return { target: '/error', error: 'PASSWORD_NOT_ALLOWED' };
    return { target: '/login/password' };
  }
  return { target: '/error', error: 'NO_SUPPORTED_METHOD' };
}
