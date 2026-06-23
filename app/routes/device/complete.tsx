// app/routes/device/complete.tsx
//
// Terminal landing for the device-authorization ceremony. The /device/authorize action
// REDIRECTS here after applying the decision (authorize / deny), carrying ?decision=.
//
// ABSOLUTELY NO provider / getDeviceAuth call: authorize has legitimately consumed the
// device-auth request, so any re-resolution would NOT_FOUND and surface a false "Code expired".
// This route only reads the validated ?decision and renders the matching terminal copy — so
// RR7's post-action revalidation has nothing to re-resolve.
import { AuthCard } from '@/components/auth-card/auth-card';
import { Trans } from '@lingui/react/macro';
import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from 'react-router';
import { z } from 'zod';

export const meta: MetaFunction = () => [{ title: 'Authorization complete' }];

const decisionSchema = z.enum(['authorize', 'deny']);

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const parsed = decisionSchema.safeParse(url.searchParams.get('decision'));
  // Default to 'deny' on a missing/tampered ?decision: the terminal screen is fail-safe and
  // never grants on an unverifiable value. No provider call — nothing to recover here.
  return data({ decision: parsed.success ? parsed.data : ('deny' as const) });
}

export default function DeviceComplete() {
  const { decision } = useLoaderData<typeof loader>();

  if (decision === 'authorize') {
    return (
      <AuthCard
        title={<Trans>Authorization complete</Trans>}
        description={<Trans>You may return to your device.</Trans>}
      />
    );
  }

  return (
    <AuthCard
      title={<Trans>Device denied</Trans>}
      description={<Trans>This device was not granted access. You may close this window.</Trans>}
    />
  );
}
