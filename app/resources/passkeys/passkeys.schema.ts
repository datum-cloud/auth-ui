import { z } from 'zod';

/** /id/passkeys action intents: remove one passkey, or sign out the other cookie sessions. */
export const passkeysActionSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('remove'), passkeyId: z.string().min(1) }),
  z.object({ intent: z.literal('signout-others') }),
]);

export type PasskeysActionInput = z.infer<typeof passkeysActionSchema>;
