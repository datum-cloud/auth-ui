import type { BrandingTheme } from '@/modules/auth/types';
import { assetUrl } from '@/utils/asset-url';
import { Avatar, AvatarFallback, AvatarImage } from '@datum-cloud/datum-ui/avatar';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
import { Logo } from '@datum-cloud/datum-ui/logo';
import { Trans } from '@lingui/react/macro';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router';

export default function SplitLayout({
  children,
  branding,
}: {
  children: React.ReactNode;
  branding?: BrandingTheme | null;
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Left panel is the login form.*/}
      <div className="dark:bg-background relative flex min-h-screen w-full flex-col bg-white p-3 sm:p-4 md:px-[41px] md:py-8">
        <div className="justify-flex-start flex items-center">
          <Link to="/">
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt="" aria-hidden="true" className="h-6 w-auto" />
            ) : (
              <Logo.Flat aria-label="Datum" className="h-6 w-auto" tone="brand" />
            )}
          </Link>
        </div>
        <main className="flex w-full flex-1 items-center justify-center">
          <div className="w-full max-w-[400px]">{children}</div>
        </main>

        <footer className="text-foreground/70 mx-auto w-full max-w-[400px] text-center text-xs leading-4 md:text-left">
          <Trans>
            By continuing, you agree to Datum's{' '}
            <Link
              to="https://www.datum.net/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline transition-all">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link
              to="https://www.datum.net/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline transition-all">
              Privacy Policy
            </Link>
            , and to receive periodic emails with updates.
          </Trans>
        </footer>
      </div>
      {/* Right panel is a marketing / branding panel.*/}
      <aside
        aria-label="Datum overview"
        className="bg-background dark:bg-background/50 relative hidden min-h-screen w-full flex-col p-3 sm:p-4 md:flex md:px-[41px] md:py-8">
        <div className="flex items-center justify-end">
          <LinkButton
            type="quaternary"
            theme="outline"
            iconPosition="left"
            icon={<Icon icon={BookOpen} />}
            as={Link}
            href="https://www.datum.net/docs"
            target="_blank"
            rel="noopener noreferrer">
            Documentation
          </LinkButton>
        </div>

        <div className="flex w-full flex-1 items-center justify-center">
          <div className="relative flex w-full max-w-[400px] flex-col gap-6">
            <div className="absolute -top-36 -left-24 z-0 max-w-[115px]">
              <img
                src={assetUrl('/images/illustration-2.png')}
                alt=""
                aria-hidden="true"
                className="size-auto w-full object-cover"
              />
            </div>

            <div className="stretch leading-6 text-[#67717C]">
              <Trans>
                Using Datum requires setting up a billing account, but to help you explore without
                cost, we add{' '}
                <span className="text-foreground bg-[#e6f59f] px-0.5 font-semibold">$50 USD</span>{' '}
                in credit on signup.
              </Trans>
              <span className="block h-4" />
              <Trans>
                Prefer a demo instead? Just{' '}
                <Link
                  to="https://link.datum.net/founders"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground underline transition-all">
                  reach out
                </Link>
                .
              </Trans>
              <span className="block h-4" />
              <Trans>Thanks,</Trans>
            </div>

            <div className="flex flex-col">
              <Avatar className="mb-2 size-10 rounded-lg">
                <AvatarImage alt="Zac Smith" src={assetUrl('/images/zac-avatar.png')} />
                <AvatarFallback>ZS</AvatarFallback>
              </Avatar>
              <span className="leading-4 text-[#67717C]">Zac Smith</span>
              <span className="text-xs text-[#595F65]">Co-founder and CEO</span>
            </div>

            <img
              src={assetUrl('/images/zac-sign.png')}
              alt=""
              aria-hidden="true"
              className="h-[38px] w-24"
            />
          </div>
        </div>

        <div className="absolute right-0 bottom-0 z-0 max-w-[500px] md:max-w-[800px]">
          <img
            src={assetUrl('/images/illustration-1.png')}
            alt=""
            aria-hidden="true"
            className="size-auto w-full object-cover"
          />
        </div>
      </aside>
    </div>
  );
}
