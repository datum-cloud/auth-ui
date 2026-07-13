// auth-request capability — OIDC/SAML protocol + device grant:
// getAuthRequest, createCallback, getDeviceAuth, authorizeDevice, createSamlResponse.
import type { ZitadelCtx } from './context';
import {
  normalizeError,
  toAuthRequest,
  toDeviceAuthRequest,
  toSamlAuthRequest,
  toSamlResponse,
} from './mappers';
import type { AuthRequest, DeviceAuthRequest, SamlResponse } from '@/modules/auth/types';
import { create } from '@zitadel/client';
import {
  AuthorizeOrDenyDeviceAuthorizationRequestSchema,
  CreateCallbackRequestSchema,
  DenySchema,
  OIDCService,
  SessionSchema as OidcSessionSchema,
} from '@zitadel/proto/zitadel/oidc/v2/oidc_service_pb';
import {
  CreateResponseRequestSchema,
  SAMLService,
  SessionSchema as SamlSessionSchema,
} from '@zitadel/proto/zitadel/saml/v2/saml_service_pb';

export function getAuthRequest(
  ctx: ZitadelCtx,
  kind: 'oidc' | 'saml',
  requestId: string
): Promise<AuthRequest> {
  if (kind === 'saml') {
    const saml = ctx.svc(SAMLService);
    return ctx.call(async () => {
      const { samlRequest } = await saml.getSAMLRequest({ samlRequestId: requestId });
      // empty id (proto3 default) is as good as missing — treat both as not found
      if (!samlRequest?.id) throw normalizeError({ code: 5, message: 'SAML request not found' });
      return toSamlAuthRequest(samlRequest);
    });
  }
  const oidc = ctx.svc(OIDCService);
  return ctx.call(async () => {
    const resp = await oidc.getAuthRequest({ authRequestId: requestId });
    if (!resp.authRequest) throw normalizeError({ code: 5, message: 'Auth request not found' });
    return toAuthRequest(resp.authRequest);
  });
}

export function createCallback(
  ctx: ZitadelCtx,
  authRequestId: string,
  session: { id: string; token: string }
): Promise<{ callbackUrl: string }> {
  const oidc = ctx.svc(OIDCService);
  return ctx.call(async () => {
    const req = create(CreateCallbackRequestSchema, {
      authRequestId,
      callbackKind: {
        case: 'session',
        value: create(OidcSessionSchema, { sessionId: session.id, sessionToken: session.token }),
      },
    });
    const resp = await oidc.createCallback(req);
    if (!resp.callbackUrl) throw normalizeError({ code: 5, message: 'Callback URL missing' });
    return { callbackUrl: resp.callbackUrl };
  });
}

export function getDeviceAuth(ctx: ZitadelCtx, userCode: string): Promise<DeviceAuthRequest> {
  const oidc = ctx.svc(OIDCService);
  return ctx.call(async () => {
    const { deviceAuthorizationRequest } = await oidc.getDeviceAuthorizationRequest({ userCode });
    if (!deviceAuthorizationRequest)
      throw normalizeError({ code: 5, message: 'device authorization request not found' });
    return toDeviceAuthRequest(deviceAuthorizationRequest);
  });
}

export async function authorizeDevice(
  ctx: ZitadelCtx,
  deviceAuthId: string,
  decision: { session?: { id: string; token: string } }
): Promise<void> {
  const oidc = ctx.svc(OIDCService);
  await ctx.call(async () => {
    const req = create(AuthorizeOrDenyDeviceAuthorizationRequestSchema, {
      deviceAuthorizationId: deviceAuthId,
      decision: decision.session
        ? {
            case: 'session',
            value: create(OidcSessionSchema, {
              sessionId: decision.session.id,
              sessionToken: decision.session.token,
            }),
          }
        : { case: 'deny', value: create(DenySchema, {}) },
    });
    await oidc.authorizeOrDenyDeviceAuthorization(req);
  });
}

export function createSamlResponse(
  ctx: ZitadelCtx,
  samlRequestId: string,
  session: { id: string; token: string }
): Promise<SamlResponse> {
  const saml = ctx.svc(SAMLService);
  return ctx.call(async () => {
    const resp = await saml.createResponse(
      create(CreateResponseRequestSchema, {
        samlRequestId,
        responseKind: {
          case: 'session',
          value: create(SamlSessionSchema, {
            sessionId: session.id,
            sessionToken: session.token,
          }),
        },
      })
    );
    return toSamlResponse({ url: resp.url, binding: resp.binding });
  });
}
