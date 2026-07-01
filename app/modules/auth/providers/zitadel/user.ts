// user capability — findUser, findOrgByDomain, getUser, listAuthMethods, register.
import type { ZitadelCtx } from './context';
import { toAuthMethods, toRegisterRequest, toUser } from './mappers';
import type { RegisterInput } from '@/modules/auth/auth-provider';
import type { AuthMethod, User } from '@/modules/auth/types';
import { create } from '@zitadel/client';
import { TextQueryMethod } from '@zitadel/proto/zitadel/object/v2/object_pb';
import {
  OrganizationService,
  ListOrganizationsRequestSchema,
} from '@zitadel/proto/zitadel/org/v2/org_service_pb';
import { SearchQuerySchema as OrgSearchQuerySchema } from '@zitadel/proto/zitadel/org/v2/query_pb';
import { SearchQuerySchema } from '@zitadel/proto/zitadel/user/v2/query_pb';
import {
  UserService,
  AddHumanUserRequestSchema,
} from '@zitadel/proto/zitadel/user/v2/user_service_pb';

// 755-K1: identifier may be an exact Zitadel loginName (most callers — login/mfa/otp/webauthn
// resolve whatever the user typed) OR a plain email (sso-callback.ts's same-email collision
// check, fed intent.draft.email from the IdP). loginName != email whenever an org's domain policy
// suffixes loginName, so an OR-combined query is required — a loginName-only match would silently
// miss real accounts for the email-based callers, defeating the collision check that guards
// against a duplicate registration reaching Zitadel and failing with ALREADY_EXISTS.
export function findUser(
  ctx: ZitadelCtx,
  identifier: string,
  orgId?: string
): Promise<User | null> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const queries = [
      create(SearchQuerySchema, {
        query: {
          case: 'orQuery',
          value: {
            queries: [
              create(SearchQuerySchema, {
                query: {
                  case: 'loginNameQuery',
                  value: { loginName: identifier, method: TextQueryMethod.EQUALS },
                },
              }),
              create(SearchQuerySchema, {
                query: {
                  case: 'emailQuery',
                  value: { emailAddress: identifier, method: TextQueryMethod.EQUALS },
                },
              }),
            ],
          },
        },
      }),
    ];
    if (orgId) {
      queries.push(
        create(SearchQuerySchema, {
          query: { case: 'organizationIdQuery', value: { organizationId: orgId } },
        })
      );
    }
    const resp = await users.listUsers({ queries });
    const r = resp.result ?? [];
    if (r.length !== 1) return null;
    return toUser(r[0]);
  });
}

export function findOrgByDomain(
  ctx: ZitadelCtx,
  domain: string
): Promise<{ orgId: string } | null> {
  // Domain discovery (settings-gated, default-off). Resolve the org that claims an
  // email domain via OrganizationService.ListOrganizations with a domain-query filter.
  // Proto: zitadel.org.v2.OrganizationService.ListOrganizations
  //   request  ListOrganizationsRequest { queries: SearchQuery[] }
  //   filter   SearchQuery.query = { case: 'domainQuery', value: OrganizationDomainQuery }
  //   query    OrganizationDomainQuery { domain: string; method: TextQueryMethod }
  //   response ListOrganizationsResponse { result: Organization[] }  (Organization.id: string)
  // Unique-match only: 0 or >1 results resolve to null (no ambiguous routing).
  const orgs = ctx.svc(OrganizationService);
  return ctx.call(async () => {
    const req = create(ListOrganizationsRequestSchema, {
      queries: [
        create(OrgSearchQuerySchema, {
          query: {
            case: 'domainQuery',
            value: { domain, method: TextQueryMethod.EQUALS },
          },
        }),
      ],
    });
    const resp = await orgs.listOrganizations(req);
    const result = resp.result ?? [];
    if (result.length !== 1) return null;
    const orgId = result[0].id;
    return orgId ? { orgId } : null;
  });
}

export function getDefaultOrg(ctx: ZitadelCtx): Promise<string | null> {
  // Instance Default Organization lookup (org-first / default-org fallback). Filters
  // OrganizationService.ListOrganizations by the instance defaultQuery and returns the first
  // match's id. Reuses the same OrganizationService client as findOrgByDomain.
  //   filter SearchQuery.query = { case: 'defaultQuery', value: {} }  (OrganizationDefaultQuery)
  //   response ListOrganizationsResponse { result: Organization[] }  (Organization.id: string)
  const orgs = ctx.svc(OrganizationService);
  return ctx.call(async () => {
    const req = create(ListOrganizationsRequestSchema, {
      queries: [
        create(OrgSearchQuerySchema, {
          query: { case: 'defaultQuery', value: {} },
        }),
      ],
    });
    const resp = await orgs.listOrganizations(req);
    const result = resp.result ?? [];
    return result[0]?.id ?? null;
  });
}

export function getUser(ctx: ZitadelCtx, id: string): Promise<User | null> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const resp = await users.getUserByID({ userId: id }, {});
    return resp.user ? toUser(resp.user) : null;
  });
}

export function listAuthMethods(ctx: ZitadelCtx, userId: string): Promise<AuthMethod[]> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const resp = await users.listAuthenticationMethodTypes({ userId });
    return toAuthMethods(resp.authMethodTypes ?? []);
  });
}

export function register(ctx: ZitadelCtx, input: RegisterInput): Promise<User> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const req = create(AddHumanUserRequestSchema, toRegisterRequest(input));
    const resp = await users.addHumanUser(req);
    return {
      id: resp.userId,
      loginName: input.email,
      displayName: `${input.firstName} ${input.lastName}`,
      orgId: resp.details?.resourceOwner,
    };
  });
}
