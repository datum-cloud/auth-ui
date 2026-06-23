import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';

describe('@tanstack is fully removed', () => {
  it('no app source imports @tanstack/*', () => {
    const hits = execSync(
      `git grep -lE "@tanstack/(react-query|react-virtual)" -- 'app/**' || true`,
      { encoding: 'utf-8' }
    ).trim();
    expect(hits, `unexpected @tanstack imports:\n${hits}`).toBe('');
  });
});
