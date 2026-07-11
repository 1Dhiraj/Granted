import { isRestartEnabled } from "../../config/commands.js";
import { loadConfig } from "../../config/config.js";
import { extractDeliveryInfo } from "../../config/sessions.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { formatControlPlaneActor, resolveControlPlaneActor } from "../control-plane-audit.js";
import { ErrorCodes, errorShape, validateGatewayRestartParams } from "../protocol/index.js";
import { parseRestartRequestParams } from "./restart-request.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

export const gatewayRestartHandlers: GatewayRequestHandlers = {
  "gateway.restart": async ({ params, respond, client, context }) => {
    if (!assertValidParams(params, validateGatewayRestartParams, "gateway.restart", respond)) {
      return;
    }
    const config = loadConfig();
    if (!isRestartEnabled(config)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "Gateway restart is disabled (commands.restart=false)."),
      );
      return;
    }
    const actor = resolveControlPlaneActor(client);
    const { sessionKey, note, restartDelayMs } = parseRestartRequestParams(params);
    const reason = normalizeOptionalString((params as { reason?: unknown }).reason)?.slice(0, 200);
    const { deliveryContext, threadId } = extractDeliveryInfo(sessionKey);

    const payload: RestartSentinelPayload = {
      kind: "restart",
      status: "ok",
      ts: Date.now(),
      sessionKey,
      deliveryContext,
      threadId,
      message: note ?? reason ?? null,
      doctorHint: formatDoctorNonInteractiveHint(),
      stats: {
        mode: "gateway.restart",
        reason,
      },
    };
    let sentinelPath: string | null = null;
    try {
      sentinelPath = await writeRestartSentinel(payload);
    } catch {
      sentinelPath = null;
    }

    const restart = scheduleGatewaySigusr1Restart({
      delayMs: restartDelayMs,
      reason: reason ?? "gateway.restart",
      audit: {
        actor: actor.actor,
        deviceId: actor.deviceId,
        clientIp: actor.clientIp,
        changedPaths: [],
      },
    });
    context?.logGateway?.info(
      `gateway.restart scheduled ${formatControlPlaneActor(actor)} delayMs=${restart?.delayMs ?? "default"} reason=${reason ?? "none"}`,
    );

    respond(
      true,
      {
        ok: true,
        restart,
        sentinel: {
          path: sentinelPath,
          payload,
        },
      },
      undefined,
    );
  },
};
