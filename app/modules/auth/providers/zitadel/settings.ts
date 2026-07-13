// settings capability — login settings, branding, password complexity, legal/support, active IdPs.
import type { ZitadelCtx } from './context';
import { toBranding, toIdProvider, toLoginSettings, toPasswordComplexity } from './mappers';
import type {
  BrandingTheme,
  IdProvider,
  LoginSettings,
  PasswordComplexity,
} from '@/modules/auth/types';
import { makeReqCtx } from '@zitadel/client/v2';
import { SettingsService } from '@zitadel/proto/zitadel/settings/v2/settings_service_pb';

export function getLoginSettings(ctx: ZitadelCtx, orgId?: string): Promise<LoginSettings> {
  const settings = ctx.svc(SettingsService);
  return ctx.call(async () => {
    const resp = await settings.getLoginSettings({ ctx: makeReqCtx(orgId) }, {});
    return toLoginSettings((resp.settings ?? {}) as Record<string, unknown>);
  });
}

export function getBranding(ctx: ZitadelCtx, orgId?: string): Promise<BrandingTheme> {
  const settings = ctx.svc(SettingsService);
  return ctx.call(async () => {
    const resp = await settings.getBrandingSettings({ ctx: makeReqCtx(orgId) }, {});
    return toBranding((resp.settings ?? {}) as Record<string, unknown>);
  });
}

export function getPasswordComplexity(
  ctx: ZitadelCtx,
  orgId?: string
): Promise<PasswordComplexity | undefined> {
  const settings = ctx.svc(SettingsService);
  return ctx.call(async () => {
    const resp = await settings.getPasswordComplexitySettings({ ctx: makeReqCtx(orgId) });
    // resp.settings.minLength is uint64 → bigint; coerce to number so the result
    // is JSON-serialisable and safe for React rendering (P5 spec-review fix).
    return resp.settings ? toPasswordComplexity(resp.settings) : undefined;
  });
}

// getLegalSupport removed — it had zero callers (dead port method).

export function getActiveIdPs(ctx: ZitadelCtx, orgId?: string): Promise<IdProvider[]> {
  const settings = ctx.svc(SettingsService);
  return ctx.call(async () => {
    const resp = await settings.getActiveIdentityProviders({ ctx: makeReqCtx(orgId) });
    return (resp.identityProviders ?? []).map(toIdProvider);
  });
}
