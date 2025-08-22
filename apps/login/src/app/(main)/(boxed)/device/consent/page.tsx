import { ConsentScreen } from "@/components/consent";

import { Translated } from "@/components/translated";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import { getDeviceAuthorizationRequest } from "@/lib/zitadel";
import { headers } from "next/headers";

export const metadata = generateRouteMetadata("device");
export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;

  const userCode = searchParams?.user_code;
  const requestId = searchParams?.requestId;
  const organization = searchParams?.organization;

  if (!userCode || !requestId) {
    return (
      <div>
        <Translated i18nKey="noUserCode" namespace="error" />
      </div>
    );
  }

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  const { deviceAuthorizationRequest } = await getDeviceAuthorizationRequest({
    serviceUrl,
    userCode,
  });

  if (!deviceAuthorizationRequest) {
    return (
      <div>
        <Translated i18nKey="noDeviceRequest" namespace="error" />
      </div>
    );
  }

  const params = new URLSearchParams();

  if (requestId) {
    params.append("requestId", requestId);
  }

  if (organization) {
    params.append("organization", organization);
  }

  return (
    <>
      <h1>
        <Translated
          i18nKey="request.title"
          namespace="device"
          data={{ appName: deviceAuthorizationRequest?.appName }}
        />
      </h1>

      <p className="ztdl-p">
        <Translated
          i18nKey="request.description"
          namespace="device"
          data={{ appName: deviceAuthorizationRequest?.appName }}
        />
      </p>

      <ConsentScreen
        deviceAuthorizationRequestId={deviceAuthorizationRequest?.id}
        scope={deviceAuthorizationRequest.scope}
        appName={deviceAuthorizationRequest?.appName}
        nextUrl={`/loginname?` + params}
      />
    </>
  );
}
