// app/resources/recovery/recovery.schema.ts
//
// The /recover action's input shapes. Note what is ABSENT: there is no `userId`. The requesting
// device never learns which account its address maps to — that fact lives sealed in the ticket —
// so accepting a client-supplied userId would let anyone start a recovery for an account they
// only guessed the id of.
import { z } from 'zod';

export const recoveryRequestSchema = z.object({
  email: z.email(),
  organization: z.string().optional(),
  requestId: z.string().optional(),
});

// No shape rule on the code, deliberately: its format (length, alphabet) is Zitadel
// configuration we do not own, so a client-side rule here would reject valid codes the moment
// infra retunes SecretGenerators. Trimmed because mail clients love to append a space.
export const recoveryCodeSchema = recoveryRequestSchema.extend({
  code: z.string().trim().min(1),
});

export type RecoveryRequestInput = z.infer<typeof recoveryRequestSchema>;
export type RecoveryCodeInput = z.infer<typeof recoveryCodeSchema>;
