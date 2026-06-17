import { processIdpCallback, outcomeToResponse, type CallbackLoaderDeps } from '@/resources/sso';
import { providerForRequest } from '@/server/auth-context.server';
import { type LoaderFunctionArgs } from 'react-router';

export type { CallbackLoaderDeps };

// /sso/:provider/callback is a headless loader: query validation, intent retrieval, the
// server-side ceremony-user resolution, the decideIdpCallback decision, and the sign-in /
// link / register / error branch dispatch all live in processIdpCallback (resources/sso).
// The route resolves the request-scoped provider, calls the service, and translates the typed
// outcome into the redirect/data Response — no business logic remains inline.
export async function loader(
  { request, params }: LoaderFunctionArgs,
  deps: CallbackLoaderDeps = {}
) {
  const provider = providerForRequest(request);
  const outcome = await processIdpCallback(provider, request, params.provider, deps);
  return outcomeToResponse(outcome);
}

export default function SsoCallback() {
  return null;
}
