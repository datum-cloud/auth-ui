import { AuthCard } from '@/components/auth-card/auth-card';
import { paths } from '@/routes/paths';
import { env } from '@/server/infra/env.server';
import { authErrorMessage } from '@/utils/errors/auth-error';
import { Button } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import { Link, useLoaderData, useSearchParams } from 'react-router';

// MERGE DECISION (Phase 0 review authoritative):
// 1. export function meta() — keeps document-title axe rule satisfied (static string fine).
// 2. text-foreground — muted-foreground fails WCAG AA at 3.47:1 in this theme (Phase 0 Task 12 fix).
// 3. {title}/{body} plain — they come from a FIXED code→message table, not the URL, so there is
//    no variable URL text to translate; static copy elsewhere uses <Trans>. No i18n here by design.
// 4. Reads ONLY ?code from the URL and maps it to a fixed message (authErrorMessage). The raw query
//    value is never rendered: title/error used to be read straight from the URL, which was ugly and
//    user-tamperable. An unknown/missing/tampered code falls back to a safe generic message.
export function meta() {
  return [{ title: 'Something went wrong' }];
}

// The CTA below is keyed on the CODE, never on the rendered text — the table strings stay
// untranslated by design, and matching on them would break the moment copy changed.
export function loader() {
  return { recoveryEnabled: env.AUTH_ACCOUNT_RECOVERY_ENABLED };
}

export default function ErrorScreen() {
  const [params] = useSearchParams();
  const { recoveryEnabled } = useLoaderData<typeof loader>();
  const code = params.get('code');
  const { title, body } = authErrorMessage(code);

  // A methodless account is precisely who recovery exists for — this is the dead end /login sends
  // them to, so it is the one error code that gets a way out.
  const showRecovery = code === 'no_supported_method' && recoveryEnabled;

  return (
    <AuthCard title={title} description={body}>
      {showRecovery ? (
        <Link
          to={paths.recover.index({
            email: params.get('loginName') ?? undefined,
            requestId: params.get('requestId') ?? undefined,
            organization: params.get('organization') ?? undefined,
          })}
          className="w-full">
          <Button type="primary" theme="solid" block>
            <Trans>Recover your account</Trans>
          </Button>
        </Link>
      ) : null}
    </AuthCard>
  );
}
