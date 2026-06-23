// app/shared — the framework-free KERNEL leaf.
// Imports nothing app-level; importable by every layer including components.
//
// CSRF_FORM_KEY is the single source for the CSRF hidden-input field name. It lives
// HERE (not in app/server/csrf.ts) so <CsrfInput> — a component — can import it
// without violating the components → server import ban. app/server/csrf.ts
// consumes the same constant in `new CSRF({ formDataKey: CSRF_FORM_KEY })`,
// making a future rename a single typed edit.
export const CSRF_FORM_KEY = 'csrf';
