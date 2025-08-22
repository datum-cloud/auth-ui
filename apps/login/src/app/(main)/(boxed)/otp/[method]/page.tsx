import { Alert } from "@/components/alert";

import { LoginOTP } from "@/components/login-otp";
import { Translated } from "@/components/translated";
import { UserAvatar } from "@/components/user-avatar";
import { getSessionCookieById } from "@/lib/cookies";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import { loadMostRecentSession } from "@/lib/session";
import { getLoginSettings, getSession } from "@/lib/zitadel";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";

export const metadata = generateRouteMetadata("otp");
export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
  params: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const locale = getLocale();

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);
  const host = _headers.get("host");

  if (!host || typeof host !== "string") {
    throw new Error("No host found");
  }

  const {
    loginName, // send from password page
    userId, // send from email link
    requestId,
    sessionId,
    organization,
    code,
    submit,
  } = searchParams;

  const { method } = params;

  const session = sessionId
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

  const loginSettings = await getLoginSettings({
    serviceUrl,
    organization: organization ?? session?.factors?.user?.organizationId,
  });

  return (
    <>
      <h1>
        <Translated i18nKey="verify.title" namespace="otp" />
      </h1>

      {method && (
        <p className="ztdl-p description">
          {method === "time-based" && (
            <Translated i18nKey="verify.totpDescription" namespace="otp" />
          )}
          {method === "sms" && (
            <Translated i18nKey="verify.smsDescription" namespace="otp" />
          )}
          {method === "email" && (
            <Translated i18nKey="verify.emailDescription" namespace="otp" />
          )}
        </p>
      )}

      {!session && (
        <div className="py-4">
          <Alert>
            <Translated i18nKey="unknownContext" namespace="error" />
          </Alert>
        </div>
      )}

      {session && (
        <div className="mb-10">
          <UserAvatar
            loginName={loginName ?? session.factors?.user?.loginName}
            displayName={session.factors?.user?.displayName}
            showDropdown
            searchParams={searchParams}
          ></UserAvatar>
        </div>
      )}

      {method && session && (
        <LoginOTP
          loginName={loginName ?? session.factors?.user?.loginName}
          sessionId={sessionId}
          requestId={requestId}
          organization={organization ?? session?.factors?.user?.organizationId}
          method={method}
          loginSettings={loginSettings}
          host={host}
          code={code}
        ></LoginOTP>
      )}
    </>
  );
}
