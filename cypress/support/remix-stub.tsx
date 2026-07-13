/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';

interface RemixStubProps {
  children: React.ReactNode;
  initialEntries?: string[];
  initialIndex?: number;
  path?: string;
  remixStubProps?: {
    loaderData?: Record<string, any>;
    actionData?: Record<string, any> | null;
    [key: string]: any;
  };
}

export const RemixStub: React.FC<RemixStubProps> = ({
  children,
  initialEntries = ['/'],
  initialIndex = 0,
  path = '/',
  remixStubProps = {},
}) => {
  const router = createMemoryRouter(
    [
      {
        path,
        element: <>{children}</>,
        loader: () => remixStubProps.loaderData ?? {},
        action: () => remixStubProps.actionData ?? null,
      },
    ],
    { initialEntries, initialIndex }
  );
  return <RouterProvider router={router} />;
};
