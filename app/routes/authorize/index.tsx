import { resolveAuthorize, outcomeToResponse } from '@/resources/authorize';
import { providerForRequest } from '@/server/auth-context.server';
import type { LoaderFunctionArgs } from 'react-router';

// /authorize is a headless loader: the request-kind normalization, the open-redirect guard,
// the SAML / device / OIDC branch orchestration, the stale-cookie liveness self-heal, and the
// createCallback dispatch all live in the authorize service (resources/authorize). The route
// only resolves the request-scoped provider, calls the service, and translates the typed
// outcome into the redirect/JSON Response — no business logic remains inline.
export async function loader({ request }: LoaderFunctionArgs) {
  const provider = providerForRequest(request);
  const outcome = await resolveAuthorize(provider, request);
  return outcomeToResponse(outcome, new URL(request.url));
}

export default function Authorize() {
  return null;
}
