"use client";

import { sendLoginname } from "@/lib/server/loginname";
import { clearSession, continueWithSession } from "@/lib/server/session";
import { XCircleIcon } from "@heroicons/react/24/outline";
import { Timestamp, timestampDate } from "@zitadel/client";
import { Session } from "@zitadel/proto/zitadel/session/v2/session_pb";
import moment from "moment";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Avatar } from "./avatar";

export function isSessionValid(session: Partial<Session>): {
  valid: boolean;
  verifiedAt?: Timestamp;
} {
  const validPassword = session?.factors?.password?.verifiedAt;
  const validPasskey = session?.factors?.webAuthN?.verifiedAt;
  const validIDP = session?.factors?.intent?.verifiedAt;

  const stillValid = session.expirationDate
    ? timestampDate(session.expirationDate) > new Date()
    : true;

  const verifiedAt = validPassword || validPasskey || validIDP;
  const valid = !!((validPassword || validPasskey || validIDP) && stillValid);

  return { valid, verifiedAt };
}

export function SessionItem({
  session,
  reload,
  requestId,
}: {
  session: Session;
  reload: () => void;
  requestId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const currentLocale = useLocale();
  const { valid, verifiedAt } = isSessionValid(session);
  const [error, setError] = useState<string | null>(null);
  moment.locale(currentLocale === "zh" ? "zh-cn" : currentLocale);

  async function clearSessionId(id: string) {
    setError(null);
    const response = await clearSession({
      sessionId: id,
    }).catch((error) => {
      setError(error.message);
      return;
    });

    return response;
  }

  function handleClick() {
    startTransition(async () => {
      setError(null);

      if (isPending) return;

      if (valid && session?.factors?.user) {
        try {
          const resp = await continueWithSession({
            ...session,
            requestId: requestId,
          });

          if (resp?.redirect) {
            router.push(resp.redirect);
            return;
          } else {
            setError("Could not continue with session. Please try again.");
            return;
          }
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "An internal error occurred",
          );
          return;
        }
      } else if (session.factors?.user) {
        const res = await sendLoginname({
          loginName: session.factors?.user?.loginName,
          organization: session.factors.user.organizationId,
          requestId: requestId,
        }).catch(() => {
          setError("An internal error occurred");
          return;
        });

        if (res && "redirect" in res && res.redirect) {
          router.push(res.redirect);
          return;
        }

        if (res && "error" in res && res.error) {
          setError(res.error);
          return;
        }

        // If we get here, no redirect or error was returned
        if (res) {
          setError("Could not process login. Please try again.");
          return;
        }
      } else {
        setError("Could not process login. Please try again.");
        return;
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="group flex flex-row items-center py-2 border border-light-gray hover:border-navy rounded-lg bg-background-light-400 dark:bg-background-dark-400 transition-all px-4 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="pr-2.5">
        <Avatar
          size="small"
          loginName={session.factors?.user?.loginName as string}
          name={session.factors?.user?.displayName ?? ""}
        />
      </div>

      <div className="flex flex-col items-start overflow-hidden flex-1 min-w-0">
        <span className="font-semibold text-sm">
          {session.factors?.user?.displayName}
        </span>
        <span className="text-xs text-navy opacity-60 text-ellipsis font-normal">
          {session.factors?.user?.loginName}
        </span>
        {error ? (
          <span className="text-xs text-red-500 text-ellipsis text-left pt-2 max-w-52">
            {error}
          </span>
        ) : valid ? (
          <span className="text-xs text-navy opacity-60 text-ellipsis">
            {verifiedAt && moment(timestampDate(verifiedAt)).fromNow()}
          </span>
        ) : (
          verifiedAt && (
            <span className="text-xs text-navy opacity-60 text-ellipsis">
              expired{" "}
              {session.expirationDate &&
                moment(timestampDate(session.expirationDate)).fromNow()}
            </span>
          )
        )}
      </div>

      <div className="relative flex flex-row items-center">
        {isPending ? (
          <div className="h-4 w-4 border-2 border-navy border-t-transparent rounded-full animate-spin mx-2"></div>
        ) : (
          <>
            {valid ? (
              <div className="absolute h-2 w-2 bg-green-500 rounded-full mx-2 transform right-0 group-hover:right-6 transition-all"></div>
            ) : (
              <div className="absolute h-2 w-2 bg-red-500 rounded-full mx-2 transform right-0 group-hover:right-6 transition-all"></div>
            )}

            <XCircleIcon
              className="hidden group-hover:block h-5 w-5 transition-all opacity-50 hover:opacity-100"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                clearSessionId(session.id).then(() => {
                  reload();
                });
              }}
            />
          </>
        )}
      </div>
    </button>
  );
}
