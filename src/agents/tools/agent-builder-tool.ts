import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, readGatewayCallOptions, type GatewayCallOptions } from "./gateway.js";

// Lets an agent build and manage other agents on the user's behalf. The user
// describes what they want automated; the agent interviews them, then calls
// action="create" to spin up a focused specialist. Scheduling a workflow is
// handled by the separate `cron` tool (payload.kind="agentTurn" + agentId).

const AGENT_BUILDER_ACTIONS = ["create", "list", "update", "delete"] as const;

export const AgentBuilderToolSchema = Type.Object(
  {
    action: stringEnum(AGENT_BUILDER_ACTIONS),
    name: Type.Optional(
      Type.String({ description: "Display name for the agent (create, or rename on update)." }),
    ),
    agentId: Type.Optional(
      Type.String({ description: "Existing agent id (required for update and delete)." }),
    ),
    purpose: Type.Optional(
      Type.String({
        description:
          "What this agent is for — written into its AGENTS.md as its instructions (create). Be specific and actionable.",
      }),
    ),
    model: Type.Optional(
      Type.String({
        description:
          'Model ref, e.g. "together/moonshotai/Kimi-K2.6". Browser/desktop automation needs a capable paid model; chat/research can use a cheaper one. Omit to inherit the global default.',
      }),
    ),
    tools: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Tool ids this agent may use: ["browser"] for the web, ["desktop"] for local Windows apps/files, ["browser","desktop"] for both, or omit for a chat-only agent.',
      }),
    ),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);

type AgentBuilderToolOptions = {
  agentSessionKey?: string;
};

type GatewayToolCaller = typeof callGatewayTool;

type AgentBuilderToolDeps = {
  callGatewayTool?: GatewayToolCaller;
};

export function createAgentBuilderTool(
  opts?: AgentBuilderToolOptions,
  deps?: AgentBuilderToolDeps,
): AnyAgentTool {
  void opts;
  const callGateway = deps?.callGatewayTool ?? callGatewayTool;
  return {
    label: "Agent Builder",
    name: "agent_builder",
    ownerOnly: true,
    description: `Create and manage OpenClaw agents — focused specialist assistants the user can talk to or schedule. Use this when the user wants to "create an agent", "make an assistant", or "automate a workflow / task".

INTERVIEW THE USER FIRST. Before creating anything, ask short questions ONE AT A TIME until you can configure the agent correctly:
- Goal: exactly what should this agent do?
- Tools: does it need the web (tools=["browser"]), local Windows apps/files/settings (tools=["desktop"]), both, or nothing (chat only)? You do NOT need API keys for services like Gmail or Notion — the browser tool operates them through their websites using the user's existing logins.
- Model: automation (browser/desktop) needs a capable paid model such as together/moonshotai/Kimi-K2.6; chat/research can use a cheaper model.
- If it should run automatically (e.g. "every morning", "whenever I get an email from X"): capture the schedule. AFTER creating the agent, use the \`cron\` tool with payload.kind="agentTurn", agentId set to the new agent's id, and the task written as the message — that is the trigger.
Summarize the planned agent and confirm with the user, THEN call action="create". Report the new agent id and how to use it.

ACTIONS:
- create: make a new agent (name required; provide purpose, tools, model).
- list: list existing agents — do this before creating to avoid duplicates.
- update: rename or change the model of an existing agent (requires agentId).
- delete: remove an agent (requires agentId).`,
    parameters: AgentBuilderToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts: GatewayCallOptions = {
        ...readGatewayCallOptions(params),
        timeoutMs:
          typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
            ? params.timeoutMs
            : 60_000,
      };

      switch (action) {
        case "list":
          return jsonResult(await callGateway("agents.list", gatewayOpts, {}));
        case "create": {
          const name = readStringParam(params, "name", { required: true });
          const createParams: Record<string, unknown> = { name };
          const purpose = readStringParam(params, "purpose");
          if (purpose) {
            createParams.purpose = purpose;
          }
          const model = readStringParam(params, "model");
          if (model) {
            createParams.model = model;
          }
          if (Array.isArray(params.tools)) {
            const tools = params.tools
              .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
              .filter(Boolean);
            if (tools.length > 0) {
              createParams.tools = tools;
            }
          }
          return jsonResult(await callGateway("agents.create", gatewayOpts, createParams));
        }
        case "update": {
          const agentId = readStringParam(params, "agentId", { required: true });
          const updateParams: Record<string, unknown> = { agentId };
          const name = readStringParam(params, "name");
          if (name) {
            updateParams.name = name;
          }
          const model = readStringParam(params, "model");
          if (model) {
            updateParams.model = model;
          }
          return jsonResult(await callGateway("agents.update", gatewayOpts, updateParams));
        }
        case "delete": {
          const agentId = readStringParam(params, "agentId", { required: true });
          return jsonResult(await callGateway("agents.delete", gatewayOpts, { agentId }));
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
