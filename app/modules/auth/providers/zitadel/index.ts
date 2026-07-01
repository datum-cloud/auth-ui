// ZitadelAuthProvider — the AuthProvider port adapter for Zitadel.
//
// This file is a THIN composition root. It owns `opts` + the shared execution context
// (svc/call — see ./context) and delegates each AuthProvider method to a free function in
// the relevant capability module (settings / user / password / email-verify / session / mfa /
// idp / auth-request / admin). The method signatures and behaviour are identical to the former
// monolith; only the file boundaries moved (pure-internal decomposition).
import * as admin from './admin';
import * as authRequest from './auth-request';
import { createZitadelCtx, type ZitadelCtx, type ZitadelOpts } from './context';
import * as emailVerify from './email-verify';
import * as idp from './idp';
import * as mfa from './mfa';
import * as password from './password';
import * as session from './session';
import * as settings from './settings';
import * as user from './user';
import type {
  AuthProvider,
  RegisterInput,
  SessionChecks,
  SessionOpts,
} from '@/modules/auth/auth-provider';
import type {
  AuthMethod,
  AuthRequest,
  BrandingTheme,
  DeviceAuthRequest,
  IdProvider,
  IdpIntentResult,
  IdpLink,
  LdapIntent,
  LoginSettings,
  PasswordComplexity,
  ProviderCapabilities,
  SamlResponse,
  Session,
  U2FCreationOptions,
  User,
  WebAuthnCreationOptions,
} from '@/modules/auth/types';

// Public re-export: the composition root resolves the request's service URL via the
// package's PUBLIC entry (no deep import into providers/zitadel/transport).
export { resolveServiceUrl } from '@/modules/auth/providers/zitadel/transport';
// Public re-export: ZitadelOpts is part of the adapter's constructor surface.
export type { ZitadelOpts } from './context';

export class ZitadelAuthProvider implements AuthProvider {
  readonly capabilities: ProviderCapabilities = {
    passkey: true,
    u2f: true,
    totpOtp: true,
    emailOtp: true,
    smsOtp: true,
    externalIdp: true,
    ldap: true,
    saml: true,
    oidc: true,
    registration: true,
  };
  private readonly ctx: ZitadelCtx;
  constructor(opts: ZitadelOpts) {
    this.ctx = createZitadelCtx(opts);
  }

  // settings
  getLoginSettings(orgId?: string): Promise<LoginSettings> {
    return settings.getLoginSettings(this.ctx, orgId);
  }
  getBranding(orgId?: string): Promise<BrandingTheme> {
    return settings.getBranding(this.ctx, orgId);
  }
  getPasswordComplexity(orgId?: string): Promise<PasswordComplexity | undefined> {
    return settings.getPasswordComplexity(this.ctx, orgId);
  }
  getActiveIdPs(orgId?: string): Promise<IdProvider[]> {
    return settings.getActiveIdPs(this.ctx, orgId);
  }
  getDefaultOrg(): Promise<string | null> {
    return user.getDefaultOrg(this.ctx);
  }

  // users
  findUser(identifier: string, orgId?: string): Promise<User | null> {
    return user.findUser(this.ctx, identifier, orgId);
  }
  findOrgByDomain(domain: string): Promise<{ orgId: string } | null> {
    return user.findOrgByDomain(this.ctx, domain);
  }
  getUser(id: string): Promise<User | null> {
    return user.getUser(this.ctx, id);
  }
  listAuthMethods(userId: string): Promise<AuthMethod[]> {
    return user.listAuthMethods(this.ctx, userId);
  }
  register(input: RegisterInput): Promise<User> {
    return user.register(this.ctx, input);
  }

  // password
  sendPasswordReset(userId: string, urlTemplate: string): Promise<void> {
    return password.sendPasswordReset(this.ctx, userId, urlTemplate);
  }
  setPasswordWithCode(userId: string, code: string, pw: string): Promise<void> {
    return password.setPasswordWithCode(this.ctx, userId, code, pw);
  }
  changePasswordWithSession(sessionId: string, token: string, pw: string): Promise<void> {
    return password.changePasswordWithSession(this.ctx, sessionId, token, pw);
  }

  // verification
  sendEmailCode(userId: string, urlTemplate: string): Promise<void> {
    return emailVerify.sendEmailCode(this.ctx, userId, urlTemplate);
  }
  verifyEmail(userId: string, code: string): Promise<void> {
    return emailVerify.verifyEmail(this.ctx, userId, code);
  }
  verifyInvite(userId: string, code: string): Promise<void> {
    return emailVerify.verifyInvite(this.ctx, userId, code);
  }
  resendEmailCode(userId: string, urlTemplate: string): Promise<void> {
    return emailVerify.resendEmailCode(this.ctx, userId, urlTemplate);
  }
  markEmailVerified(userId: string): Promise<void> {
    return emailVerify.markEmailVerified(this.ctx, userId);
  }

