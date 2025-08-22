import { Translated } from "@/components/translated";
import { generateRouteMetadata } from "@/lib/metadata";

export const metadata = generateRouteMetadata("logout");
export default async function Page() {
  return (
    <>
      <h1>
        <Translated i18nKey="success.title" namespace="logout" />
      </h1>
      <p className="ztdl-p mb-6 block">
        <Translated i18nKey="success.description" namespace="logout" />
      </p>
    </>
  );
}
