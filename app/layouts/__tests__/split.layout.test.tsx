// @vitest-environment happy-dom
//
// 755-M3 · Side-panel imagery must reserve layout space (no CLS) and render crisply.
//
// The two line-art illustrations + the signature are low-res rasters and a designer-provided
// SVG/AVIF replacement is still outstanding (flagged in the route comments). Until those land,
// this test pins the contract we CAN guarantee from the markup:
//   • every decorative <img> carries explicit width/height (intrinsic ratio) so the browser
//     reserves the box and never shifts surrounding content while the asset loads (CLS = 0);
//   • the line-art illustrations use object-contain (crisp/uncropped) rather than object-cover.
// (The avatar's 2x srcset/dimensions are applied in source but render through Radix's deferred
//  <AvatarImage>, which happy-dom doesn't load — see the NOTE below the assertions.)
import { ConformAdapter } from '@datum-cloud/datum-ui/form/adapters/conform';
import '@testing-library/jest-dom/vitest';
import { render, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createRoutesStub } from 'react-router';
import { describe, it, expect, vi, afterEach } from 'vitest';

// Lingui macro is a Babel transform — passthrough it under vitest's esbuild pipeline.
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLingui: () => ({ t: (s: TemplateStringsArray) => String(s.join('')) }),
}));

const { default: SplitLayout } = await import('@/layouts/split.layout');

function mount() {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <SplitLayout>
          <p>form</p>
        </SplitLayout>
      ),
    },
  ]);
  return render(
    <ConformAdapter>
      <Stub initialEntries={['/']} />
    </ConformAdapter>
  );
}

afterEach(cleanup);

// Match each side-panel asset by the tail of its src (assetUrl prefixes BASE_URL).
const bySrcTail = (container: HTMLElement, tail: string): HTMLImageElement => {
  const img = Array.from(container.querySelectorAll('img')).find((i) =>
    (i.getAttribute('src') ?? '').endsWith(tail)
  );
  expect(img, `expected an <img> whose src ends with ${tail}`).toBeTruthy();
  return img as HTMLImageElement;
};

describe('SplitLayout — 755-M3 side-panel imagery (CLS + crispness)', () => {
  it('gives illustration-1 explicit intrinsic dimensions + object-contain (no CLS, no crop)', () => {
    const { container } = mount();
    const img = bySrcTail(container, 'images/illustration-1.svg');
    expect(img.getAttribute('width')).toBe('707');
    expect(img.getAttribute('height')).toBe('155');
    expect(img.className).toContain('object-contain');
  });

  it('gives illustration-2 explicit intrinsic dimensions + object-contain', () => {
    const { container } = mount();
    const img = bySrcTail(container, 'images/illustration-2.svg');
    expect(img.getAttribute('width')).toBe('232');
    expect(img.getAttribute('height')).toBe('290');
    expect(img.className).toContain('object-contain');
  });

  it('gives the signature explicit dimensions + object-contain', () => {
    const { container } = mount();
    const img = bySrcTail(container, 'images/zac-sign.png');
    expect(img.getAttribute('width')).toBe('95');
    expect(img.getAttribute('height')).toBe('38');
    expect(img.className).toContain('object-contain');
  });

  // NOTE: the avatar's width/height + 2x srcset (added for 755-M3) are passed through Radix's
  // <AvatarImage>, which only commits the underlying <img> to the DOM after a successful load
  // event. happy-dom never fires that load, so the fallback renders here and the <img> is not
  // queryable — those props are verified by inspection of split.layout.tsx, not asserted in DOM.

  it('keeps every queryable decorative side-panel image dimensioned (CLS guard)', () => {
    const { container } = mount();
    for (const tail of [
      'images/illustration-1.svg',
      'images/illustration-2.svg',
      'images/zac-sign.png',
    ]) {
      const img = bySrcTail(container, tail);
      expect(img.getAttribute('width')).toBeTruthy();
      expect(img.getAttribute('height')).toBeTruthy();
    }
  });
});

// 755-M4 · dark-mode token-ization. The side-panel copy used hardcoded greys (#67717C / #595F65)
// that don't adapt to dark; they're now semantic `text-muted-foreground` so they flip with the
// theme. This pins that the raw hex greys are gone from the rendered markup.
describe('SplitLayout — 755-M4 dark-mode tokens', () => {
  it('uses semantic muted-foreground instead of hardcoded grey hex for the side-panel copy', () => {
    const { container } = mount();
    expect(container.innerHTML).not.toContain('#67717C');
    expect(container.innerHTML).not.toContain('#595F65');
    expect(container.querySelector('.text-muted-foreground')).toBeTruthy();
  });
});
