import { LDAPUsernamePasswordForm } from "@/components/ldap-username-password-form";
import { Translated } from "@/components/translated";
import { generateRouteMetadata } from "@/lib/metadata";

export const metadata = generateRouteMetadata("idp");
export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
  params: Promise<{ provider: string }>;
}) {
  const searchParams = await props.searchParams;
  const { idpId, link } = searchParams;

  if (!idpId) {
    throw new Error("No idpId provided in searchParams");
  }

  // return login failed if no linking or creation is allowed and no user was found
  return (
    <>
      <h1>
        <Translated i18nKey="title" namespace="ldap" />
      </h1>
      <p className="ztdl-p description">
        <Translated i18nKey="description" namespace="ldap" />
      </p>

      <LDAPUsernamePasswordForm
        idpId={idpId}
        link={link === "true"}
      ></LDAPUsernamePasswordForm>
    </>
  );
}
