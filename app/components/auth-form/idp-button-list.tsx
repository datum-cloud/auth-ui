import { AuthFormFields } from '@/components/auth-form/auth-form-fields';
import { LastUsedBadge } from '@/components/auth-form/last-used-badge';
import { ThemedImage } from '@/components/themed-image/themed-image';
import type { IdProvider } from '@/modules/auth/types';
import { readMaxMindTrackingToken } from '@/modules/fraud/maxmind-tracker';
import { assetUrl, darkAssetUrl } from '@/utils/asset-url';
import { Button } from '@datum-cloud/datum-ui/button';
import { cn } from '@datum-cloud/datum-ui/utils';
import { Trans } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { Form as RRForm } from 'react-router';

// The IdP sign-in/sign-up button list shared by /login and /signup: one POST form per
// IdP carrying the csrf + ceremony identity inputs, intent=idp, and the idp id. The two
// call-site deltas are cleanly optional props:
//   - `relative`     — login adds `relative` to the button (anchors the LastUsedBadge)
//   - `lastUsedLogin`— when provided, renders the "Last used" badge on the matching IdP
export interface IdpButtonListProps {
  idps: IdProvider[];
  csrf: string;
  requestId?: string;
  organization?: string;
  submittingIdpId: string | null;
  relative?: boolean;
  lastUsedLogin?: string | null;
  /** Force-disable every row regardless of submittingIdpId (e.g. a sibling ceremony is busy). */
  disabled?: boolean;
}

export function IdpButtonList({
  idps,
  csrf,
  requestId,
  organization,
  submittingIdpId,
  relative = false,
  lastUsedLogin,
  disabled = false,
}: IdpButtonListProps): React.JSX.Element {
  // MaxMind mirrors the captured device-fingerprint token into sessionStorage asynchronously
  // (see modules/fraud/maxmind-tracker) — read it client-side only (post-mount) so SSR and the
  // hydration render both start without the field, avoiding a hydration mismatch. Threaded onto
  // the IdP start form so the callback can attach it to the resulting session's metadata.
  const [deviceTrackingToken, setDeviceTrackingToken] = useState<string | undefined>(undefined);
  useEffect(() => {
    setDeviceTrackingToken(readMaxMindTrackingToken());
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {idps.map((idp) => {
        const mark = `/images/idps/${idp.name.toLowerCase().replace(/\s+/g, '-')}.png`;
        return (
          <RRForm key={idp.id} method="post">
            <AuthFormFields csrf={csrf} requestId={requestId} organization={organization} />
            <input type="hidden" name="intent" value="idp" />
            <input type="hidden" name="idpId" value={idp.id} />
            {deviceTrackingToken && (
              <input type="hidden" name="deviceTrackingToken" value={deviceTrackingToken} />
            )}
            <Button
              size="large"
              className={cn(relative && 'relative', 'h-13 gap-3')}
              type="quaternary"
              theme="outline"
              block
              htmlType="submit"
              loading={submittingIdpId === idp.id}
              disabled={disabled}
              iconPosition="left"
              icon={
                // Span wrapper keeps the Button's `icon` slot a single element; the optimistic
                // `dark` source (<provider>.dark.png) auto-activates when it ships, else falls
                // back to the light mark.
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <ThemedImage
                    light={assetUrl(mark)}
                    dark={darkAssetUrl(mark)}
                    alt=""
                    aria-hidden="true"
                    className="size-4 object-contain"
                  />
                </span>
              }>
              <Trans>{idp.name}</Trans>
              {lastUsedLogin !== undefined && (
                <LastUsedBadge active={lastUsedLogin === `idp:${idp.id}`} />
              )}
            </Button>
          </RRForm>
        );
      })}
    </div>
  );
}
