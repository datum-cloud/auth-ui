import { cn } from '@datum-cloud/datum-ui/utils';

export interface ThemedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  /** Light-theme source. Also the SSR + fallback source. */
  light: string;
  /**
   * Dark-theme source, used *optimistically*: shown on the dark theme, but it degrades to
   * {@link light} if it fails to load (e.g. the dark asset hasn't shipped yet). This makes
   * `dark` a true drop-in — wire it now and it auto-activates the moment the file lands, with
   * no broken image in the meantime. Omit (or pass the same value) to reuse `light`.
   */
  dark?: string;
}

/**
 * Theme-aware <img> that swaps its source via the `.dark` class on <html>.
 *
 * The class is set pre-paint by datum-ui's <ThemeScript>, so the swap is flash-free and
 * SSR-safe. We deliberately do NOT use a <picture> + `prefers-color-scheme` media query:
 * that follows the OS only and would desync the moment a user flips the in-app ThemeToggle.
 *
 * A distinct `dark` source renders a second <img>; CSS shows exactly one. The dark copy
 * degrades to `light` on load error, so a not-yet-shipped dark asset never shows broken.
 *
 * Keep usage decorative (alt=""): both copies share the same attributes.
 */
export function ThemedImage({
  light,
  dark,
  className,
  ...rest
}: ThemedImageProps): React.JSX.Element {
  if (!dark || dark === light) {
    return <img src={light} className={className} {...rest} />;
  }

  // Degrade the dark copy to `light` exactly once on failure. The ref catches a load error
  // that fired during SSR (before React attached onError); onError catches client-side ones.
  // The data-flag both prevents a loop when `light` is also unavailable and avoids re-firing.
  const degradeToLight = (img: HTMLImageElement | null): void => {
    if (!img || img.dataset.themedFallback || !img.complete || img.naturalWidth > 0) return;
    img.dataset.themedFallback = 'true';
    img.src = light;
  };

  return (
    <>
      <img src={light} className={cn(className, 'dark:hidden')} {...rest} />
      <img
        src={dark}
        {...rest}
        ref={degradeToLight}
        onError={(e) => {
          const img = e.currentTarget;
          if (img.dataset.themedFallback) return;
          img.dataset.themedFallback = 'true';
          img.src = light;
        }}
        className={cn(className, 'hidden dark:block')}
      />
    </>
  );
}
