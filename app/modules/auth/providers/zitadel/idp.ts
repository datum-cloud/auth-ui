// idp capability — startIdpIntent, retrieveIdpIntent, listIdpLinks, addIdpLink, removeIdpLink,
// startLdapIntent (P4/P6 external-IdP + LDAP intent operations).
import type { ZitadelCtx } from './context';
import { toIdpIntentResult, toIdpLink, toIdpLinkRequest } from './mappers';
import type { IdpIntentResult, IdpLink, LdapIntent } from '@/modules/auth/types';
import { ProviderError } from '@/modules/auth/types';
import { create } from '@zitadel/client';
import { LDAPCredentialsSchema } from '@zitadel/proto/zitadel/user/v2/idp_pb';
import { IDPLinkSchema, RedirectURLsSchema } from '@zitadel/proto/zitadel/user/v2/idp_pb';
import {
  UserService,
  AddIDPLinkRequestSchema,
  ListIDPLinksRequestSchema,
  RemoveIDPLinkRequestSchema,
  StartIdentityProviderIntentRequestSchema,
  RetrieveIdentityProviderIntentRequestSchema,
} from '@zitadel/proto/zitadel/user/v2/user_service_pb';

export function startIdpIntent(
  ctx: ZitadelCtx,
  idpId: string,
  urls: { success: string; failure: string }
): Promise<{ authUrl?: string; formData?: unknown }> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const req = create(StartIdentityProviderIntentRequestSchema, {
      idpId,
      content: {
        case: 'urls',
        value: create(RedirectURLsSchema, {
          successUrl: urls.success,
          failureUrl: urls.failure,
        }),
      },
    });
    const resp = await users.startIdentityProviderIntent(req);
    // nextStep oneof: authUrl (OAuth/OIDC), idpIntent (LDAP/already-linked), formData (SAML Phase 6)
    if (resp.nextStep.case === 'authUrl') {
      return { authUrl: resp.nextStep.value };
    }
    if (resp.nextStep.case === 'formData') {
      return { formData: resp.nextStep.value };
    }
    // idpIntent case: LDAP or auto-completed — return empty (caller checks intent id)
    return {};
  });
}

export function retrieveIdpIntent(
  ctx: ZitadelCtx,
  idpIntentId: string,
  token: string
): Promise<IdpIntentResult> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const req = create(RetrieveIdentityProviderIntentRequestSchema, {
      idpIntentId,
      idpIntentToken: token,
    });
    const resp = await users.retrieveIdentityProviderIntent(req);
    return toIdpIntentResult(resp);
  });
}

export function listIdpLinks(ctx: ZitadelCtx, userId: string): Promise<IdpLink[]> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const req = create(ListIDPLinksRequestSchema, { userId });
    const resp = await users.listIDPLinks(req);
    // Map proto IDPLink entries to neutral IdpLink shape (field names differ).
    return (resp.result ?? []).map(toIdpLink);
  });
}

export async function addIdpLink(ctx: ZitadelCtx, userId: string, link: IdpLink): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const idpLink = create(IDPLinkSchema, toIdpLinkRequest(link));
    const req = create(AddIDPLinkRequestSchema, { userId, idpLink });
    await users.addIDPLink(req);
  });
}

export async function removeIdpLink(
  ctx: ZitadelCtx,
  userId: string,
  idpId: string,
  linkedUserId: string
): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(RemoveIDPLinkRequestSchema, { userId, idpId, linkedUserId });
    await users.removeIDPLink(req);
  });
}

export function startLdapIntent(
  ctx: ZitadelCtx,
  idpId: string,
  username: string,
  password: string
): Promise<LdapIntent> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const req = create(StartIdentityProviderIntentRequestSchema, {
      idpId,
      content: {
        case: 'ldap',
        value: create(LDAPCredentialsSchema, { username, password }),
      },
    });
    const resp = await users.startIdentityProviderIntent(req);
    if (resp.nextStep.case !== 'idpIntent' || !resp.nextStep.value) {
      throw new ProviderError('INVALID_CREDENTIALS', 'LDAP authentication failed');
    }
    const { idpIntentId, idpIntentToken, userId } = resp.nextStep.value;
    return { userId, idpIntentId, idpIntentToken };
  });
}
