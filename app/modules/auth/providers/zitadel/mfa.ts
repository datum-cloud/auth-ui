// mfa capability — passkey / u2f / totp / otp registration + verification, plus setMfaInitSkipped (P5).
import type { ZitadelCtx } from './context';
import { normalizeError, timestampToIso } from './mappers';
import type { U2FCreationOptions, WebAuthnCreationOptions } from '@/modules/auth/types';
import type { JsonObject } from '@bufbuild/protobuf';
import { create } from '@zitadel/client';
import { TextFilterMethod } from '@zitadel/proto/zitadel/filter/v2/filter_pb';
import { AuthFactorState } from '@zitadel/proto/zitadel/user/v2/user_pb';
import {
  UserService,
  CreatePasskeyRegistrationLinkRequestSchema,
  ListPasskeysRequestSchema,
  RegisterPasskeyRequestSchema,
  RemovePasskeyRequestSchema,
  VerifyPasskeyRegistrationRequestSchema,
  RegisterU2FRequestSchema,
  VerifyU2FRegistrationRequestSchema,
  RegisterTOTPRequestSchema,
  VerifyTOTPRegistrationRequestSchema,
  AddOTPSMSRequestSchema,
  AddOTPEmailRequestSchema,
  HumanMFAInitSkippedRequestSchema,
  SetUserMetadataRequestSchema,
  ListUserMetadataRequestSchema,
  DeleteUserMetadataRequestSchema,
} from '@zitadel/proto/zitadel/user/v2/user_service_pb';

// Zitadel rejects empty webauthn credential names (PasskeyName / TokenName must be 1–200
// runes; an empty value comes back as [invalid_argument]). Used when a route supplies no
// user-chosen label.
const DEFAULT_PASSKEY_NAME = 'Passkey';
const DEFAULT_SECURITY_KEY_NAME = 'Security key';

// User-metadata key carrying a passkey's enroll time. Written once at verify
// success and never rewritten, so the ENTRY's creationDate (server clock) IS the
// enroll time — the value stores an ISO copy purely as a debugging aid.
const passkeyCreatedKey = (passkeyId: string): string => `passkey:${passkeyId}:created`;

// The proto publicKeyCredentialCreationOptions is a google.protobuf.Struct (JsonObject)
// shaped `{ publicKey: {...} }`. Project it onto the neutral `{ publicKey: unknown }` struct so
// the proto type never crosses the provider boundary; the inner publicKey stays opaque.
function toCreationOptions(raw: JsonObject | undefined): { publicKey: unknown } {
  return {
    publicKey:
      raw !== undefined && raw !== null && typeof raw === 'object' && 'publicKey' in raw
        ? (raw as { publicKey?: unknown }).publicKey
        : raw,
  };
}

export function passkeyRegisterLink(ctx: ZitadelCtx, userId: string): Promise<{ code: string }> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const req = create(CreatePasskeyRegistrationLinkRequestSchema, {
      userId,
      medium: { case: 'returnCode', value: {} },
    });
    const resp = await users.createPasskeyRegistrationLink(req, {});
    // PasskeyRegistrationCode { id: string; code: string } — round-trip both as JSON
    const c = resp.code;
    return { code: c ? JSON.stringify({ id: c.id, code: c.code }) : '' };
  });
}

export function registerPasskey(
  ctx: ZitadelCtx,
  userId: string,
  code: string,
  domain: string
): Promise<WebAuthnCreationOptions> {
  // Narrows the raw proto Struct into the neutral WebAuthnCreationOptions; routes
  // treat the inner publicKey value as opaque.
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    // Decode the opaque code string produced by passkeyRegisterLink.
    let parsed: { id?: string; code?: string };
    try {
      parsed = JSON.parse(code) as { id?: string; code?: string };
    } catch {
      throw normalizeError({
        message:
          'malformed passkey registration code (expected JSON envelope from passkeyRegisterLink)',
      });
    }
    const req = create(RegisterPasskeyRequestSchema, {
      userId,
      domain,
      ...(parsed.id && parsed.code ? { code: { id: parsed.id, code: parsed.code } } : {}),
    });
    const resp = await users.registerPasskey(req, {});
    return {
      passkeyId: resp.passkeyId,
      publicKeyCredentialCreationOptions: toCreationOptions(
        resp.publicKeyCredentialCreationOptions
      ),
    };
  });
}

export async function verifyPasskey(
  ctx: ZitadelCtx,
  userId: string,
  passkeyId: string,
  cred: unknown,
  passkeyName?: string
): Promise<void> {
  // cred is the PublicKeyCredential JSON from the browser WebAuthn API (JsonObject).
  // Zitadel requires PasskeyName to be 1–200 runes — an empty value is rejected with
  // [invalid_argument] (surfaced to us as INVALID_CREDENTIALS). Routes may pass a
  // user-supplied label; otherwise fall back to a non-empty default.
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(VerifyPasskeyRegistrationRequestSchema, {
      userId,
      passkeyId,
      publicKeyCredential: cred as JsonObject,
      passkeyName: passkeyName?.trim() || DEFAULT_PASSKEY_NAME,
    });
    await users.verifyPasskeyRegistration(req, {});
  });
  // Best-effort created-at stamp — enrollment NEVER fails because of metadata
  // (parity with the AAGUID silent-fallback rule). Own call scope, own swallow.
  try {
    await ctx.call(async () => {
      const req = create(SetUserMetadataRequestSchema, {
        userId,
        metadata: [
          {
            key: passkeyCreatedKey(passkeyId),
            value: new TextEncoder().encode(new Date().toISOString()),
          },
        ],
      });
      await users.setUserMetadata(req, {});
    });
  } catch {
    // Swallowed: the passkey simply renders without a date.
  }
}

