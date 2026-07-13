// Shared execution context for the capability modules.
//
// The ZitadelAuthProvider class is a thin composition root: it owns `opts` and the two
// cross-cutting primitives every RPC needs — `svc()` (build a token-quarantined service
// client) and `call()` (bound each RPC by a deadline + normalise provider errors). Each
// capability module is a set of free functions that take this `ZitadelCtx` and the method
// args, so the behaviour is unchanged from the former monolith — only the file boundary moved.
import { normalizeError } from './mappers';
import { TIMEOUTS } from './timeouts';
// value import — never `import type`; instanceof checks require the runtime class
import { createServiceClient, type TransportEnv } from './transport';
import { ProviderError } from '@/modules/auth/types';
import type { DescService } from '@bufbuild/protobuf';

export interface ZitadelOpts {
  serviceUrl: string;
  serviceToken: string;
  env?: TransportEnv;
}

// Bound any single RPC. Promise.race returns control to the handler
// on deadline; the underlying socket is best-effort and will be GC'd. Mapped to UNAVAILABLE
// so callers treat it like any transient backend failure.
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderError('UNAVAILABLE', 'Zitadel RPC timed out')), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// The shared surface every capability free-function receives. `opts` is exposed so the
// rare methods that need the raw serviceUrl/serviceToken/env (changePasswordWithSession's
// session-token client, isInstanceAdmin's REST fetch) can reach them without a back-channel.
export interface ZitadelCtx {
  readonly opts: ZitadelOpts;
  svc<T extends DescService>(
    service: Parameters<typeof createServiceClient<T>>[0]
  ): ReturnType<typeof createServiceClient<T>>;
  call<T>(fn: () => Promise<T>): Promise<T>;
}

// Build the context the capability modules run against. Identical behaviour to the former
// private ZitadelAuthProvider.svc()/.call() methods.
export function createZitadelCtx(opts: ZitadelOpts): ZitadelCtx {
  const svc = <T extends DescService>(
    service: Parameters<typeof createServiceClient<T>>[0]
  ): ReturnType<typeof createServiceClient<T>> =>
    createServiceClient<T>(service, opts.serviceToken, opts.serviceUrl, opts.env);

  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await withDeadline(fn(), TIMEOUTS.GRPC_CALL_MS);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw normalizeError(error);
    }
  };

  return { opts, svc, call };
}
