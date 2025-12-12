import googleLogo from "@/components/assets/google.svg";
import { GitHubLogo } from "@/components/idps/sign-in-with-github";
import { UnlinkIdpButton } from "@/components/unlink-idp-button";
import { unlinkIdp } from "@/lib/server/idp";
import { IdentityProviderType } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb";
import Image from "next/image";

export type LinkedIdp = {
  idpId: string;
  idpType: IdentityProviderType;
  idpName: string;
  userName?: string;
  linkedUserId: string;
};

type Props = {
  linkedIdps: LinkedIdp[];
};

export function LinkedIdpList({ linkedIdps }: Props) {
  return (
    <ul className="space-y-2 w-full">
      {linkedIdps.map((l) => {
        let icon: React.ReactNode = null;
        switch (l.idpType) {
          case IdentityProviderType.GOOGLE:
            icon = (
              <Image
                src={googleLogo}
                alt="google"
                width={20}
                height={20}
                className="rounded"
              />
            );
            break;
          case IdentityProviderType.GITHUB:
          case IdentityProviderType.GITHUB_ES:
            icon = (
              <span className="h-5 w-5 flex items-center justify-center">
                <GitHubLogo />
              </span>
            );
            break;
          default:
            if (l.idpName.toLowerCase().includes("google")) {
              icon = (
                <Image
                  src={googleLogo}
                  alt="google"
                  width={20}
                  height={20}
                  className="rounded"
                />
              );
            } else {
              const initials = l.idpName.slice(0, 2).toUpperCase();
              icon = (
                <div className="h-5 w-5 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded text-[10px] font-bold text-gray-600 dark:text-gray-300">
                  {initials}
                </div>
              );
            }
            break;
        }

        return (
          <li
            key={l.idpId}
            className="w-full flex flex-row items-center justify-between text-sm p-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 shadow-sm min-h-[3.5rem]"
          >
            <div className="flex flex-row items-center gap-3 min-w-0 flex-1 mr-4">
              <span className="shrink-0 flex items-center justify-center">
                {icon}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {l.idpName}
                </span>
                {l.userName && (
                  <span
                    className="text-xs text-gray-500 dark:text-gray-400 truncate"
                    title={l.userName}
                  >
                    {l.userName}
                  </span>
                )}
              </div>
            </div>

            <div className="shrink-0">
              <UnlinkIdpButton
                unlinkAction={unlinkIdp}
                idpId={l.idpId}
                linkedUserId={l.linkedUserId}
                providerName={l.idpName}
                isLastIdp={linkedIdps.length === 1}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
