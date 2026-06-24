"use server";

import { authorizeOrDenyDeviceAuthorization } from "@/lib/zitadel";
import { headers } from "next/headers";
import { getServiceUrlFromHeaders } from "../service-url";

export async function completeDeviceAuthorization(
  deviceAuthorizationId: string,
  session?: { sessionId: string; sessionToken: string },
) {
  const _headers = await headers();
  const { serviceUrl } = getServiceUrlFromHeaders(_headers);

  try {
    // without the session, device auth request is denied
    return await authorizeOrDenyDeviceAuthorization({
      serviceUrl,
      deviceAuthorizationId,
      session,
    });
  } catch (error) {
    // The /signedin page completes the device flow during a Server Component
    // render, which the App Router may evaluate more than once per navigation
    // (RSC refetch, prefetch, refresh, retries). The first call authorizes the
    // grant successfully; subsequent calls fail with FAILED_PRECONDITION
    // ("Device Authorization Request has already been handled"). Treat that as
    // success so the user isn't shown a spurious error after a working login.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 9 /* FAILED_PRECONDITION */
    ) {
      return {};
    }

    throw error;
  }
}
