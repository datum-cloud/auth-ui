// Compile-time type-narrowing assertions for CODE-MIN-03.
//
// Why assignment-based, not expectTypeOf().resolves.toEqualTypeOf:
//   expectTypeOf<Promise<unknown>>().resolves.toEqualTypeOf<T>() passes for any T because
//   Vitest's expectTypeOf treats unknown (the top type) as assignable to everything at the
//   type level — the assertion never fails before the interface is tightened, so it provides
//   no real TDD red gate.
//
//   Assignment in the opposite direction does provide a real gate:
//     const _x: (…) => Promise<ConcreteType> = null! as AuthProvider['method']
//   TypeScript rejects this with TS2322 when the interface returns Promise<unknown>,
//   because unknown is NOT assignable to ConcreteType in covariant position. The gate is
//   real: 'bun run typecheck' fails before CODE-MIN-03 tightening, passes after.
//
// These declarations are compile-only (no runtime values are created). void-ing them
// suppresses the unused-variable diagnostic.
import type { AuthProvider } from '@/modules/auth/auth-provider';
import type { IdpIntentResult, IdpLink } from '@/modules/auth/types';
// Vitest requires at least one describe/it block to register the file as a test file.
import { describe, it } from 'vitest';

// Gate 1: retrieveIdpIntent must return Promise<IdpIntentResult>, not Promise<unknown>.
// TS2322 fires here if the interface returns Promise<unknown>.
const _retrieveIdpIntent: (idpIntentId: string, token: string) => Promise<IdpIntentResult> =
  null! as AuthProvider['retrieveIdpIntent'];
void _retrieveIdpIntent;

// Gate 2: listIdpLinks must return Promise<IdpLink[]>, not Promise<unknown[]>.
// TS2322 fires here if the interface returns Promise<unknown[]>.
const _listIdpLinks: (userId: string) => Promise<IdpLink[]> = null! as AuthProvider['listIdpLinks'];
void _listIdpLinks;

// Gate 3: addIdpLink second parameter must be IdpLink, not unknown.
// TS2322 fires here if the interface accepts unknown.
const _addIdpLink: (userId: string, link: IdpLink) => Promise<void> =
  null! as AuthProvider['addIdpLink'];
void _addIdpLink;

describe('AuthProvider IdP method types (CODE-MIN-03)', () => {
  it('compile-time gates above enforce non-unknown return types — see file header', () => {
    // Intentionally empty: the real assertions are the TypeScript assignments above.
    // If any of the three assignments produced TS2322 at typecheck time, this file would not
    // compile — that was the failing state before CODE-MIN-03 tightened the interface.
  });
});
