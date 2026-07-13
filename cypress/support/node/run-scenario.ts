// cypress/support/node/run-scenario.ts
//
// Bun CLI entry for the node-spec harness. Invoked by the `callService` cy.task (see tasks.ts) as
//   bun cypress/support/node/run-scenario.ts '<scenario-json>'
// from the repo root, so Bun resolves the `@/*` tsconfig path alias the real app modules use.
//
// Required env is set HERE, before harness.ts (and therefore env.server's load-time schema parse)
// is dynamically imported. AUTH_PROVIDER=fake is the ONLY substitution; everything else is real.
process.env.SESSION_SECRET ??= 'cypress-node-spec-harness-session-secret-key';
process.env.AUTH_PROVIDER = 'fake';
process.env.NODE_ENV ??= 'test';

// Markers let the task extract the verdict from stdout even if module init prints other noise.
const START = '__VERDICT_START__';
const END = '__VERDICT_END__';

async function main(): Promise<void> {
  const raw = process.argv[2];
  let verdict: unknown;
  try {
    if (!raw) throw new Error('run-scenario: missing scenario JSON argv[2]');
    const scenario = JSON.parse(raw);
    // Per-scenario env (e.g. POST_LOGOUT_ALLOWLIST) must be set before the app modules load.
    for (const [k, v] of Object.entries((scenario.env ?? {}) as Record<string, string>)) {
      process.env[k] = v;
    }
    const { runScenario } = await import('./harness');
    verdict = await runScenario(scenario);
  } catch (err) {
    verdict = {
      ok: false,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
      audit: [],
      auditLines: [],
    };
  }
  process.stdout.write(`${START}${JSON.stringify(verdict)}${END}`);
}

void main();
