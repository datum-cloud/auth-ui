// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    {
      // The composition seam: only server/composition.ts may reach across into a provider
      // adapter. A provider package composing its OWN cohesive sibling modules
      // (the zitadel monolith was decomposed into capability modules under
      // providers/zitadel/ — index.ts delegates to user/settings/session/… which share
      // mappers/transport) is intra-package composition, not a cross-boundary import, so it
      // is exempted via the `from` pathNot. The guard still flags every import that reaches
      // into providers/ from OUTSIDE the providers tree (e.g. select.server.ts).
      // Exemptions:
      //  - Test files (`__tests__/` and `*.{test,spec}.{ts,tsx}`) legitimately import the
      //    fake provider directly to drive service/route units against a deterministic
      //    in-process double. This is test wiring, not production cross-boundary coupling.
      //  - `app/modules/auth/select.server.ts` is the provider registry seam: the
      //    single concrete-provider selection site (zitadel|fake), a legitimate second
      //    composition seam alongside server/composition.ts. It is the one place outside the
      //    providers tree allowed to name a concrete provider.
      name: 'only-composition-imports-providers',
      severity: 'error',
      from: {
        pathNot:
          'app/server/composition\\.ts$|^app/modules/auth/providers/|__tests__/|\\.(test|spec)\\.(ts|tsx)$|^app/modules/auth/select\\.server\\.ts$',
      },
      to: { path: 'app/modules/auth/providers/' },
    },
    {
      name: 'resources-not-server-edge',
      severity: 'error',
      from: { path: 'app/resources/' },
      to: { path: 'app/server/edge/' },
    },
    {
      name: 'shared-is-leaf',
      severity: 'error',
      from: { path: 'app/shared/' },
      to: { path: 'app/(routes|resources|modules|server|components)/' },
    },
    {
      // `app/routes/paths.ts` is a pure typed-path constant module (URL string builders,
      // no route/loader/action behavior). Resources importing it for redirect targets is a
      // constant dependency, not a layering violation, so it is exempted from this guard.
      name: 'no-routes-from-resources',
      severity: 'error',
      from: { path: 'app/resources/' },
      to: { path: 'app/routes/', pathNot: 'app/routes/paths\\.ts$' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
  },
};