  // session
  createSession(checks: SessionChecks, opts?: SessionOpts): Promise<Session> {
    return session.createSession(this.ctx, checks, opts);
  }
  getSession(id: string, token: string): Promise<Session | null> {
    return session.getSession(this.ctx, id, token);
  }
  updateSession(id: string, token: string, checks: SessionChecks): Promise<Session> {
    return session.updateSession(this.ctx, id, token, checks);
  }
  deleteSession(id: string, token: string): Promise<void> {
    return session.deleteSession(this.ctx, id, token);
  }
  listSessions(ids: string[]): Promise<Session[]> {
    return session.listSessions(this.ctx, ids);
  }

  // passkey / u2f / totp / otp (P5)
  passkeyRegisterLink(userId: string): Promise<{ code: string }> {
    return mfa.passkeyRegisterLink(this.ctx, userId);
  }
  registerPasskey(userId: string, code: string, domain: string): Promise<WebAuthnCreationOptions> {
    return mfa.registerPasskey(this.ctx, userId, code, domain);
  }
  verifyPasskey(
    userId: string,
    passkeyId: string,
    cred: unknown,
    passkeyName?: string
  ): Promise<void> {
    return mfa.verifyPasskey(this.ctx, userId, passkeyId, cred, passkeyName);
  }
  registerU2F(userId: string, domain: string): Promise<U2FCreationOptions> {
    return mfa.registerU2F(this.ctx, userId, domain);
  }
  verifyU2F(userId: string, cred: unknown): Promise<void> {
    return mfa.verifyU2F(this.ctx, userId, cred);
  }
  registerTotp(userId: string): Promise<{ uri: string; secret: string }> {
    return mfa.registerTotp(this.ctx, userId);
  }
  verifyTotp(userId: string, code: string): Promise<void> {
    return mfa.verifyTotp(this.ctx, userId, code);
  }
  addOtpEmail(userId: string): Promise<void> {
    return mfa.addOtpEmail(this.ctx, userId);
  }
  addOtpSms(userId: string): Promise<void> {
    return mfa.addOtpSms(this.ctx, userId);
  }
  setMfaInitSkipped(userId: string): Promise<void> {
    return mfa.setMfaInitSkipped(this.ctx, userId);
  }

  // external idp (P4) + ldap (P6)
  startIdpIntent(
    idpId: string,
    urls: { success: string; failure: string }
  ): Promise<{ authUrl?: string; formData?: unknown }> {
    return idp.startIdpIntent(this.ctx, idpId, urls);
  }
  retrieveIdpIntent(idpIntentId: string, token: string): Promise<IdpIntentResult> {
    return idp.retrieveIdpIntent(this.ctx, idpIntentId, token);
  }
  listIdpLinks(userId: string): Promise<IdpLink[]> {
    return idp.listIdpLinks(this.ctx, userId);
  }
  addIdpLink(userId: string, link: IdpLink): Promise<void> {
    return idp.addIdpLink(this.ctx, userId, link);
  }
  removeIdpLink(userId: string, idpId: string, linkedUserId: string): Promise<void> {
    return idp.removeIdpLink(this.ctx, userId, idpId, linkedUserId);
  }
  startLdapIntent(idpId: string, username: string, pw: string): Promise<LdapIntent> {
    return idp.startLdapIntent(this.ctx, idpId, username, pw);
  }

  // protocol (oidc / saml) + device grant (P6)
  getAuthRequest(kind: 'oidc' | 'saml', requestId: string): Promise<AuthRequest> {
    return authRequest.getAuthRequest(this.ctx, kind, requestId);
  }
  createCallback(
    authRequestId: string,
    sess: { id: string; token: string }
  ): Promise<{ callbackUrl: string }> {
    return authRequest.createCallback(this.ctx, authRequestId, sess);
  }
  getDeviceAuth(userCode: string): Promise<DeviceAuthRequest> {
    return authRequest.getDeviceAuth(this.ctx, userCode);
  }
  authorizeDevice(
    deviceAuthId: string,
    decision: { session?: { id: string; token: string } }
  ): Promise<void> {
    return authRequest.authorizeDevice(this.ctx, deviceAuthId, decision);
  }
  createSamlResponse(
    samlRequestId: string,
    sess: { id: string; token: string }
  ): Promise<SamlResponse> {
    return authRequest.createSamlResponse(this.ctx, samlRequestId, sess);
  }

  // admin routing
  isInstanceAdmin(sess: { id: string; token: string }): Promise<boolean> {
    return admin.isInstanceAdmin(this.ctx, sess);
  }
}
