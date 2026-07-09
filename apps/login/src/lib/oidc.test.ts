import { Session } from "@zitadel/proto/zitadel/session/v2/session_pb";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/server/loginname", () => ({
  sendLoginname: vi.fn(),
}));
vi.mock("@/lib/zitadel", () => ({
  createCallback: vi.fn(),
  getLoginSettings: vi.fn(),
  listAuthenticationMethodTypes: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("./session", () => ({
  isSessionValid: vi.fn(),
}));
vi.mock("./verify-helper", () => ({
  checkMFAFactors: vi.fn(),
}));

import { sendLoginname } from "@/lib/server/loginname";
import * as Sentry from "@sentry/nextjs";
import { loginWithOIDCAndSession } from "./oidc";
import { isSessionValid } from "./session";

const expiredSession = {
  id: "session-1",
  factors: {
    user: {
      id: "user-1",
      loginName: "user@example.com",
      organizationId: "org-1",
    },
    // no intent factor: user did not authenticate via an IDP
  },
} as unknown as Session;

const baseArgs = {
  serviceUrl: "https://zitadel.example.com",
  authRequest: "V2_authrequest-1",
  sessionId: "session-1",
  sessions: [expiredSession],
  sessionCookies: [],
  request: new NextRequest("https://auth.example.com/oidc/login"),
};

describe("loginWithOIDCAndSession", () => {
  beforeEach(() => {
    vi.mocked(isSessionValid).mockResolvedValue(false);
    vi.mocked(sendLoginname).mockReset();
    vi.mocked(Sentry.captureException).mockReset();
  });

  test("does not throw when sendLoginname rejects for an expired session", async () => {
    vi.mocked(sendLoginname).mockRejectedValue(
      new Error("Could not get domain"),
    );

    await expect(loginWithOIDCAndSession(baseArgs)).resolves.not.toThrow();
  });

  test("reports the sendLoginname failure to Sentry instead of swallowing it silently", async () => {
    const error = new Error("Could not get domain");
    vi.mocked(sendLoginname).mockRejectedValue(error);

    await loginWithOIDCAndSession(baseArgs);

    expect(Sentry.captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        tags: { flow: "oidc", stage: "reauth_sendLoginname" },
      }),
    );
  });

  test("still redirects when sendLoginname resolves with a redirect", async () => {
    vi.mocked(sendLoginname).mockResolvedValue({
      redirect: "/loginname?requestId=oidc_V2_authrequest-1",
    });

    const res = await loginWithOIDCAndSession(baseArgs);

    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/loginname");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
