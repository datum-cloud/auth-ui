import type { AuthMethod, FlowContext, LoginSettings } from '@/modules/auth/types';

// Discriminated union replaces the stringly-typed { target; error? } whose
// 'callback'/'error' sentinels leaked as-casts into routes. Consumers `switch (d.kind)`
// exhaustively — the module split deleted the `decisionTarget`/`decisionError` compat shims
// (login.service.ts + routes/login/method.tsx now read the union directly).
export type Decision =
  | { kind: 'redirect'; path: string; params?: Record<string, string> }
  | { kind: 'error'; error: string };

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
  // The post-identifier decision is by definition the PRIMARY flow. Threading the
  // role explicitly pins it at the call boundary (a 'mfa' context is a compile error here)
  // instead of inferring it from a sentinel query param. Behavior-neutral — the role does
  // not branch any routing; `otp_email` still resolves to /login/verify/email as a primary.
  context: Extract<FlowContext, { role: 'primary' }>;
}): Decision {
  if (methods.length === 0) return { kind: 'redirect', path: '/verify' }; // invite path (Phase 2 screen)

  // Compute policy-permitted primary sign-in methods.
  // Only route to external IdP login if the org policy still allows it.
  // A stale 'idp' method must not bypass a disabled-external-IdP setting.
  const available: string[] = [];
  if (methods.includes('passkey') && settings.passkeysType !== 'not_allowed')
    available.push('passkey');
  if (methods.includes('idp') && settings.allowExternalIdp) available.push('idp');
  if (methods.includes('password') && settings.allowPassword) available.push('password');
  if (methods.includes('otp_email') && emailDeliveryEnabled) available.push('otp_email');

  if (available.length >= 2) return { kind: 'redirect', path: '/login/method' };

  if (available.length === 1) return { kind: 'redirect', path: SINGLE_TARGET[available[0]] };

  // available.length === 0: surface the most actionable error.
  if (methods.includes('password') && !settings.allowPassword) {
    return { kind: 'error', error: 'PASSWORD_NOT_ALLOWED' };
  }
  return { kind: 'error', error: 'NO_SUPPORTED_METHOD' };
}
