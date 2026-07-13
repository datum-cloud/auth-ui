// cypress/support/node/tasks.ts
//
// Registers the `callService` cy.task used by the node-bound (cookie-dependent) component specs.
// This file is bundled into the Cypress config process, so it MUST stay free of any `@/` app
// import — it only shells out to Bun, which runs the real services with full tsconfig-path
// resolution (see run-scenario.ts / harness.ts). The verdict is returned to the spec, which makes
// every assertion browser-side with Chai.
import { runCeremonyGuard } from '../ceremony-guard';
import type Cypress from 'cypress';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const START = '__VERDICT_START__';
const END = '__VERDICT_END__';

// The Cypress config is loaded as native ESM (package.json "type": "module"), so derive the
// directory from import.meta.url rather than the CJS __dirname.
const HERE = dirname(fileURLToPath(import.meta.url));
// Repo root = three levels up from cypress/support/node. Bun is spawned with cwd here so it picks
// up the root tsconfig's `@/*` paths when importing the app modules.
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const RUNNER = resolve(HERE, 'run-scenario.ts');
const BUN_BIN = process.env.BUN_BIN ?? 'bun';

interface RunFailure {
  ok: false;
  error: string;
  audit: [];
  auditLines: [];
}

function runScenarioViaBun(scenario: unknown): unknown {
  let stdout: string;
  try {
    stdout = execFileSync(BUN_BIN, [RUNNER, JSON.stringify(scenario)], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
      env: { ...process.env, AUTH_PROVIDER: 'fake' },
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    // Bun exited non-zero — surface its stdout (may still carry a verdict) then stderr.
    stdout = e.stdout ?? '';
    if (!stdout.includes(START)) {
      const failure: RunFailure = {
        ok: false,
        error: `bun runner failed: ${e.stderr || e.message || 'unknown error'}`,
        audit: [],
        auditLines: [],
      };
      return failure;
    }
  }

  const start = stdout.indexOf(START);
  const end = stdout.indexOf(END);
  if (start === -1 || end === -1) {
    const failure: RunFailure = {
      ok: false,
      error: `no verdict marker in runner output: ${stdout.slice(0, 2000)}`,
      audit: [],
      auditLines: [],
    };
    return failure;
  }
  return JSON.parse(stdout.slice(start + START.length, end));
}

/**
 * Register node-spec tasks on the Cypress component event bus. Call from
 * setupNodeEvents(on, config). `callService` runs a serializable scenario through the real
 * cookie/session/audit code in Bun and returns a serializable verdict.
 */
export function registerNodeTasks(on: Cypress.PluginEvents): void {
  on('task', {
    callService(scenario: unknown) {
      return runScenarioViaBun(scenario);
    },
    // Regression guardrail: static-analysis scan for ceremony-param-dropping literal patterns
    // across app/routes/** + the shared redirect-target helpers. Pure Node fs — no Bun subprocess
    // needed (see cypress/support/ceremony-guard.ts).
    ceremonyGuard() {
      return runCeremonyGuard();
    },
  });
}
