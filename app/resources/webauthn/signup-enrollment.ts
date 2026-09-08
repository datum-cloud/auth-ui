/**
 * Is this /setup/* enrolment the passkey step of SIGNUP, rather than a later visit from
 * security settings?
 *
 * completeEmailLinkSignup (signup.service.ts) is the only caller that sends a user to
 * /setup/passkey with `returnTo` pointing back into /signup — it threads
 * `returnTo=/signup/success?…` so a successful enrolment ends at the signup terminal.
 * Every other entry point (the /passkeys management round-trip, the /setup/mfa chooser)
 * returns somewhere else, so a /signup prefix identifies the signup leg exactly.
 *
 * `returnTo` is safe to branch on: the loader already passed it through validateReturnTo
 * (return-to.ts), which admits only root-relative paths (`/…`, never `//` or `/\`) or
 * allowlisted absolute origins. A caller cannot forge a cross-origin value that starts
 * with `/signup/`.
 *
 * The trailing slash matters — `/signup/` must not also match a sibling route whose name
 * merely begins with "signup".
 */
export function isSignupEnrollment(returnTo: string | null | undefined): boolean {
  return !!returnTo && returnTo.startsWith('/signup/');
}
