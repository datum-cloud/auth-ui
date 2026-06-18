import { type RouteConfig, index, route } from '@react-router/dev/routes';

// Routes are grouped by domain: every sub-folder with 2+ route files gets its own
// layout.tsx level (login/verify and sso/:provider therefore nest). URL paths are
// IDENTICAL to the flat form — only the module tree changed. The `login` layout sets
// an explicit { id } so its children can read the shared URL context it hoists via
// useRouteLoaderData('login'); the other layouts are Outlet-only passthroughs.
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
    route('verify', 'routes/login/verify/layout.tsx', [
      route('email', 'routes/login/verify/email.tsx'),
      route('sms', 'routes/login/verify/sms.tsx'),
      route('authenticator', 'routes/login/verify/authenticator.tsx'),
    ]),
  ]),

  route('signup', 'routes/signup/layout.tsx', { id: 'signup' }, [
    index('routes/signup/index.tsx'),
    route('method', 'routes/signup/method.tsx'),
    route('password', 'routes/signup/password.tsx'),
    route('complete', 'routes/signup/complete.tsx'),
  ]),

  route('password', 'routes/password/layout.tsx', [
    route('reset', 'routes/password/reset.tsx'),
    route('new', 'routes/password/new.tsx'),
    route('change', 'routes/password/change.tsx'),
  ]),

  route('setup', 'routes/setup/layout.tsx', [
    route('passkey', 'routes/setup/passkey.tsx'),
    route('security-key', 'routes/setup/security-key.tsx'),
    route('authenticator', 'routes/setup/authenticator.tsx'),
    route('email', 'routes/setup/email.tsx'),
    route('sms', 'routes/setup/sms.tsx'),
    route('mfa', 'routes/setup/mfa.tsx'),
  ]),

  route('sso', 'routes/sso/layout.tsx', [
    index('routes/sso/index.tsx'),
    route('link', 'routes/sso/link.tsx'),
    // P6 Task 9: LDAP credential-entry route.
    route('ldap', 'routes/sso/ldap.tsx'),
    route(':provider', 'routes/sso/provider/layout.tsx', [
      route('callback', 'routes/sso/provider/callback.tsx'),
      route('error', 'routes/sso/provider/error.tsx'),
    ]),
  ]),

  route('device', 'routes/device/layout.tsx', [
    // P6 Task 6: device authorization grant — user-code entry screen.
    index('routes/device/index.tsx'),
    // P6 Task 7: device/authorize — consent (authorize / deny).
    route('authorize', 'routes/device/authorize.tsx'),
  ]),

  route('verify', 'routes/verify/layout.tsx', [
    index('routes/verify/index.tsx'),
    route('success', 'routes/verify/success.tsx'),
  ]),

  route('logout', 'routes/logout/layout.tsx', [
    index('routes/logout/index.tsx'),
    route('success', 'routes/logout/success.tsx'),
  ]),

  // Flat standalone routes.
  route('accounts', 'routes/accounts.tsx'),
  route('signed-in', 'routes/signed-in.tsx'),
  route('error', 'routes/error.tsx'),
  // Catch-all uses a separate module — RR7 derives route IDs from file paths,
  // so two entries pointing at the same file produce a duplicate-ID error.
  route('*', 'routes/catchall.tsx'),
] satisfies RouteConfig;
