import { t } from "../i18n/index.ts";

export type FriendlyGatewayError = {
  /** Short, human-readable summary safe to show prominently. */
  title: string;
  /** Optional follow-up line with what to do next. */
  hint?: string;
  /** Original error string, kept for tooltips/debugging. */
  raw: string;
};

const DISCONNECT_RE = /^disconnected \((\d+)\)(?::\s*(.*))?$/i;

function isAuthText(text: string): boolean {
  return (
    text.includes("unauthorized") ||
    text.includes("auth failed") ||
    text.includes("token mismatch") ||
    text.includes("token missing") ||
    text.includes("failed authentication")
  );
}

function isUnreachableText(text: string): boolean {
  return (
    text.includes("connect failed") ||
    text.includes("fetch failed") ||
    text.includes("failed to fetch") ||
    text.includes("econnrefused")
  );
}

/**
 * Translate raw gateway error strings (for example "disconnected (1006): no
 * reason") into calm, actionable copy. Returns null when there is no error.
 * Unknown errors pass through as-is so real diagnostics are never hidden.
 */
export function humanizeGatewayError(
  lastError: string | null | undefined,
): FriendlyGatewayError | null {
  let raw = (lastError ?? "").trim();
  if (!raw) {
    return null;
  }
  // Some callers store errors as `Error: <message>`.
  raw = raw.replace(/^error:\s*/i, "");
  const lower = raw.toLowerCase();

  const disconnect = DISCONNECT_RE.exec(raw);
  if (disconnect) {
    const code = Number(disconnect[1]);
    const reason = (disconnect[2] ?? "").trim().toLowerCase();
    if (code === 1008 || reason.includes("pairing")) {
      return {
        title: t("connection.pairingRequired"),
        hint: t("connection.pairingHint"),
        raw,
      };
    }
    if (isAuthText(reason)) {
      return { title: t("connection.authFailed"), hint: t("connection.authHint"), raw };
    }
    if (isUnreachableText(reason)) {
      return {
        title: t("connection.unreachable"),
        hint: t("connection.unreachableHint"),
        raw,
      };
    }
    return { title: t("connection.lost"), hint: t("connection.lostHint"), raw };
  }

  if (lower.includes("pairing required")) {
    return {
      title: t("connection.pairingRequired"),
      hint: t("connection.pairingHint"),
      raw,
    };
  }
  if (isAuthText(lower)) {
    return { title: t("connection.authFailed"), hint: t("connection.authHint"), raw };
  }
  if (lower === "gateway not connected" || lower === "not connected") {
    return { title: t("connection.notConnected"), raw };
  }
  if (lower.startsWith("event gap detected")) {
    return { title: t("connection.resyncing"), raw };
  }
  if (isUnreachableText(lower)) {
    return {
      title: t("connection.unreachable"),
      hint: t("connection.unreachableHint"),
      raw,
    };
  }
  return { title: raw, raw };
}
