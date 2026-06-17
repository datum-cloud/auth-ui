export interface SessionRef {
  id: string;
  token: string;
}

export interface DeviceDecisionInput {
  decision: 'authorize' | 'deny';
  session?: SessionRef;
}

export type DeviceDecisionResult = { session?: SessionRef };

/** Pure: maps a UI decision to the `authorizeDevice` argument shape (P6). */
export function deviceDecision(input: DeviceDecisionInput): DeviceDecisionResult {
  if (input.decision === 'deny') return {};
  if (!input.session) throw new Error('session required to authorize a device');
  return { session: input.session };
}
