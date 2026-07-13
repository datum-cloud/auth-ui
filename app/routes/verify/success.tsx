import { AuthCard } from '@/components/auth-card/auth-card';
import { TrackOnMount } from '@/modules/analytics/fathom';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Trans } from '@lingui/react/macro';
import {
  data,
  Link,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from 'react-router';

export const meta: MetaFunction = () => [{ title: 'Email verified' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  return data({
    loginName: url.searchParams.get('loginName') ?? undefined,
  });
}

export default function VerifySuccess() {
  const { loginName } = useLoaderData<typeof loader>();
  return (
    <AuthCard
      title={<Trans>Your email is verified</Trans>}
      description={
        <Trans>
          You can now sign in using <strong>{loginName}</strong>.
        </Trans>
      }>
      <TrackOnMount event="email_verified" />
      {/* LinkButton (renders a single styled <a>) — NOT Button asChild, which
          emits <button><a> (nested-interactive axe violation in the prod build). */}
      <LinkButton theme="link" type="quaternary" as={Link} href="/login">
        <Trans>Back</Trans>
      </LinkButton>
    </AuthCard>
  );
}
