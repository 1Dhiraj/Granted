import { describe, expect, it } from "vitest";
import { humanizeGatewayError } from "./connection-status.ts";

describe("humanizeGatewayError", () => {
  it("returns null for empty input", () => {
    expect(humanizeGatewayError(null)).toBeNull();
    expect(humanizeGatewayError("")).toBeNull();
    expect(humanizeGatewayError("   ")).toBeNull();
  });

  it("humanizes plain disconnects and keeps the raw string", () => {
    const friendly = humanizeGatewayError("disconnected (1006): no reason");
    expect(friendly?.title).toBe("Connection to the gateway was lost.");
    expect(friendly?.raw).toBe("disconnected (1006): no reason");
  });

  it("maps pairing-required disconnects to approval copy", () => {
    const byCode = humanizeGatewayError("disconnected (1008): pairing required");
    expect(byCode?.title).toBe("This device is waiting for approval.");
    const byText = humanizeGatewayError("gateway pairing required");
    expect(byText?.title).toBe("This device is waiting for approval.");
  });

  it("maps auth failures", () => {
    expect(humanizeGatewayError("disconnected (4008): unauthorized")?.title).toBe(
      "The gateway rejected this sign-in.",
    );
    expect(humanizeGatewayError("gateway token mismatch")?.title).toBe(
      "The gateway rejected this sign-in.",
    );
  });

  it("maps unreachable/connect failures", () => {
    expect(humanizeGatewayError("gateway connect failed")?.title).toBe("Can't reach the gateway.");
    expect(humanizeGatewayError("disconnected (4008): connect failed")?.title).toBe(
      "Can't reach the gateway.",
    );
  });

  it("strips Error: prefixes and maps not-connected", () => {
    expect(humanizeGatewayError("Error: gateway not connected")?.title).toBe(
      "Not connected to the gateway.",
    );
  });

  it("passes unknown errors through unchanged", () => {
    const friendly = humanizeGatewayError("Failed to set model: boom");
    expect(friendly?.title).toBe("Failed to set model: boom");
    expect(friendly?.hint).toBeUndefined();
  });
});
