import { SessionsList } from "@/components/sessions-list";
import { Translated } from "@/components/translated";
import { getAllSessionCookieIds } from "@/lib/cookies";
import { generateRouteMetadata } from "@/lib/metadata";
import { getServiceUrlFromHeaders } from "@/lib/service-url";
import {
  getBrandingSettings,
  getDefaultOrg,
  listSessions,
} from "@/lib/zitadel";
import { UserPlusIcon } from "@heroicons/react/24/outline";
import { Organization } from "@zitadel/proto/zitadel/org/v2/org_pb";
import clsx from "clsx";
import { getLocale } from "next-intl/server";
import { headers } from "next/headers";
import Link from "next/link";

export const metadata = generateRouteMetadata("accounts");

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
  const locale = getLocale();

  const requestId = searchParams?.requestId;
  const organization = searchParams?.organization;

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

  const branding = await getBrandingSettings({
    serviceUrl,
    organization: organization ?? defaultOrganization,
  });

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
        <Translated i18nKey="title" namespace="accounts" />
      </h1>
      <p className="ztdl-p description">
        <Translated i18nKey="description" namespace="accounts" />
      </p>

      <div className="flex flex-col w-full space-y-2">
        <SessionsList sessions={sessions} requestId={requestId} />
        <Link href={`/loginname?` + params}>
          <div
            className={clsx(
              "transition-all gap-3 cursor-pointer flex flex-row items-center border outline-none px-6 text-sm py-2 border-transparent hover:border-navy rounded-lg min-h-[40px]",
              sessions.length > 0 ? "" : "justify-center",
            )}
          >
            <UserPlusIcon className="h-5 w-5" />
            <span className="text-sm">
              <Translated i18nKey="addAnother" namespace="accounts" />
            </span>
          </div>
        </Link>
      </div>
    </>
  );
}
