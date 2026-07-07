import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveAgentConfig } from "./agent-scope.js";
import { pickSandboxToolPolicy } from "./sandbox-tool-policy.js";
import { isToolAllowedByPolicies } from "./tool-policy-match.js";
import { mergeAlsoAllowPolicy, resolveToolProfilePolicy } from "./tool-policy.js";

export type ToolFsPolicy = {
  workspaceOnly: boolean;
  /** Extra directories filesystem tools may access when workspaceOnly is true. */
  allowPaths: string[];
};

/** Expand ~ and drop non-absolute entries; grants must name unambiguous host paths. */
export function normalizeFsAllowPaths(allowPaths?: string[]): string[] {
  return (allowPaths ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry === "~") {
        return os.homedir();
      }
      if (entry.startsWith("~/") || entry.startsWith("~\\")) {
        return path.join(os.homedir(), entry.slice(2));
      }
      return entry;
    })
    .filter((entry) => path.isAbsolute(entry))
    .map((entry) => path.resolve(entry));
}

export function createToolFsPolicy(params: {
  workspaceOnly?: boolean;
  allowPaths?: string[];
}): ToolFsPolicy {
  return {
    workspaceOnly: params.workspaceOnly === true,
    allowPaths: normalizeFsAllowPaths(params.allowPaths),
  };
}

export function resolveToolFsConfig(params: { cfg?: OpenClawConfig; agentId?: string }): {
  workspaceOnly?: boolean;
  allowPaths?: string[];
} {
  const cfg = params.cfg;
  const globalFs = cfg?.tools?.fs;
  const agentFs =
    cfg && params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools?.fs : undefined;
  const allowPaths = [...(globalFs?.allowPaths ?? []), ...(agentFs?.allowPaths ?? [])];
  return {
    workspaceOnly: agentFs?.workspaceOnly ?? globalFs?.workspaceOnly,
    allowPaths: allowPaths.length > 0 ? allowPaths : undefined,
  };
}

export function resolveEffectiveToolFsWorkspaceOnly(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
}): boolean {
  return resolveToolFsConfig(params).workspaceOnly === true;
}

export function resolveEffectiveToolFsRootExpansionAllowed(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
}): boolean {
  const cfg = params.cfg;
  if (!cfg) {
    return true;
  }
  const agentTools = params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools : undefined;
  const globalTools = cfg.tools;
  const profile = agentTools?.profile ?? globalTools?.profile;
  const profileAlsoAllow = new Set(agentTools?.alsoAllow ?? globalTools?.alsoAllow ?? []);
  const fsConfig = resolveToolFsConfig(params);
  const hasExplicitFsConfig = agentTools?.fs !== undefined || globalTools?.fs !== undefined;
  if (fsConfig.workspaceOnly === true) {
    return false;
  }
  if (hasExplicitFsConfig) {
    profileAlsoAllow.add("read");
    profileAlsoAllow.add("write");
    profileAlsoAllow.add("edit");
  }
  const profilePolicy = mergeAlsoAllowPolicy(
    resolveToolProfilePolicy(profile),
    profileAlsoAllow.size > 0 ? Array.from(profileAlsoAllow) : undefined,
  );
  const globalPolicy = pickSandboxToolPolicy(globalTools);
  const agentPolicy = pickSandboxToolPolicy(agentTools);
  return isToolAllowedByPolicies("read", [profilePolicy, globalPolicy, agentPolicy]);
}
