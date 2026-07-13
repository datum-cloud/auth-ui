// Catch-all: delegates to the error screen. Separate module required because
// React Router derives route IDs from file paths — two route() entries pointing
// at the same file produce a duplicate-ID error at build time.
export { default } from './error';
export { meta } from './error';
