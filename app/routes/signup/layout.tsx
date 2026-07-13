import { readCeremonyParams } from '@/resources/shared/ceremony-params';
import { Outlet, type LoaderFunctionArgs } from 'react-router';

/**
 * Shared render context for the whole signup ceremony group, read ONCE here and
 * consumed by child route components via `useRouteLoaderData('signup')` (see the
 * explicit `{ id: 'signup' }` in routes.ts).
 *
 * The signup steps thread the same identity context through the URL: `loginName`
 * (the multi-account disambiguator — the session cookie can hold several entries,
 * and this selects which one the step is for), plus `requestId` / `organization`.
 */
export interface SignupLayoutData {
  loginName: string;
  requestId?: string;
  organization?: string;
}

/**
 * SAFETY (A4): this loader runs for EVERY login child, so it does only a
 * side-effect-free read of the URL-threaded context — no session reads, guards,
 * redirects, or challenge dispatch. Those are per-step and stay in each child's
 * own loader. React Router does not pass this result into child loaders/actions
 * (they run independently); the hoist removes duplicated *render-time* context.
 */
export async function loader({ request }: LoaderFunctionArgs): Promise<SignupLayoutData> {
  return readCeremonyParams(new URL(request.url));
}

export default function SignupLayout() {
  return <Outlet />;
}
