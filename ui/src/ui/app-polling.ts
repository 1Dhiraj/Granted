import type { OpenClawApp } from "./app.ts";
import { loadAgentsActivity } from "./controllers/agents.ts";
import { loadDebug } from "./controllers/debug.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";

type PollingHost = {
  nodesPollInterval: number | null;
  logsPollInterval: number | null;
  debugPollInterval: number | null;
  agentsActivityPollInterval?: number | null;
  tab: string;
};

// Live "which agents are working" — polled only while the world or agents
// tab is visible so the rest of the app pays nothing.
export function startAgentsActivityPolling(host: PollingHost) {
  if (host.agentsActivityPollInterval != null) {
    return;
  }
  host.agentsActivityPollInterval = window.setInterval(() => {
    if (host.tab !== "world" && host.tab !== "agents") {
      return;
    }
    void loadAgentsActivity(host as unknown as OpenClawApp);
  }, 4000);
}

export function stopAgentsActivityPolling(host: PollingHost) {
  if (host.agentsActivityPollInterval == null) {
    return;
  }
  clearInterval(host.agentsActivityPollInterval);
  host.agentsActivityPollInterval = null;
}

export function startNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval != null) {
    return;
  }
  host.nodesPollInterval = window.setInterval(
    () => void loadNodes(host as unknown as OpenClawApp, { quiet: true }),
    5000,
  );
}

export function stopNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval == null) {
    return;
  }
  clearInterval(host.nodesPollInterval);
  host.nodesPollInterval = null;
}

export function startLogsPolling(host: PollingHost) {
  if (host.logsPollInterval != null) {
    return;
  }
  host.logsPollInterval = window.setInterval(() => {
    if (host.tab !== "logs") {
      return;
    }
    void loadLogs(host as unknown as OpenClawApp, { quiet: true });
  }, 2000);
}

export function stopLogsPolling(host: PollingHost) {
  if (host.logsPollInterval == null) {
    return;
  }
  clearInterval(host.logsPollInterval);
  host.logsPollInterval = null;
}

export function startDebugPolling(host: PollingHost) {
  if (host.debugPollInterval != null) {
    return;
  }
  host.debugPollInterval = window.setInterval(() => {
    if (host.tab !== "debug") {
      return;
    }
    void loadDebug(host as unknown as OpenClawApp);
  }, 3000);
}

export function stopDebugPolling(host: PollingHost) {
  if (host.debugPollInterval == null) {
    return;
  }
  clearInterval(host.debugPollInterval);
  host.debugPollInterval = null;
}