// Passkey inventory for the /id/passkeys management page.
// Joined with the created-at user-metadata keys; the entry's creationDate
// (server clock) is the date source, the stored value is never read.
export async function listPasskeys(
  ctx: ZitadelCtx,
  userId: string
): Promise<Array<{ id: string; state: 'active' | 'inactive'; name: string; createdAt?: string }>> {
  const users = ctx.svc(UserService);
  // The metadata join runs CONCURRENTLY in its OWN call scope (own deadline) and is
  // caught to null on ANY failure — a slow or erroring metadata backend degrades to
  // date-less rows and can never fail or outlast the passkey list itself.
  const metaPromise = ctx
    .call(() =>
      users.listUserMetadata(
        create(ListUserMetadataRequestSchema, {
          userId,
          filters: [
            {
              filter: {
                case: 'keyFilter',
                value: { key: 'passkey:', method: TextFilterMethod.STARTS_WITH },
              },
            },
          ],
        }),
        {}
      )
    )
    .catch(() => null);
  const resp = await ctx.call(() =>
    users.listPasskeys(create(ListPasskeysRequestSchema, { userId }), {})
  );
  const meta = await metaPromise;
  const createdByKey = new Map(
    (meta?.metadata ?? []).map((m) => [m.key, timestampToIso(m.creationDate, null)])
  );
  // Passkey { id, state: AuthFactorState, name } — READY is the only 'active' state.
  return (resp.result ?? []).map((p) => {
    const createdAt = createdByKey.get(passkeyCreatedKey(p.id));
    return {
      id: p.id,
      state: p.state === AuthFactorState.READY ? ('active' as const) : ('inactive' as const),
      name: p.name,
      ...(createdAt ? { createdAt } : {}),
    };
  });
}

// Errors flow through ctx.call normalization; NOT_FOUND is mapped to idempotent
// success by the passkeys service (removal race), not here.
export async function removePasskey(
  ctx: ZitadelCtx,
  userId: string,
  passkeyId: string
): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(RemovePasskeyRequestSchema, { userId, passkeyId });
    await users.removePasskey(req, {});
  });
  // Best-effort cleanup of the created-at key — never blocks the removal result.
  try {
    await ctx.call(async () => {
      const req = create(DeleteUserMetadataRequestSchema, {
        userId,
        keys: [passkeyCreatedKey(passkeyId)],
      });
      await users.deleteUserMetadata(req, {});
    });
  } catch {
    // Swallowed: an orphaned key is dropped by the listPasskeys join anyway.
  }
}

export function registerU2F(
  ctx: ZitadelCtx,
  userId: string,
  domain: string
): Promise<U2FCreationOptions> {
  // Narrows the raw proto Struct into the neutral U2FCreationOptions (U2F analogue).
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const req = create(RegisterU2FRequestSchema, { userId, domain });
    const resp = await users.registerU2F(req, {});
    return {
      u2fId: resp.u2fId,
      publicKeyCredentialCreationOptions: toCreationOptions(
        resp.publicKeyCredentialCreationOptions
      ),
    };
  });
}

export async function verifyU2F(ctx: ZitadelCtx, userId: string, cred: unknown): Promise<void> {
  // cred must include { u2fId, publicKeyCredential, tokenName? } — supplied by the route
  // after the browser WebAuthn ceremony completes.
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const c = cred as { u2fId?: string; publicKeyCredential?: unknown; tokenName?: string };
    const req = create(VerifyU2FRegistrationRequestSchema, {
      userId,
      u2fId: c.u2fId ?? '',
      publicKeyCredential: c.publicKeyCredential as JsonObject,
      // Zitadel requires TokenName 1–200 runes — fall back to a non-empty default.
      tokenName: c.tokenName?.trim() || DEFAULT_SECURITY_KEY_NAME,
    });
    await users.verifyU2FRegistration(req, {});
  });
}

export function registerTotp(
  ctx: ZitadelCtx,
  userId: string
): Promise<{ uri: string; secret: string }> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const req = create(RegisterTOTPRequestSchema, { userId });
    const resp = await users.registerTOTP(req, {});
    return { uri: resp.uri, secret: resp.secret };
  });
}

export async function verifyTotp(ctx: ZitadelCtx, userId: string, code: string): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(VerifyTOTPRegistrationRequestSchema, { userId, code });
    await users.verifyTOTPRegistration(req, {});
  });
}

export async function addOtpEmail(ctx: ZitadelCtx, userId: string): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(AddOTPEmailRequestSchema, { userId });
    await users.addOTPEmail(req, {});
  });
}

export async function addOtpSms(ctx: ZitadelCtx, userId: string): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(AddOTPSMSRequestSchema, { userId });
    await users.addOTPSMS(req, {});
  });
}

export async function setMfaInitSkipped(ctx: ZitadelCtx, userId: string): Promise<void> {
  // Proto RPC: UserService.HumanMFAInitSkipped (humanMFAInitSkipped on the generated client)
  // Request: HumanMFAInitSkippedRequest { userId: string }
  // Writes the skip timestamp on the human user, surfaced back as User.mfaInitSkippedAt via toUser().
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(HumanMFAInitSkippedRequestSchema, { userId });
    await users.humanMFAInitSkipped(req, {});
  });
}
