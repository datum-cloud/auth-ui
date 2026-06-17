// @vitest-environment happy-dom
import { WebAuthnButton } from '@/components/webauthn-button/webauthn-button';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';

// The lingui macro is a babel transform — it does not run under vitest's plain
// esbuild pipeline. Replace Trans with a passthrough that renders its children.
vi.mock('@lingui/react/macro', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock react-router hooks used by WebAuthnButton
vi.mock('react-router', () => ({
  useNavigation: () => ({ state: 'idle' }),
  useSubmit: () => vi.fn(),
}));

// Mock isWebAuthnSupported to return true so the null-publicKey guard is reached
// rather than falling through to the CYPRESS_CREDENTIAL shortcut
// (in happy-dom window.PublicKeyCredential is undefined, which would skip the error branches).
vi.mock('@/resources/webauthn/webauthn', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/resources/webauthn/webauthn')>();
  return { ...mod, isWebAuthnSupported: () => true };
});

function renderBtn(mode: 'assertion' | 'attestation') {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  const formRef = createRef<HTMLFormElement>();
  return render(
    <I18nProvider i18n={i18n}>
      <form ref={formRef}>
        <WebAuthnButton publicKey={null} formRef={formRef} mode={mode} />
      </form>
    </I18nProvider>
  );
}

describe('WebAuthnButton failure copy (CODE-MIN-30)', () => {
  it('attestation failure does not reuse the verification wording', async () => {
    renderBtn('attestation');
    const btn = await screen.findByRole('button');
    fireEvent.click(btn);
    // Should show enrollment wording (set up / enroll / registration)
    expect(await screen.findByText(/enroll|registration|set up/i)).toBeTruthy();
    // Must NOT show the assertion-specific "verification failed" wording
    expect(screen.queryByText(/verification failed/i)).toBeNull();
  });

  it('assertion failure shows the verification wording', async () => {
    renderBtn('assertion');
    const btn = await screen.findByRole('button');
    fireEvent.click(btn);
    expect(await screen.findByText(/verification failed/i)).toBeTruthy();
  });
});
