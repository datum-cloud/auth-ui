// password capability — sendPasswordReset, setPasswordWithCode, changePasswordWithSession.
import type { ZitadelCtx } from './context';
import { normalizeError, toSetPasswordWithCodeRequest } from './mappers';
import { getSession } from './session';
import { createServiceClient } from './transport';
import { create } from '@zitadel/client';
import {
  UserService,
  PasswordResetRequestSchema,
  SetPasswordRequestSchema,
} from '@zitadel/proto/zitadel/user/v2/user_service_pb';

export async function sendPasswordReset(
  ctx: ZitadelCtx,
  userId: string,
  urlTemplate: string
): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(PasswordResetRequestSchema, {
      userId,
      medium: {
        case: 'sendLink',
        value: { urlTemplate },
      },
    });
    await users.passwordReset(req);
  });
}

export async function setPasswordWithCode(
  ctx: ZitadelCtx,
  userId: string,
  code: string,
  password: string
): Promise<void> {
  const users = ctx.svc(UserService);
  await ctx.call(async () => {
    const req = create(
      SetPasswordRequestSchema,
      toSetPasswordWithCodeRequest(userId, code, password)
    );
    await users.setPassword(req);
  });
}

export async function changePasswordWithSession(
  ctx: ZitadelCtx,
  sessionId: string,
  token: string,
  password: string
): Promise<void> {
  // Self-service password change: the request must be authorised with the SESSION token,
  // not the service token, so the user's own identity is authenticated. We build a
  // UserService client carrying the session token (not ctx.opts.serviceToken).
  // Boundary note: this is the ONLY method that creates a session-token-authed client;
  // all other methods use the service (PAT) token via ctx.svc().
  const session = await getSession(ctx, sessionId, token);
  if (!session?.user?.id) {
    throw normalizeError({ code: 5, message: 'Session user not found' });
  }
  const sessionUsers = createServiceClient(
    UserService,
    token, // session token — self-service auth
    ctx.opts.serviceUrl,
    ctx.opts.env
  );
  await ctx.call(async () => {
    const req = create(SetPasswordRequestSchema, {
      userId: session.user!.id,
      newPassword: { password, changeRequired: false },
      // No verificationCode — self-service with a valid session token
      verification: { case: undefined },
    });
    await sessionUsers.setPassword(req);
  });
}
