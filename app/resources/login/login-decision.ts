import type { AuthMethod, LoginSettings } from '@/modules/auth/types';

export interface Decision {
  target: string;
  params?: Record<string, string>;
  error?: string;
}

const SINGLE_TARGET: Record<string, string> = {
  passkey: '/login/passkey',
  idp: '/sso',
  password: '/login/password',
  otp_email: '/login/verify/email',
};

export function decideAfterIdentifier({
  methods,
  settings,
  emailDeliveryEnabled,
}: {
  methods: AuthMethod[];
  settings: LoginSettings;
  emailDeliveryEnabled: boolean;
}): Decision {
  if (methods.length === 0) return { target: '/verify' }; // invite path (Phase 2 screen)

  // Compute policy-permitted primary sign-in methods.
  // CODE-MIN-07: only route to external IdP login if the org policy still allows it.
  // A stale 'idp' method must not bypass a disabled-external-IdP setting.
  const available: string[] = [];
  if (methods.includes('passkey') && settings.passkeysType !== 'not_allowed')
    available.push('passkey');
  if (methods.includes('idp') && settings.allowExternalIdp) available.push('idp');
  if (methods.includes('password') && settings.allowPassword) available.push('password');
  if (methods.includes('otp_email') && emailDeliveryEnabled) available.push('otp_email');

  if (available.length >= 2) return { target: '/login/method' };

  if (available.length === 1) return { target: SINGLE_TARGET[available[0]] };

  // available.length === 0: surface the most actionable error.
  if (methods.includes('password') && !settings.allowPassword) {
    return { target: '/error', error: 'PASSWORD_NOT_ALLOWED' };
  }
  return { target: '/error', error: 'NO_SUPPORTED_METHOD' };
}
