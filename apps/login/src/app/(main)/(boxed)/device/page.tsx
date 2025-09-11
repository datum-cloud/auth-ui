import { DeviceCodeForm } from "@/components/device-code-form";
import { Translated } from "@/components/translated";
import { generateRouteMetadata } from "@/lib/metadata";

export const metadata = generateRouteMetadata("device");

export default async function Page(props: {
  searchParams: Promise<Record<string | number | symbol, string | undefined>>;
}) {
  const searchParams = await props.searchParams;

  const userCode = searchParams?.user_code;

  return (
    <>
      <h1>
        <Translated i18nKey="usercode.title" namespace="device" />
      </h1>
      <p className="ztdl-p">
        <Translated i18nKey="usercode.description" namespace="device" />
      </p>
      <DeviceCodeForm userCode={userCode}></DeviceCodeForm>
    </>
  );
}
