import { Icon } from '@datum-cloud/datum-ui/icons';
import { useTheme } from '@datum-cloud/datum-ui/theme';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

// 755-M4 · Persisted theme toggle.
//
// Cycles the user's *preference* through light → dark → system → light. next-themes
// (datum-ui ThemeProvider) persists the choice to localStorage under its storageKey and
// re-applies the `.dark` class on the <html> element, which flips every datum-ui token
// (see app/styles/tokens + themes/alpha.css .dark block). `system` follows the OS via
// prefers-color-scheme.
//
// A single native <button> — NO nested interactive elements (prod a11y build rule).
const ORDER = ['light', 'dark', 'system'] as const;
type Choice = (typeof ORDER)[number];

function nextChoice(current: Choice): Choice {
  const i = ORDER.indexOf(current);
  return ORDER[(i + 1) % ORDER.length];
}

// Plain-string labels (not lingui macro). This control lives in the shared auth layouts, so
// pulling the compile-time `@lingui/react/macro` useLingui into it would force every page-level
// render test to mock that macro (it throws at runtime under vitest's non-lingui transform).
// Matching the repo's other shared-layout labels (e.g. accounts.tsx "Remove account",
// Logo.Flat "Datum"), the labels stay plain English; a future i18n pass can route them through
// the catalog if/when the toggle needs translation.
const CHOICE_LABELS = {
  light: 'Switch to dark theme',
  dark: 'Switch to system theme',
  system: 'Switch to light theme',
} as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  // next-themes returns the SSR defaultTheme on the server and the real (possibly
  // localStorage/system-derived) value only after mount. Rendering theme-dependent
  // markup before mount causes a hydration mismatch, so we render a stable neutral
  // icon until mounted, then swap to the active-choice icon. The button itself is
  // always present (progressive enhancement: it does nothing until hydrated, which
  // is acceptable for a cosmetic preference control).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const choice: Choice = (ORDER as readonly string[]).includes(theme ?? '')
    ? (theme as Choice)
    : 'system';

  const icons: Record<Choice, typeof Sun> = {
    light: Sun,
    dark: Moon,
    system: Monitor,
  };

  // Pre-mount: neutral icon + generic label, and the cycle resolves from the rendered
  // choice so the first click is deterministic once handlers attach.
  const ActiveIcon = mounted ? icons[choice] : Monitor;
  const label = mounted ? CHOICE_LABELS[choice] : 'Toggle theme';

  return (
    <button
      type="button"
      onClick={() => setTheme(nextChoice(choice))}
      aria-label={label}
      title={label}
      data-theme-choice={mounted ? choice : undefined}
      className={[
        'text-foreground/70 hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')}>
      <Icon icon={ActiveIcon} className="size-4" />
    </button>
  );
}
