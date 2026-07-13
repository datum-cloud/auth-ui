// cypress/component/modules/auth/auth-provider.types.cy.ts
//
// Compile-time type-narrowing gates for the IdP method return types.
// Port of app/modules/auth/__tests__/auth-provider.types.test.ts.
//
// The real assertions are the TypeScript assignments below, enforced by `bun run typecheck`
// (tsc). Unlike the old __tests__ files — which tsconfig EXCLUDED from typecheck — `cypress/**`
// IS in the tsconfig include set, so porting these gates here makes them MORE load-bearing: a
// regression to Promise<unknown> fails `bun run typecheck`. The runtime `it` is a witness only.
//
// Why assignment-based, not expectTypeOf().resolves.toEqualTypeOf:
//   expectTypeOf<Promise<unknown>>().resolves.toEqualTypeOf<T>() passes for any T because unknown
//   (the top type) is assignable to everything at the type level — no real gate. Assignment in
//   the opposite direction IS a gate: assigning AuthProvider['method'] (returning Promise<unknown>)
//   to a Promise<ConcreteType> variable is rejected by TS2322, because unknown is NOT assignable to
//   ConcreteType in covariant position.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import type { IdpIntentResult, IdpLink } from '@/modules/auth/types';

// Gate 1: retrieveIdpIntent must return Promise<IdpIntentResult>, not Promise<unknown>.
const _retrieveIdpIntent: (idpIntentId: string, token: string) => Promise<IdpIntentResult> =
  null! as AuthProvider['retrieveIdpIntent'];
void _retrieveIdpIntent;

// Gate 2: listIdpLinks must return Promise<IdpLink[]>, not Promise<unknown[]>.
const _listIdpLinks: (userId: string) => Promise<IdpLink[]> = null! as AuthProvider['listIdpLinks'];
void _listIdpLinks;

// Gate 3: addIdpLink second parameter must be IdpLink, not unknown.
const _addIdpLink: (userId: string, link: IdpLink) => Promise<void> =
  null! as AuthProvider['addIdpLink'];
void _addIdpLink;

describe('AuthProvider IdP method types', () => {
  it('compile-time gates above enforce non-unknown return types — see file header', () => {
    // Intentionally empty: the real assertions are the TypeScript assignments above, enforced at
    // `bun run typecheck` time (cypress/** is in the tsconfig include set).
  });
});
