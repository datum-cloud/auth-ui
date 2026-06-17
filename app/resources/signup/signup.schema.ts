import { z } from 'zod';

// NOTE: zod 4 ships z.email() as a top-level validator; z.string().email() still works
// (it delegates to z.email() internally) — we keep the string().email() form here
// because it keeps the schema consistent with the other string fields and satisfies
// the locked spec. If z.string().email() is deprecated in a future minor, swap to
// z.email() and drop the z.string() wrapper.
export const registerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  deviceTrackingToken: z.string().optional(),
  requestId: z.string().optional(),
  organization: z.string().optional(),
});

// client-side validation subset; advisory only (the server action's registerSchema is the real gate)
export const registerClientSchema = registerSchema.pick({
  email: true,
  firstName: true,
  lastName: true,
});

export const signupPasswordSchema = z
  .object({ password: z.string().min(8), confirm: z.string().min(8) })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords must match' });
