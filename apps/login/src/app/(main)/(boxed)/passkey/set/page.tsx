import { Alert, AlertType } from "@/components/alert";
import { RegisterPasskey } from "@/components/register-passkey";
import { Translated } from "@/components/translated";
import { UserAvatar } from "@/components/user-avatar";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import { loadMostRecentSession } from "@/lib/session";
import { headers } from "next/headers";

export const metadata = generateRouteMetadata("passkey");
export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;

  const { loginName, prompt, organization, requestId, userId } = searchParams;

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  const session = await loadMostRecentSession({
    serviceUrl,
    sessionParams: {
      loginName,
      organization,
    },
  });

  return (
    <>
      <h1>
        <Translated i18nKey="set.title" namespace="passkey" />
      </h1>

      {session && (
        <UserAvatar
          loginName={loginName ?? session.factors?.user?.loginName}
          showDropdown
          searchParams={searchParams}
        ></UserAvatar>
      )}

      <Alert type={AlertType.INFO}>
        <span>
          <Translated i18nKey="set.info.description" namespace="passkey" />
          <a
            className="text-orange hover:underline transition-all"
            target="_blank"
            href="https://zitadel.com/docs/guides/manage/user/reg-create-user#with-passwordless"
          >
            <Translated i18nKey="set.info.link" namespace="passkey" />
          </a>
        </span>
      </Alert>

      {!session && (
        <div className="py-4">
          <Alert>
            <Translated i18nKey="unknownContext" namespace="error" />
          </Alert>
        </div>
      )}

      {session?.id && (
        <RegisterPasskey
          sessionId={session.id}
          isPrompt={!!prompt}
          organization={organization}
          requestId={requestId}
        />
      )}
    </>
  );
}
