// @vitest-environment happy-dom
//
// 755-M4 · Persisted theme toggle render + behavior.
//
// The toggle is a single native <button> (no nested interactives — prod a11y rule) that cycles
// the user's *preference* light → dark → system → light and writes it through next-themes
// (datum-ui ThemeProvider), which persists to localStorage. We mock the datum-ui theme module so
// the test owns the theme state and can assert (a) it renders one accessible button, (b) each
// click advances to the next choice in order, and (c) the accessible label reflects the current
// choice. The real localStorage persistence belongs to next-themes and is covered by that lib.
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Stateful useTheme mock. setTheme records the value and updates the returned theme so a
// re-render reflects the new choice (mirrors next-themes' behavior closely enough to assert
// the cycle order and the persisted target).
let currentTheme = 'light';
const setThemeSpy = vi.fn((value: string) => {
  currentTheme = value;
});

vi.mock('@datum-cloud/datum-ui/theme', () => ({
  useTheme: () => ({ theme: currentTheme, setTheme: setThemeSpy }),
}));

// Icon wrapper: render a marker carrying the lucide icon's display name so we can assert which
// glyph is shown for the active choice without depending on SVG internals.
vi.mock('@datum-cloud/datum-ui/icons', () => ({
  Icon: ({ icon }: { icon: { displayName?: string; name?: string } }) => (
    <span data-icon={icon.displayName ?? icon.name} />
  ),
}));

const { ThemeToggle } = await import('@/components/theme-toggle/theme-toggle');

beforeEach(() => {
  currentTheme = 'light';
  setThemeSpy.mockClear();
});
afterEach(cleanup);

describe('ThemeToggle — 755-M4', () => {
  it('renders exactly one accessible button (no nested interactives)', () => {
    const { container } = render(<ThemeToggle />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    // Hard guard against the prod a11y build breaker: no interactive nested in the control.
    expect(container.querySelectorAll('button button, button a')).toHaveLength(0);
    expect(buttons[0]).toHaveAttribute('type', 'button');
  });

  it('exposes an accessible label that reflects the current choice (light → "dark")', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Switch to dark theme');
  });

  it('advances light → dark on click and persists the next choice via setTheme', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(setThemeSpy).toHaveBeenCalledTimes(1);
    expect(setThemeSpy).toHaveBeenCalledWith('dark');
  });

  it('advances dark → system', () => {
    currentTheme = 'dark';
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Switch to system theme');
    fireEvent.click(screen.getByRole('button'));
    expect(setThemeSpy).toHaveBeenCalledWith('system');
  });

  it('advances system → light (wraps the cycle)', () => {
    currentTheme = 'system';
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Switch to light theme');
    fireEvent.click(screen.getByRole('button'));
    expect(setThemeSpy).toHaveBeenCalledWith('light');
  });

  it('treats an unknown/undefined stored theme as system (safe default)', () => {
    // @ts-expect-error — intentionally exercise the runtime fallback for an out-of-range value.
    currentTheme = undefined;
    render(<ThemeToggle />);
    // Falls back to the system choice → its label is "Switch to light theme".
    expect(screen.getByRole('button')).toHaveAccessibleName('Switch to light theme');
    fireEvent.click(screen.getByRole('button'));
    expect(setThemeSpy).toHaveBeenCalledWith('light');
  });

  it('reflects the active choice in data-theme-choice after mount', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAttribute('data-theme-choice', 'light');
  });
});
