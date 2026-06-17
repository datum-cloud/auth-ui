import { env } from '@/utils/env.server';
import { createCookie } from 'react-router';
import { CSRF, CSRFError } from 'remix-utils/csrf/server';

// Fix 6: scope cookie to /id (matches the app basename; legacy-fork co-existence defense —
// the legacy app runs on a different path prefix and must not share or clobber this cookie).
const csrfCookie = createCookie('csrf', {
  httpOnly: true,
  sameSite: 'lax',
  path: '/id',
  secure: env.NODE_ENV === 'production',
  secrets: [env.SESSION_SECRET],
});

export const csrf = new CSRF({ cookie: csrfCookie, formDataKey: 'csrf' });

// Fix 7: loader helper returns [token, cookie | null] as the library emits.
// Route convention: skip Set-Cookie when the second element is null (token already in cookie).
// ADAPTATION (remix-utils 8.8): commitToken returns readonly [string, string | null] —
// the second element is null when the cookie already exists with the same token.
export async function getCsrfToken(request: Request): Promise<[string, string | null]> {
  const [token, cookieHeader] = await csrf.commitToken(request);
  return [token, cookieHeader];
}

// Fix 4: action helper — catch ONLY CSRFError; rethrow anything else so infra failures
// (e.g. crypto unavailable, cookie parse crash) are not masked as 403 CSRF rejections.
//
// CODE-MIN-32: extract the verify step into an injectable seam so the non-CSRFError
// rethrow branch is reachable in unit tests without monkey-patching internals.
export async function assertCsrfWith(
  request: Request,
  formData: FormData,
  verify: (request: Request, formData: FormData) => Promise<void>
): Promise<void> {
  try {
    await verify(request, formData);
  } catch (err) {
    if (err instanceof CSRFError) {
      throw new Response('Invalid CSRF token', { status: 403 });
    }
    throw err; // non-CSRFError rethrown unchanged
  }
}

const defaultVerify = (request: Request, formData: FormData): Promise<void> =>
  csrf.validate(formData, request.headers);

export async function assertCsrf(request: Request, formData: FormData): Promise<void> {
  return assertCsrfWith(request, formData, defaultVerify);
}
