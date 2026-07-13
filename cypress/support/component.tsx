import './remix-stub';
// ensures the stub module is bundled
import { RemixStub } from './remix-stub';
import '@/styles/root.css';
import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import '@testing-library/cypress/add-commands';
import { mount } from 'cypress/react';
import type { MountOptions, MountReturn } from 'cypress/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { MemoryRouterProps } from 'react-router';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      mount(
        component: React.ReactNode,
        options?: MountOptions & MemoryRouterProps & { path?: string; locale?: string }
      ): Cypress.Chainable<MountReturn>;
      mountRemixRoute(
        component: React.ReactNode,
        options?: {
          initialEntries?: string[];
          initialIndex?: number;
          path?: string;
          remixStubProps?: Record<string, unknown>;
          [key: string]: unknown;
        }
      ): Cypress.Chainable<MountReturn>;
    }
  }
}

function withI18n(node: React.ReactNode, locale = 'en') {
  const i18n = setupI18n({ locale, messages: { [locale]: {} } });
  return <I18nProvider i18n={i18n}>{node}</I18nProvider>;
}

Cypress.Commands.add('mount', (component, options = {}) => {
  const {
    initialEntries = ['/login'],
    initialIndex = 0,
    path = '/login',
    locale = 'en',
    ...mountOptions
  } = options as MountOptions & MemoryRouterProps & { path?: string; locale?: string };

  const wrapped = (
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <Routes>
        <Route path={path} element={withI18n(component, locale)} />
      </Routes>
    </MemoryRouter>
  );
  return mount(wrapped, mountOptions);
});

Cypress.Commands.add('mountRemixRoute', (component, options = {}) => {
  const {
    initialEntries = ['/'],
    initialIndex = 0,
    path = '/',
    remixStubProps = {},
    ...mountOptions
  } = options as {
    initialEntries?: string[];
    initialIndex?: number;
    path?: string;
    remixStubProps?: Record<string, unknown>;
  };
  return mount(
    withI18n(
      <RemixStub
        initialEntries={initialEntries}
        initialIndex={initialIndex}
        path={path}
        remixStubProps={remixStubProps}>
        {component}
      </RemixStub>
    ),
    mountOptions as MountOptions
  );
});
