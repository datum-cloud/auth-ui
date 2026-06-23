import { type RouteConfig, index, route } from '@react-router/dev/routes';

// Routes are grouped by domain. The `login` and `signup` layouts are KEPT with an
// explicit { id } so their children can read the shared URL context they hoist via
// useRouteLoaderData('login'|'signup'). The 8 Outlet-only passthrough layouts were
// collapsed: their path prefixes are inlined into each child entry below, so
// URL paths remain IDENTICAL to the prior nested form — only the module tree changed.
export default [
  index('routes/_index.tsx'),

  // Single standalone route (one file) — stays flat, no layout.
  route('authorize', 'routes/authorize/index.tsx'),

  route('login', 'routes/login/layout.tsx', { id: 'login' }, [
    index('routes/login/index.tsx'),
    route('method', 'routes/login/method.tsx'),
    route('password', 'routes/login/password.tsx'),
    route('mfa', 'routes/login/mfa.tsx'),
    route('passkey', 'routes/login/passkey.tsx'),
    route('security-key', 'routes/login/security-key.tsx'),
    route('verify/email', 'routes/login/verify/email.tsx'),
    route('verify/sms', 'routes/login/verify/sms.tsx'),
    route('verify/authenticator', 'routes/login/verify/authenticator.tsx'),
  ]),

  route('signup', 'routes/signup/layout.tsx', { id: 'signup' }, [
    index('routes/signup/index.tsx'),
    route('method', 'routes/signup/method.tsx'),
    route('password', 'routes/signup/password.tsx'),
    route('complete', 'routes/signup/complete.tsx'),
  ]),

  // password group — layout collapsed; prefix inlined per child.
  route('password/reset', 'routes/password/reset.tsx'),
  route('password/new', 'routes/password/new.tsx'),
  route('password/change', 'routes/password/change.tsx'),

  // setup group — layout collapsed; prefix inlined per child.
  route('setup/passkey', 'routes/setup/passkey.tsx'),
  route('setup/security-key', 'routes/setup/security-key.tsx'),
  route('setup/authenticator', 'routes/setup/authenticator.tsx'),
  route('setup/email', 'routes/setup/email.tsx'),
  route('setup/sms', 'routes/setup/sms.tsx'),
  route('setup/mfa', 'routes/setup/mfa.tsx'),

  // sso group — sso + provider layouts collapsed; prefixes inlined.
  route('sso', 'routes/sso/index.tsx'),
  route('sso/link', 'routes/sso/link.tsx'),
  // P6 Task 9: LDAP credential-entry route.
  route('sso/ldap', 'routes/sso/ldap.tsx'),
  route('sso/:provider/callback', 'routes/sso/provider/callback.tsx'),
  route('sso/:provider/error', 'routes/sso/provider/error.tsx'),

  // device group — layout collapsed; prefix inlined per child.
  // P6 Task 6: device authorization grant — user-code entry screen.
  route('device', 'routes/device/index.tsx'),
  // P6 Task 7: device/authorize — consent (authorize / deny).
  route('device/authorize', 'routes/device/authorize.tsx'),
  // Terminal completion screen — the post-decision landing with NO getDeviceAuth loader, so
  // RR7's post-action revalidation never re-resolves the (legitimately consumed) device-auth request.
  route('device/complete', 'routes/device/complete.tsx'),

  // verify group — layout collapsed; prefix inlined per child.
  route('verify', 'routes/verify/index.tsx'),
  route('verify/success', 'routes/verify/success.tsx'),

  // logout group — layout collapsed; prefix inlined per child.
  route('logout', 'routes/logout/index.tsx'),
  route('logout/success', 'routes/logout/success.tsx'),

  // Flat standalone routes.
  route('accounts', 'routes/accounts.tsx'),
  route('signed-in', 'routes/signed-in.tsx'),
  route('error', 'routes/error.tsx'),
  // Catch-all uses a separate module — RR7 derives route IDs from file paths,
  // so two entries pointing at the same file produce a duplicate-ID error.
  route('*', 'routes/catchall.tsx'),
] satisfies RouteConfig;
