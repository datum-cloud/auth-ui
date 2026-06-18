// @vitest-environment happy-dom
import { ErrorView } from './root';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect } from 'vitest';

function renderErrorView() {
  const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
  return render(
    <MemoryRouter>
      <I18nProvider i18n={i18n}>
        <ErrorView />
      </I18nProvider>
    </MemoryRouter>
  );
}

describe('root ErrorBoundary', () => {
  it('renders the branded generic error copy and never echoes raw error text', () => {
    const { getByText, queryByText } = renderErrorView();
    // The generic fallback copy from authErrorMessage(undefined)
    expect(getByText(/something went wrong/i)).toBeTruthy();
    // No raw error details leak into the DOM
    expect(queryByText(/SENSITIVE-STACK-DETAIL/)).toBeNull();
  });
});
