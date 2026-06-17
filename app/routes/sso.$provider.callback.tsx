import { decideIdpCallback } from '@/flows/idp-callback';
import { ProviderError } from '@/providers/types';
import type { IdpIntentResult } from '@/providers/types';
import { providerErrorCode } from '@/routes/_shared/auth-error';
import { signInWithIdpIntent } from '@/routes/_shared/idp-session';
import { providerForRequest } from '@/server/auth-context.server';
import { logAuthEvent } from '@/server/observability';
import { readSessions, addSession, mostRecent, serializeSessions } from '@/session/cookie';
import { redirect, type LoaderFunctionArgs } from 'react-router';
import { z } from 'zod';

const Query = z.object({
  id: z.string().min(1),
  token: z.string().min(1),
  link: z.string().optional(),
  requestId: z.string().optional(),
  organization: z.string().optional(),
});

// Dependency-injection seam for unit tests (CODE-MAJ-04). Production calls never pass deps.
// - retrieveIdpIntent: override the provider call so tests can inject a stub directly.
// - onAuthEvent: collect audit events in tests without module-level mocking of logAuthEvent.
export interface CallbackLoaderDeps {
  // CODE-MIN-03: tightened from Promise<unknown> — matches the narrowed AuthProvider signature.
  retrieveIdpIntent?: (id: string, token: string) => Promise<IdpIntentResult>;
  onAuthEvent?: (event: string, outcome: 'success' | 'failure') => void;
}

export async function loader(
  { request, params }: LoaderFunctionArgs,
  deps: CallbackLoaderDeps = {}
) {
  const provider = providerForRequest(request);
  const url = new URL(request.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  const slug = params.provider ?? 'idp';

  // DI: tests can inject retrieveIdpIntent; production delegates to the resolved provider.
  const doRetrieveIdpIntent =
    deps.retrieveIdpIntent ??
    ((id: string, token: string) => provider.retrieveIdpIntent(id, token));

  if (!parsed.success) {
    return redirect(`/sso/${slug}/error?reason=context-missing`);
  }

  const { id, token, link, requestId, organization } = parsed.data;

  // CODE-MAJ-04: wrap the intent-fetch + session-resolution + decision block so a transient
  // ProviderError redirects to the branded error page and emits a failure audit event instead
  // of producing a raw 500. Unknown errors (non-ProviderError) re-throw so the root
  // ErrorBoundary (CCD-10) handles them.
  let intent: IdpIntentResult;
  let entries: Awaited<ReturnType<typeof readSessions>>;
  let decision: ReturnType<typeof decideIdpCallback>;

  try {
    intent = await doRetrieveIdpIntent(id, token);

    // Resolve the active ceremony user server-side — NEVER trust a client-supplied userId.
    entries = await readSessions(request);
    const recent = mostRecent(entries);
    let sessionUserId: string | null = null;
    if (recent) {
      // CODE-MIN-05: recent.id is a SESSION id, not a user id — getUser(recent.id) was
      // semantically wrong and a wasted call. Resolve the user directly from the session.
      const session = await provider.getSession(recent.id, recent.token);
      sessionUserId = session?.user?.id ?? null;
    }

    const settings = await provider.getLoginSettings(organization);
    decision = decideIdpCallback({
      intent,
      link: link === 'true',
      sessionUserId,
      creationAllowed: settings.allowRegister,
    });
  } catch (err) {
    if (err instanceof ProviderError) {
      deps.onAuthEvent?.('idp.signin', 'failure');
      logAuthEvent('idp.signin', 'failure', { reason: err.code, requestId });
      return redirect(`/sso/${slug}/error?reason=${providerErrorCode(err.code)}`);
    }
    throw err; // unknown → root ErrorBoundary (CCD-10) renders the branded page
  }

  switch (decision.kind) {
    case 'sign-in': {
      let setCookie: string;
      let target: string;
      try {
        ({ setCookie, target } = await signInWithIdpIntent(provider, request, {
          idpIntentId: id,
          idpIntentToken: token,
          userId: decision.userId,
          requestId,
          organization,
          fallbackLoginName: intent.information.idpUserName,
        }));
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown';
        logAuthEvent('idp.signin', 'failure', {
          userId: decision.userId,
          idpId: intent.information.idpId,
          requestId,
          reason,
        });
        throw err;
      }
      logAuthEvent('idp.signin', 'success', {
        userId: decision.userId,
        idpId: intent.information.idpId,
        requestId,
      });
      return redirect(target, { headers: { 'set-cookie': setCookie } });
    }

    case 'link': {
      try {
        await provider.addIdpLink(decision.userId, decision.link);
        const session = await provider.createSession(
          { idpIntent: { idpIntentId: id, idpIntentToken: token } },
          { requestId, orgId: organization, metadata: { userId: decision.userId } }
        );
        const user = await provider.getUser(decision.userId);
        const loginName = user?.loginName ?? intent.information.idpUserName;
        const next = addSession(entries, {
          id: session.id,
          token: session.token,
          loginName,
          organization,
          creationTs: session.changedAt,
          expirationTs: session.expiresAt,
          changeTs: session.changedAt,
          requestId,
        });
        logAuthEvent('idp.link', 'success', {
          userId: decision.userId,
          idpId: decision.link.idpId,
          requestId,
        });
        const target = requestId
          ? `/authorize?requestId=${encodeURIComponent(requestId)}`
          : '/signed-in';
        return redirect(target, { headers: { 'set-cookie': await serializeSessions(next) } });
      } catch (err) {
        if (err instanceof ProviderError) {
          deps.onAuthEvent?.('idp.link', 'failure');
          logAuthEvent('idp.link', 'failure', {
            userId: decision.userId,
            reason: err.code,
            requestId,
          });
          return redirect(`/sso/${slug}/error?reason=${providerErrorCode(err.code)}`);
        }
        throw err; // unknown → root ErrorBoundary (CCD-10)
      }
    }

    case 'register': {
      // register-and-link: redirect to /signup prefilled with IdP draft data + intent params
      // so the signup action can compose register → addIdpLink → createSession.
      const qs = new URLSearchParams({
        idpIntentId: id,
        idpIntentToken: token,
        idpId: decision.link.idpId,
        idpUserId: decision.link.idpUserId,
        idpUserName: decision.link.idpUserName,
      });
      if (decision.draft.email) qs.set('email', decision.draft.email);
      if (decision.draft.firstName) qs.set('firstName', decision.draft.firstName);
      if (decision.draft.lastName) qs.set('lastName', decision.draft.lastName);
      if (requestId) qs.set('requestId', requestId);
      if (organization) qs.set('organization', organization);
      return redirect(`/signup?${qs.toString()}`);
    }

    case 'error': {
      logAuthEvent('idp.link.denied', 'failure', {
        reason: decision.reason,
        idpId: intent.information.idpId,
        requestId,
      });
      return redirect(`/sso/${slug}/error?reason=${decision.reason}`);
    }
  }
}

export default function SsoCallback() {
  return null;
}
