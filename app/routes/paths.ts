// Typed route registry. Single source for every in-app URL string. Builders
// return the EXACT path that appears in today's redirects/links (RR7 prefixes the /id
// basename at link/redirect time). A drift test ties this to routes.ts.
type Query = Record<string, string | undefined>;

function withQuery(path: string, q?: Query): string {
  if (!q) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined) params.append(k, v);
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

export const paths = {
  index: () => '/',
  authorize: (q?: Query) => withQuery('/authorize', q),
  login: {
    index: (q?: Query) => withQuery('/login', q),
    method: (q?: Query) => withQuery('/login/method', q),
    password: (q?: Query) => withQuery('/login/password', q),
    mfa: (q?: Query) => withQuery('/login/mfa', q),
    passkey: (q?: Query) => withQuery('/login/passkey', q),
    securityKey: (q?: Query) => withQuery('/login/security-key', q),
    verify: {
      email: (q?: Query) => withQuery('/login/verify/email', q),
      sms: (q?: Query) => withQuery('/login/verify/sms', q),
      authenticator: (q?: Query) => withQuery('/login/verify/authenticator', q),
    },
  },
  signup: {
    index: (q?: Query) => withQuery('/signup', q),
    method: (q?: Query) => withQuery('/signup/method', q),
    password: (q?: Query) => withQuery('/signup/password', q),
    complete: (q?: Query) => withQuery('/signup/complete', q),
  },
  password: {
    reset: (q?: Query) => withQuery('/password/reset', q),
    new: (q?: Query) => withQuery('/password/new', q),
    change: (q?: Query) => withQuery('/password/change', q),
  },
  setup: {
    passkey: (q?: Query) => withQuery('/setup/passkey', q),
    securityKey: (q?: Query) => withQuery('/setup/security-key', q),
    authenticator: (q?: Query) => withQuery('/setup/authenticator', q),
    email: (q?: Query) => withQuery('/setup/email', q),
    sms: (q?: Query) => withQuery('/setup/sms', q),
    mfa: (q?: Query) => withQuery('/setup/mfa', q),
  },
  sso: {
    index: (q?: Query) => withQuery('/sso', q),
    link: (q?: Query) => withQuery('/sso/link', q),
    ldap: (q?: Query) => withQuery('/sso/ldap', q),
    provider: {
      callback: (provider: string, q?: Query) => withQuery(`/sso/${provider}/callback`, q),
      error: (provider: string, q?: Query) => withQuery(`/sso/${provider}/error`, q),
    },
  },
  device: {
    index: (q?: Query) => withQuery('/device', q),
    authorize: (q?: Query) => withQuery('/device/authorize', q),
    complete: (q?: Query) => withQuery('/device/complete', q),
  },
  verify: {
    index: (q?: Query) => withQuery('/verify', q),
    success: (q?: Query) => withQuery('/verify/success', q),
  },
  logout: {
    index: (q?: Query) => withQuery('/logout', q),
    success: (q?: Query) => withQuery('/logout/success', q),
  },
  // Passkey management + sudo re-auth interstitial.
  passkeys: (q?: Query) => withQuery('/passkeys', q),
  reauth: (q?: Query) => withQuery('/reauth', q),
  accounts: (q?: Query) => withQuery('/accounts', q),
  signedIn: (q?: Query) => withQuery('/signed-in', q),
  error: (q?: Query) => withQuery('/error', q),
};
