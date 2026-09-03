// email-verify capability — sendEmailCode, verifyEmail, verifyInvite, resendEmailCode, markEmailVerified.
import type { ZitadelCtx } from './context';
import { ProviderError } from '@/modules/auth/types';
import { create } from '@zitadel/client';
import {
  UserService,
  SendEmailCodeRequestSchema,
  ResendEmailCodeRequestSchema,
  VerifyEmailRequestSchema,
  VerifyInviteCodeRequestSchema,
} from '@zitadel/proto/zitadel/user/v2/user_service_pb';

export async function sendEmailCode(
  ctx: ZitadelCtx,
  userId: string,
  urlTemplate: string
): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(SendEmailCodeRequestSchema, {
      userId,
      verification: {
        case: 'sendCode',
        value: { urlTemplate },
      },
    });
    await users.sendEmailCode(req);
  });
}

export async function verifyEmail(ctx: ZitadelCtx, userId: string, code: string): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(VerifyEmailRequestSchema, { userId, verificationCode: code });
    await users.verifyEmail(req);
  });
}

export async function verifyInvite(ctx: ZitadelCtx, userId: string, code: string): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(VerifyInviteCodeRequestSchema, { userId, verificationCode: code });
    await users.verifyInviteCode(req);
  });
}

// Standard email verification resend, provider-sent mail (sendCode delivery): uses the
// resendEmailCode RPC with a urlTemplate so Zitadel emails a link back to OUR /verify route.
// Renamed from `resendEmailCode` so that name is free for the returnCode-delivery variant
// below — this function's own behavior and signature are unchanged, and its only caller
// (index.ts's AuthProvider.resendEmailCode, consumed by app/resources/verify/verify.service.ts's
// manual resend flow) was updated to match.
// NOTE: if the user was created via an invite flow, re-sending the invite
// requires the createInviteCode RPC instead (route-flagged — Phase 3+).
export async function resendEmailCodeWithUrl(
  ctx: ZitadelCtx,
  userId: string,
  urlTemplate: string
): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(ResendEmailCodeRequestSchema, {
      userId,
      verification: {
        case: 'sendCode',
        value: { urlTemplate },
      },
    });
    await users.resendEmailCode(req);
  });
}

// Email verification resend, returnCode delivery: Zitadel does NOT send mail — it returns
// the plaintext code on the response (ResendEmailCodeResponse.verificationCode) so the
// caller can deliver it through its own pipeline instead.
//
// Same underlying zitadel.user.v2.UserService.ResendEmailCode RPC as resendEmailCodeWithUrl
// above (just the `returnCode` oneof case instead of `sendCode`) — verified against the
// installed @zitadel/proto 1.3.1 types, which mirror the manually-verified REST endpoint
// `POST /v2/users/{id}/email/resend` with `{"returnCode":{}}` -> `verificationCode` exactly
// (NOT the 404 `/email/_resend` underscore form). No raw fetch needed: the existing
// connect-client RPC call reaches the identical server-side operation.
//
// SECURITY: the returned code is a bearer credential — never log it.
export async function resendEmailCode(ctx: ZitadelCtx, userId: string): Promise<string> {
  const users = ctx.svc(UserService);
  return ctx.call(async () => {
    const req = create(ResendEmailCodeRequestSchema, {
      userId,
      verification: { case: 'returnCode', value: {} },
    });
    const resp = await users.resendEmailCode(req);
    const code = resp.verificationCode;
    if (!code) {
      throw new ProviderError(
        'FAILED_PRECONDITION',
        'resendEmailCode: Zitadel did not return a verification code'
      );
    }
    return code;
  });
}

export async function markEmailVerified(ctx: ZitadelCtx, userId: string): Promise<void> {
  // Two-step verify: request a returnCode email-verification code (no email sent),
  // then immediately call verifyEmail with it.
  // Background: setEmail with isVerified throws FAILED_PRECONDITION ("Email not changed")
  // when the email address is already set to the same value on the account — which is
  // always true on the auto-link path. The returnCode approach works regardless.
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const codeReq = create(SendEmailCodeRequestSchema, {
      userId,
      verification: { case: 'returnCode', value: {} },
    });
    const codeResp = await users.sendEmailCode(codeReq);
    const code = codeResp.verificationCode;
    if (!code) {
      throw new ProviderError(
        'FAILED_PRECONDITION',
        'markEmailVerified: Zitadel did not return a verification code'
      );
    }
    const verifyReq = create(VerifyEmailRequestSchema, { userId, verificationCode: code });
    await users.verifyEmail(verifyReq);
  });
}
