import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { UserIcon } from "lucide-react";
import Link from "next/link";

type Props = {
  loginName?: string;
  displayName?: string;
  showDropdown: boolean;
  searchParams?: Record<string | number | symbol, string | undefined>;
};

export function UserAvatar({
  loginName,
  displayName,
  showDropdown,
  searchParams,
}: Props) {
  const params = new URLSearchParams({});

  if (searchParams?.sessionId) {
    params.set("sessionId", searchParams.sessionId);
  }

  if (searchParams?.organization) {
    params.set("organization", searchParams.organization);
  }

  if (searchParams?.requestId) {
    params.set("requestId", searchParams.requestId);
  }

  if (searchParams?.loginName) {
    params.set("loginName", searchParams.loginName);
  }

  return (
    <div className="flex h-full flex-row items-center rounded-full border bg-cream border-light-gray dark:border-dark-navy-blue dark:bg-navy gap-4 px-6 py-2">
      <div className="flex flex-row items-center gap-2">
        <UserIcon className="w-4 h-4" />
        <span className="text-sm max-w-[250px] text-ellipsis overflow-hidden whitespace-pre">
          {loginName ?? displayName}
        </span>
      </div>
      {showDropdown && (
        <Link
          href={"/accounts?" + params}
          className="flex items-center justify-center p-1 rounded-full mr-1 transition-all"
        >
          <ChevronDownIcon className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
