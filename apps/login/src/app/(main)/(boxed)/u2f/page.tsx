import { Alert } from "@/components/alert";
import { LoginPasskey } from "@/components/login-passkey";
import { Translated } from "@/components/translated";
import { UserAvatar } from "@/components/user-avatar";
import { getSessionCookieById } from "@/lib/cookies";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import { loadMostRecentSession } from "@/lib/session";
import { getSession } from "@/lib/zitadel";
import { headers } from "next/headers";

export const metadata = generateRouteMetadata("u2f");

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;

  const { loginName, requestId, sessionId, organization } = searchParams;

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);
  const host = _headers.get("host");

  if (!host || typeof host !== "string") {
    throw new Error("No host found");
  }

  const sessionFactors = sessionId
    ? await loadSessionById(serviceUrl, sessionId, organization)
    : await loadMostRecentSession({
        serviceUrl,
        sessionParams: { loginName, organization },
      });

  async function loadSessionById(
    host: string,
    sessionId: string,
    organization?: string,
  ) {
    const recent = await getSessionCookieById({ sessionId, organization });
    return getSession({
      serviceUrl,
      sessionId: recent.id,
      sessionToken: recent.token,
    }).then((response) => {
      if (response?.session) {
        return response.session;
      }
    });
  }

  return (
    <>
      <h1>
        <Translated i18nKey="verify.title" namespace="u2f" />
      </h1>

      {sessionFactors && (
        <UserAvatar
          loginName={loginName ?? sessionFactors.factors?.user?.loginName}
          displayName={sessionFactors.factors?.user?.displayName}
          showDropdown
          searchParams={searchParams}
        ></UserAvatar>
      )}
      <p className="ztdl-p mb-6 block">
        <Translated i18nKey="verify.description" namespace="u2f" />
      </p>

      {!(loginName || sessionId) && (
        <Alert>
          <Translated i18nKey="unknownContext" namespace="error" />
        </Alert>
      )}

      {(loginName || sessionId) && (
        <LoginPasskey
          loginName={loginName}
          sessionId={sessionId}
          requestId={requestId}
          altPassword={false}
          organization={organization}
          login={false} // this sets the userVerificationRequirement to discouraged as its used as second factor
        />
      )}
    </>
  );
}
