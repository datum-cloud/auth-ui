import { Alert } from "@/components/alert";
import { ChooseSecondFactorToSetup } from "@/components/choose-second-factor-to-setup";

import { Translated } from "@/components/translated";
import { UserAvatar } from "@/components/user-avatar";
import { getSessionCookieById } from "@/lib/cookies";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import { loadMostRecentSession } from "@/lib/session";
import {
  getLoginSettings,
  getSession,
  getUserByID,
  listAuthenticationMethodTypes,
} from "@/lib/zitadel";
import { Timestamp, timestampDate } from "@zitadel/client";
import { Session } from "@zitadel/proto/zitadel/session/v2/session_pb";
import { headers } from "next/headers";

function isSessionValid(session: Partial<Session>): {
  valid: boolean;
  verifiedAt?: Timestamp;
} {
  const validPassword = session?.factors?.password?.verifiedAt;
  const validPasskey = session?.factors?.webAuthN?.verifiedAt;
  const stillValid = session.expirationDate
    ? timestampDate(session.expirationDate) > new Date()
    : true;

  const verifiedAt = validPassword || validPasskey;
  const valid = !!((validPassword || validPasskey) && stillValid);

  return { valid, verifiedAt };
}

export const metadata = generateRouteMetadata("mfa");
export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;

  const { loginName, checkAfter, force, requestId, organization, sessionId } =
    searchParams;

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  const sessionWithData = sessionId
    ? await loadSessionById(sessionId, organization)
    : await loadSessionByLoginname(loginName, organization);

  async function getAuthMethodsAndUser(session?: Session) {
    const userId = session?.factors?.user?.id;

    if (!userId) {
      throw Error("Could not get user id from session");
    }

    return listAuthenticationMethodTypes({
      serviceUrl,
      userId,
    }).then((methods) => {
      return getUserByID({ serviceUrl, userId }).then((user) => {
        const humanUser =
          user.user?.type.case === "human" ? user.user?.type.value : undefined;

        return {
          id: session.id,
          factors: session?.factors,
          authMethods: methods.authMethodTypes ?? [],
          phoneVerified: humanUser?.phone?.isVerified ?? false,
          emailVerified: humanUser?.email?.isVerified ?? false,
          expirationDate: session?.expirationDate,
        };
      });
    });
  }

  async function loadSessionByLoginname(
    loginName?: string,
    organization?: string,
  ) {
    return loadMostRecentSession({
      serviceUrl,
      sessionParams: {
        loginName,
        organization,
      },
    }).then((session) => {
      return getAuthMethodsAndUser(session);
    });
  }

  async function loadSessionById(sessionId: string, organization?: string) {
    const recent = await getSessionCookieById({ sessionId, organization });
    return getSession({
      serviceUrl,
      sessionId: recent.id,
      sessionToken: recent.token,
    }).then((sessionResponse) => {
      return getAuthMethodsAndUser(sessionResponse.session);
    });
  }

  const loginSettings = await getLoginSettings({
    serviceUrl,
    organization: sessionWithData.factors?.user?.organizationId,
  });

  const { valid } = isSessionValid(sessionWithData);

  return (
    <>
      <h1>
        <Translated i18nKey="set.title" namespace="mfa" />
      </h1>

      <p className="ztdl-p">
        <Translated i18nKey="set.description" namespace="mfa" />
      </p>

      {sessionWithData && (
        <UserAvatar
          loginName={loginName ?? sessionWithData.factors?.user?.loginName}
          displayName={sessionWithData.factors?.user?.displayName}
          showDropdown
          searchParams={searchParams}
        ></UserAvatar>
      )}

      {!(loginName || sessionId) && (
        <Alert>
          <Translated i18nKey="unknownContext" namespace="error" />
        </Alert>
      )}

      {!valid && (
        <Alert>
          <Translated i18nKey="sessionExpired" namespace="error" />
        </Alert>
      )}

      {isSessionValid(sessionWithData).valid &&
        loginSettings &&
        sessionWithData &&
        sessionWithData.factors?.user?.id && (
          <ChooseSecondFactorToSetup
            userId={sessionWithData.factors?.user?.id}
            loginName={loginName}
            sessionId={sessionWithData.id}
            requestId={requestId}
            organization={organization}
            loginSettings={loginSettings}
            userMethods={sessionWithData.authMethods ?? []}
            phoneVerified={sessionWithData.phoneVerified ?? false}
            emailVerified={sessionWithData.emailVerified ?? false}
            checkAfter={checkAfter === "true"}
            force={force === "true"}
          ></ChooseSecondFactorToSetup>
        )}
    </>
  );
}
