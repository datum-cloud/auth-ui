import { clsx } from "clsx";
import { CheckCircle } from "lucide-react";
import Link from "next/link";
import { ReactNode } from "react";

const cardClasses = (alreadyAdded: boolean) =>
  clsx(
    "relative bg-transparent group block space-y-2 rounded-md p-5  border border-navy dark:border-dark-navy-blue transition-all ",
    alreadyAdded ? "opacity-50 cursor-default" : "hover:border-green-dark",
  );

const LinkWrapper = ({
  alreadyAdded,
  children,
  link,
}: {
  alreadyAdded: boolean;
  children: ReactNode;
  link: string;
}) => {
  return !alreadyAdded ? (
    <Link href={link} className={cardClasses(alreadyAdded)}>
      {children}
    </Link>
  ) : (
    <div className={cardClasses(alreadyAdded)}>{children}</div>
  );
};

export const TOTP = (alreadyAdded: boolean, link: string) => {
  return (
    <LinkWrapper key={link} alreadyAdded={alreadyAdded} link={link}>
      <div className="flex flex-col items-center justify-center gap-1">
        <div className="font-medium flex items-center justify-center gap-2">
          <svg
            width={27}
            height={23}
            viewBox="0 0 27 23"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-6 h-6"
          >
            <g clipPath="url(#clip0_334_20062)">
              <path
                d="M26.8486 11.4988C26.8486 12.6994 25.8706 13.6726 24.6643 13.6726H17.125L13.8838 7.15058L17.3822 1.12043C17.9854 0.0807836 19.3212 -0.27545 20.3659 0.324742L20.3663 0.32498C21.4111 0.925209 21.7691 2.25469 21.1659 3.29442L17.6675 9.32506H24.6643C25.8706 9.32506 26.8486 10.2983 26.8486 11.4988Z"
                fill="#1A73E8"
              />
              <path
                d="M20.3662 22.6716L20.3658 22.6718C19.3211 23.272 17.9853 22.9158 17.3821 21.8761L13.8837 15.846L10.3853 21.8761C9.78213 22.9158 8.44632 23.272 7.40161 22.6718L7.4012 22.6716C6.35642 22.0713 5.99841 20.7419 6.60157 19.7021L10.1 13.6715L13.8837 13.5312L17.6674 13.6715L21.1658 19.7021C21.769 20.7419 21.411 22.0713 20.3662 22.6716Z"
                fill="#EA4335"
              />
              <path
                d="M13.8837 7.15058L12.8973 9.81591L10.1 9.32506L6.60157 3.29442C5.99841 2.25469 6.35642 0.925209 7.4012 0.32498L7.40161 0.324741C8.44632 -0.27545 9.78213 0.0807844 10.3853 1.12043L13.8837 7.15058Z"
                fill="#FBBC04"
              />
              <path
                d="M13.3195 9.32422L10.783 13.6718H3.10274C1.89639 13.6718 0.918457 12.6985 0.918457 11.498C0.918457 10.2975 1.89639 9.32422 3.10274 9.32422H13.3195Z"
                fill="#34A853"
              />
              <path
                d="M17.6671 13.6724H10.0996L13.8834 7.15039L17.6671 13.6724Z"
                fill="#185DB7"
              />
            </g>
            <defs>
              <clipPath id="clip0_334_20062">
                <rect
                  width={26}
                  height={23}
                  fill="white"
                  transform="translate(0.905273 -0.00195312)"
                />
              </clipPath>
            </defs>
          </svg>
          <span className="text-[19px]">Authenticator app</span>
        </div>
        <span className="text-[14px] text-center text-navy opacity-60">
          E.g. Google/Microsoft Authenticator, Authy
        </span>
        {alreadyAdded && (
          <>
            <Setup />
          </>
        )}
      </div>
    </LinkWrapper>
  );
};

