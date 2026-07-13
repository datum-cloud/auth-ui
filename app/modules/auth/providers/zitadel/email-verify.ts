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

export async function resendEmailCode(
  ctx: ZitadelCtx,
  userId: string,
  urlTemplate: string
): Promise<void> {
  // For standard email verification resend: uses resendEmailCode RPC.
  // NOTE: if the user was created via an invite flow, re-sending the invite
  // requires the createInviteCode RPC instead (route-flagged — Phase 3+).
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
