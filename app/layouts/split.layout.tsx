import { BrandLogo } from '@/components/brand-logo/brand-logo';
import { ThemedImage } from '@/components/themed-image/themed-image';
import type { BrandingTheme } from '@/modules/auth/types';
import { assetUrl } from '@/utils/asset-url';
import { Avatar, AvatarFallback, AvatarImage } from '@datum-cloud/datum-ui/avatar';
import { LinkButton } from '@datum-cloud/datum-ui/button';
import { Icon } from '@datum-cloud/datum-ui/icons';
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
        <div className="flex items-center justify-between">
          <BrandLogo branding={branding} />
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
              {/* Intrinsic 232×290 raster line-art. width/height pin the aspect ratio so
                  the absolutely-positioned panel reserves space and never shifts layout (CLS).
                  object-contain keeps the line-art crisp/uncropped while it scales down into the
                  115px box. Design note (asset pending): replace with a vector (SVG) or AVIF source — a designer
                  asset is still needed; this raster is the only source that currently exists.
                  Dark mode (#9C7979 rose line-art on the dark panel): the seam is wired — once
                  /images/illustration-2.dark.svg exists, pass dark={darkAssetUrl('/images/illustration-2.svg')}. */}
              <ThemedImage
                light={assetUrl('/images/illustration-2.svg')}
                alt=""
                aria-hidden="true"
                width={232}
                height={290}
                className="size-auto w-full object-contain"
              />
            </div>

            <div className="text-muted-foreground stretch leading-6">
              <Trans>
                Using Datum requires setting up a billing account, but to help you explore without
                cost, we add{' '}
                {/* The lime credit chip (aurora-moss #e6f59f) is a fixed brand accent that
                    stays light in BOTH themes, so it pins dark text (midnight-fjord) explicitly —
                    text-foreground would flip to light on dark and become unreadable on lime. */}
                <span className="bg-[#e6f59f] px-0.5 font-semibold text-[#0c1d31]">$50 USD</span> in
                credit on signup.
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
                {/* 80×80 source rendered into a 40px (size-10) slot — the existing source is
                    already 2× DPR. The 2x density descriptor declares that intent so retina screens
                    render the avatar crisply; width/height reserve the 40px box (CLS). A photo, so it
                    is theme-independent — no light/dark variant needed. */}
                <AvatarImage
                  alt="Zac Smith"
                  src={assetUrl('/images/zac-avatar.png')}
                  srcSet={`${assetUrl('/images/zac-avatar.png')} 3x`}
                  width={40}
                  height={40}
                />
                <AvatarFallback>ZS</AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground leading-4">Zac Smith</span>
              {/* Full-opacity --muted-foreground (not /80). At 12px the /80 alpha composites
                  to ≈3.8:1 on the cream panel (fails WCAG AA); full opacity clears ≈6:1 in light and
                  keeps dark mode's own muted token. */}
              <span className="text-muted-foreground text-xs">Co-founder and CEO</span>
            </div>

            {/* 95×38 signature raster (raster wrapped in SVG) at ~1× in a 96px-wide slot.
                width/height pin the box (CLS) and object-contain keeps the strokes crisp without
                stretching. dark:invert flips the dark ink to light so the signature reads on the
                dark panel — the right call here since it is a single-colour mark (no real dark
                asset needed). Design note (asset pending): a true vector signature is still wanted. */}
            <img
              src={assetUrl('/images/zac-sign.svg')}
              alt=""
              aria-hidden="true"
              width={95}
              height={38}
              className="h-[38px] w-24 object-contain dark:invert"
            />
          </div>
        </div>

        <div className="absolute right-0 bottom-0 z-0 max-w-[500px] md:max-w-[800px]">
          {/* Intrinsic 707×155 raster line-art stretched into a fluid box up to 800px wide,
              so it currently upscales (soft). width/height pin the aspect ratio for CLS; object-contain
              avoids the crop/extra blur object-cover introduced. Design note (asset pending): replace with a vector
              (SVG) or higher-res AVIF source — a designer asset is still needed to render crisply at
              the 800px display width; the 707px raster is the only source that exists today.
              Dark mode (#0C1D31 navy line-art on the dark panel): the seam is wired — once
              /images/illustration-1.dark.svg exists, pass dark={darkAssetUrl('/images/illustration-1.svg')}. */}
          <ThemedImage
            light={assetUrl('/images/illustration-1.svg')}
            alt=""
            aria-hidden="true"
            width={707}
            height={155}
            className="size-auto w-full object-contain"
          />
        </div>
      </aside>
    </div>
  );
}
