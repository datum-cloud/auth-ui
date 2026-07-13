import type { LoginLayoutData } from '@/routes/login/layout';
import { useRouteLoaderData } from 'react-router';

/**
 * Shared login-ceremony render context (loginName / requestId / organization),
 * read once in the `login` layout loader and consumed by every login child route.
 *
 * The `?? { loginName: '' }` fallback only satisfies the structurally-possible-undefined
 * branch — these routes always render under the `login` layout, so it is never taken at
 * runtime. It is preserved verbatim from the inline call sites this hook replaces.
 */
export function useLoginContext(): LoginLayoutData {
  return (
    useRouteLoaderData<typeof import('@/routes/login/layout').loader>('login') ?? { loginName: '' }
  );
}
