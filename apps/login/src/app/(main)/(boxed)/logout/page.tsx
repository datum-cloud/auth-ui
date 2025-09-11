import { SessionsClearList } from "@/components/sessions-clear-list";
import { Translated } from "@/components/translated";
import { getAllSessionCookieIds } from "@/lib/cookies";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import { getDefaultOrg, listSessions } from "@/lib/zitadel";
import { Organization } from "@zitadel/proto/zitadel/org/v2/org_pb";
import { headers } from "next/headers";

export const metadata = generateRouteMetadata("logout");

async function loadSessions({ serviceUrl }: { serviceUrl: string }) {
  const ids: (string | undefined)[] = await getAllSessionCookieIds();

  if (ids && ids.length) {
    const response = await listSessions({
      serviceUrl,
      ids: ids.filter((id) => !!id) as string[],
    });
    return response?.sessions ?? [];
  } else {
    console.info("No session cookie found.");
    return [];
  }
}

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;

  const organization = searchParams?.organization;
  const postLogoutRedirectUri = searchParams?.post_logout_redirect_uri;
  const logoutHint = searchParams?.logout_hint;
  const UILocales = searchParams?.ui_locales; // TODO implement with new translation service

  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  let defaultOrganization;
  if (!organization) {
    const org: Organization | null = await getDefaultOrg({
      serviceUrl,
    });
    if (org) {
      defaultOrganization = org.id;
    }
  }

  let sessions = await loadSessions({ serviceUrl });

  const params = new URLSearchParams();

  if (organization) {
    params.append("organization", organization);
  }

  return (
    <>
      <h1>
        <Translated i18nKey="title" namespace="logout" />
      </h1>
      <p className="ztdl-p mb-6 block description">
        <Translated i18nKey="description" namespace="logout" />
      </p>

      <div className="flex flex-col w-full space-y-2">
        <SessionsClearList
          sessions={sessions}
          logoutHint={logoutHint}
          postLogoutRedirectUri={postLogoutRedirectUri}
          organization={organization ?? defaultOrganization}
        />
      </div>
    </>
  );
}
