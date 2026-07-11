import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RestartSentinelPayload } from "../../infra/restart-sentinel.js";

let capturedPayload: RestartSentinelPayload | undefined;

const scheduleGatewaySigusr1RestartMock = vi.fn(() => ({ scheduled: true, delayMs: 2000 }));
const loadConfigMock = vi.fn<() => Record<string, unknown>>(() => ({}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../../config/sessions.js", () => ({
  extractDeliveryInfo: (sessionKey: string | undefined) => {
    if (!sessionKey) {
      return { deliveryContext: undefined, threadId: undefined };
    }
    return {
      deliveryContext: { channel: "webchat", to: "webchat:user-123", accountId: "default" },
      threadId: undefined,
    };
  },
}));

vi.mock("../../infra/restart-sentinel.js", async () => {
  const actual = await vi.importActual("../../infra/restart-sentinel.js");
  return {
    ...(actual as Record<string, unknown>),
    writeRestartSentinel: async (payload: RestartSentinelPayload) => {
      capturedPayload = payload;
      return "/tmp/sentinel.json";
    },
  };
});

vi.mock("../../infra/restart.js", () => ({
  scheduleGatewaySigusr1Restart: scheduleGatewaySigusr1RestartMock,
}));

vi.mock("./validation.js", () => ({
  assertValidParams: () => true,
}));

beforeEach(() => {
  capturedPayload = undefined;
  scheduleGatewaySigusr1RestartMock.mockClear();
  loadConfigMock.mockReset();
  loadConfigMock.mockReturnValue({});
});

async function invokeGatewayRestart(
  params: Record<string, unknown>,
  respond: ((ok: boolean, response?: unknown, error?: unknown) => void) | undefined = undefined,
) {
  const { gatewayRestartHandlers } = await import("./gateway-restart.js");
  const onRespond = respond ?? (() => {});
  await gatewayRestartHandlers["gateway.restart"]({
    params,
    respond: onRespond as never,
  } as never);
}

describe("gateway.restart", () => {
  it("schedules an in-process restart and responds ok", async () => {
    let payload: { ok: boolean; restart: unknown } | undefined;

    await invokeGatewayRestart({ reason: "cli gateway restart" }, (_ok, response) => {
      payload = response as { ok: boolean; restart: unknown };
    });

    expect(scheduleGatewaySigusr1RestartMock).toHaveBeenCalledTimes(1);
    expect(scheduleGatewaySigusr1RestartMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "cli gateway restart" }),
    );
    expect(payload?.ok).toBe(true);
    expect(payload?.restart).toEqual({ scheduled: true, delayMs: 2000 });
  });

  it("writes a restart sentinel with delivery context from sessionKey", async () => {
    await invokeGatewayRestart({
      sessionKey: "agent:main:webchat:dm:user-123",
      note: "restarting for you",
    });

    expect(capturedPayload).toBeDefined();
    expect(capturedPayload!.kind).toBe("restart");
    expect(capturedPayload!.message).toBe("restarting for you");
    expect(capturedPayload!.deliveryContext).toEqual({
      channel: "webchat",
      to: "webchat:user-123",
      accountId: "default",
    });
  });

  it("passes restartDelayMs through to the scheduler", async () => {
    await invokeGatewayRestart({ restartDelayMs: 5000 });

    expect(scheduleGatewaySigusr1RestartMock).toHaveBeenCalledWith(
      expect.objectContaining({ delayMs: 5000 }),
    );
  });

  it("refuses when commands.restart=false and schedules nothing", async () => {
    loadConfigMock.mockReturnValue({ commands: { restart: false } });

    let respondedOk: boolean | undefined;
    let respondedError: unknown;
    await invokeGatewayRestart({}, (ok, _response, error) => {
      respondedOk = ok;
      respondedError = error;
    });

    expect(respondedOk).toBe(false);
    expect(String((respondedError as { message?: unknown })?.message)).toContain(
      "commands.restart=false",
    );
    expect(scheduleGatewaySigusr1RestartMock).not.toHaveBeenCalled();
    expect(capturedPayload).toBeUndefined();
  });
});