export const U2F = (alreadyAdded: boolean, link: string) => {
  return (
    <LinkWrapper key={link} alreadyAdded={alreadyAdded} link={link}>
      <div className="flex flex-col items-center justify-center gap-1">
        <div className="font-medium flex items-center justify-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33"
            />
          </svg>
          <span className="text-[19px]">Device dependent</span>
        </div>
        <span className="text-[14px] text-center text-navy opacity-60">
          E.g. FaceID, Windows Hello, Fingerprint
        </span>
      </div>
      {alreadyAdded && (
        <>
          <Setup />
        </>
      )}
    </LinkWrapper>
  );
};

export const EMAIL = (alreadyAdded: boolean, link: string) => {
  return (
    <LinkWrapper key={link} alreadyAdded={alreadyAdded} link={link}>
      <div
        className={clsx(
          "font-medium flex items-center",
          alreadyAdded ? "" : "",
        )}
      >
        <svg
          className="w-8 h-8 mr-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
          />
        </svg>

        <span>Code via Email</span>
      </div>
      {alreadyAdded && (
        <>
          <Setup />
        </>
      )}
    </LinkWrapper>
  );
};

export const SMS = (alreadyAdded: boolean, link: string) => {
  return (
    <LinkWrapper key={link} alreadyAdded={alreadyAdded} link={link}>
      <div
        className={clsx(
          "font-medium flex items-center",
          alreadyAdded ? "" : "",
        )}
      >
        <svg
          className="w-8 h-8 mr-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
          />
        </svg>
        <span className="text-[19px]">Code via SMS</span>
      </div>
      {alreadyAdded && (
        <>
          <Setup />
        </>
      )}
    </LinkWrapper>
  );
};

export const PASSKEYS = (alreadyAdded: boolean, link: string) => {
  return (
    <LinkWrapper key={link} alreadyAdded={alreadyAdded} link={link}>
      <div
        className={clsx(
          "font-medium flex items-center",
          alreadyAdded ? "" : "",
        )}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          className="w-8 h-8 mr-4"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33"
          />
        </svg>
        <span className="text-[19px]">Passkeys</span>
      </div>
      {alreadyAdded && (
        <>
          <Setup />
        </>
      )}
    </LinkWrapper>
  );
};

export const PASSWORD = (alreadyAdded: boolean, link: string) => {
  return (
    <LinkWrapper key={link} alreadyAdded={alreadyAdded} link={link}>
      <div
        className={clsx(
          "font-medium flex items-center",
          alreadyAdded ? "" : "",
        )}
      >
        <svg
          className="w-8 h-7 mr-4 fill-current"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
        >
          <title>form-textbox-password</title>
          <path d="M17,7H22V17H17V19A1,1 0 0,0 18,20H20V22H17.5C16.95,22 16,21.55 16,21C16,21.55 15.05,22 14.5,22H12V20H14A1,1 0 0,0 15,19V5A1,1 0 0,0 14,4H12V2H14.5C15.05,2 16,2.45 16,3C16,2.45 16.95,2 17.5,2H20V4H18A1,1 0 0,0 17,5V7M2,7H13V9H4V15H13V17H2V7M20,15V9H17V15H20M8.5,12A1.5,1.5 0 0,0 7,10.5A1.5,1.5 0 0,0 5.5,12A1.5,1.5 0 0,0 7,13.5A1.5,1.5 0 0,0 8.5,12M13,10.89C12.39,10.33 11.44,10.38 10.88,11C10.32,11.6 10.37,12.55 11,13.11C11.55,13.63 12.43,13.63 13,13.11V10.89Z" />
        </svg>
        <span className="text-[19px]">Password</span>
      </div>
      {alreadyAdded && (
        <>
          <Setup />
        </>
      )}
    </LinkWrapper>
  );
};

function Setup() {
  return (
    <div className="transform  absolute right-4 top-1/2 -translate-y-1/2">
      <CheckCircle className="w-5 h-5" color="green" />
    </div>
  );
}
