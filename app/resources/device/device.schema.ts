// Client-safe zod schemas for the device domain.
// No server-only imports here, so route components can import these without
// pulling the server-only device.service (cookie/env.server, observability/sentry)
// into the client bundle.
import { z } from 'zod';

export const codeSchema = z.object({ userCode: z.string().min(1) });
