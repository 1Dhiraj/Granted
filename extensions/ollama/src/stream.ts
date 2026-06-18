import { randomUUID } from "node:crypto";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  StopReason,
  TextContent,
  ToolCall,
  Tool,
  Usage,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream, streamSimple } from "@mariozechner/pi-ai";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import type {
  OpenClawConfig,
  ProviderRuntimeModel,
  ProviderWrapStreamFnContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { isNonSecretApiKeyMarker } from "openclaw/plugin-sdk/provider-auth";
import {
  DEFAULT_CONTEXT_TOKENS,
  normalizeProviderId,
} from "openclaw/plugin-sdk/provider-model-shared";
import {
  createMoonshotThinkingWrapper,
  resolveMoonshotThinkingType,
  streamWithPayloadPatch,
} from "openclaw/plugin-sdk/provider-stream-shared";
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";
import { normalizeLowercaseStringOrEmpty, readStringValue } from "openclaw/plugin-sdk/text-runtime";
import { OLLAMA_DEFAULT_BASE_URL } from "./defaults.js";
import {
  parseJsonObjectPreservingUnsafeIntegers,
  parseJsonPreservingUnsafeIntegers,
} from "./ollama-json.js";

const log = createSubsystemLogger("ollama-stream");

export const OLLAMA_NATIVE_BASE_URL = OLLAMA_DEFAULT_BASE_URL;

export function resolveOllamaBaseUrlForRun(params: {
  modelBaseUrl?: string;
  providerBaseUrl?: string;
}): string {
  const providerBaseUrl = params.providerBaseUrl?.trim();
  if (providerBaseUrl) {
    return providerBaseUrl;
  }
  const modelBaseUrl = params.modelBaseUrl?.trim();
  if (modelBaseUrl) {
    return modelBaseUrl;
  }
  return OLLAMA_NATIVE_BASE_URL;
}

export function resolveConfiguredOllamaProviderConfig(params: {
  config?: OpenClawConfig;
  providerId?: string;
}) {
  const providerId = params.providerId?.trim();
  if (!providerId) {
    return undefined;
  }
  const providers = params.config?.models?.providers;
  if (!providers) {
    return undefined;
  }
  const direct = providers[providerId];
  if (direct) {
    return direct;
  }
  const normalized = normalizeProviderId(providerId);
  for (const [candidateId, candidate] of Object.entries(providers)) {
    if (normalizeProviderId(candidateId) === normalized) {
      return candidate;
    }
  }
  return undefined;
}

export function isOllamaCompatProvider(model: {
  provider?: string;
  baseUrl?: string;
  api?: string;
}): boolean {
  const providerId = normalizeProviderId(model.provider ?? "");
  if (providerId === "ollama") {
    return true;
  }
  if (!model.baseUrl) {
    return false;
  }
  try {
    const parsed = new URL(model.baseUrl);
    const hostname = normalizeLowercaseStringOrEmpty(parsed.hostname);
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
    if (isLocalhost && parsed.port === "11434") {
      return true;
    }

    // Allow remote/LAN Ollama OpenAI-compatible endpoints when the provider id
    // itself indicates Ollama usage (for example "my-ollama").
    const providerHintsOllama = providerId.includes("ollama");
    const isOllamaPort = parsed.port === "11434";
    const isOllamaCompatPath = parsed.pathname === "/" || /^\/v1\/?$/i.test(parsed.pathname);
    return providerHintsOllama && isOllamaPort && isOllamaCompatPath;
  } catch {
    return false;
  }
}

export function resolveOllamaCompatNumCtxEnabled(params: {
  config?: OpenClawConfig;
  providerId?: string;
}): boolean {
  return resolveConfiguredOllamaProviderConfig(params)?.injectNumCtxForOpenAICompat ?? true;
}

export function shouldInjectOllamaCompatNumCtx(params: {
  model: { api?: string; provider?: string; baseUrl?: string };
  config?: OpenClawConfig;
  providerId?: string;
}): boolean {
  if (params.model.api !== "openai-completions") {
    return false;
  }
  if (!isOllamaCompatProvider(params.model)) {
    return false;
  }
  return resolveOllamaCompatNumCtxEnabled({
    config: params.config,
    providerId: params.providerId,
  });
}

export function wrapOllamaCompatNumCtx(baseFn: StreamFn | undefined, numCtx: number): StreamFn {
  const streamFn = baseFn ?? streamSimple;
  return (model, context, options) =>
    streamWithPayloadPatch(streamFn, model, context, options, (payloadRecord) => {
      if (!payloadRecord.options || typeof payloadRecord.options !== "object") {
        payloadRecord.options = {};
      }
      (payloadRecord.options as Record<string, unknown>).num_ctx = numCtx;
      normalizeOllamaCompatMessageToolArgs(payloadRecord);
    });
}

function createOllamaThinkingOffWrapper(baseFn: StreamFn | undefined): StreamFn {
  const streamFn = baseFn ?? streamSimple;
  return (model, context, options) => {
    if (model.api !== "ollama") {
      return streamFn(model, context, options);
    }
    return streamWithPayloadPatch(streamFn, model, context, options, (payloadRecord) => {
      payloadRecord.think = false;
    });
  };
}

function resolveOllamaCompatNumCtx(model: ProviderRuntimeModel): number {
  return Math.max(1, Math.floor(model.contextWindow ?? model.maxTokens ?? DEFAULT_CONTEXT_TOKENS));
}

function isOllamaCloudKimiModelRef(modelId: string): boolean {
  const normalizedModelId = normalizeLowercaseStringOrEmpty(modelId);
  return normalizedModelId.startsWith("kimi-k") && normalizedModelId.includes(":cloud");
}

export function createConfiguredOllamaCompatStreamWrapper(
  ctx: ProviderWrapStreamFnContext,
): StreamFn | undefined {
  let streamFn = ctx.streamFn;
  const model = ctx.model;
  let injectNumCtx = false;

  if (model) {
    const providerId =
      typeof model.provider === "string" && model.provider.trim().length > 0
        ? model.provider
        : ctx.provider;
    if (
      shouldInjectOllamaCompatNumCtx({
        model,
        config: ctx.config,
        providerId,
      })
    ) {
      injectNumCtx = true;
    }
  }

  if (injectNumCtx && model) {
    streamFn = wrapOllamaCompatNumCtx(streamFn, resolveOllamaCompatNumCtx(model));
  }

  // Force thinking OFF when explicitly off, OR when the model doesn't support reasoning.
  // Without this, models like qwen2.5:7b reject the request with:
  //   400 {"error":"\"qwen2.5:7b\" does not support thinking"}
  const modelSupportsReasoning = model?.reasoning === true;
  if (ctx.thinkingLevel === "off" || !modelSupportsReasoning) {
    streamFn = createOllamaThinkingOffWrapper(streamFn);
  }

  if (normalizeProviderId(ctx.provider) === "ollama" && isOllamaCloudKimiModelRef(ctx.modelId)) {
    const thinkingType = resolveMoonshotThinkingType({
      configuredThinking: ctx.extraParams?.thinking,
      thinkingLevel: ctx.thinkingLevel,
    });
    streamFn = createMoonshotThinkingWrapper(streamFn, thinkingType);
  }

  return streamFn;
}

// Backward-compatible alias for existing imports/tests while the broader
// Ollama compat wrapper now owns more than num_ctx injection.
export const createConfiguredOllamaCompatNumCtxWrapper = createConfiguredOllamaCompatStreamWrapper;

export function buildOllamaChatRequest(params: {
  modelId: string;
  messages: OllamaChatMessage[];
  tools?: OllamaTool[];
  options?: Record<string, unknown>;
  stream?: boolean;
}): OllamaChatRequest {
  return {
    model: params.modelId,
    messages: params.messages,
    stream: params.stream ?? true,
    ...(params.tools && params.tools.length > 0 ? { tools: params.tools } : {}),
    ...(params.options ? { options: params.options } : {}),
  };
}

type StreamModelDescriptor = {
  api: string;
  provider: string;
  id: string;
};

function buildUsageWithNoCost(params: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
}): Usage {
  const input = params.input ?? 0;
  const output = params.output ?? 0;
  const cacheRead = params.cacheRead ?? 0;
  const cacheWrite = params.cacheWrite ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: params.totalTokens ?? input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function buildStreamAssistantMessage(params: {
  model: StreamModelDescriptor;
  content: AssistantMessage["content"];
  stopReason: StopReason;
  usage: Usage;
  timestamp?: number;
}): AssistantMessage {
  return {
    role: "assistant",
    content: params.content,
    stopReason: params.stopReason,
    api: params.model.api,
    provider: params.model.provider,
    model: params.model.id,
    usage: params.usage,
    timestamp: params.timestamp ?? Date.now(),
  };
}

function buildStreamErrorAssistantMessage(params: {
  model: StreamModelDescriptor;
  errorMessage: string;
  timestamp?: number;
}): AssistantMessage & { stopReason: "error"; errorMessage: string } {
  return {
    ...buildStreamAssistantMessage({
      model: params.model,
      content: [],
      stopReason: "error",
      usage: buildUsageWithNoCost({}),
      timestamp: params.timestamp,
    }),
    stopReason: "error",
    errorMessage: params.errorMessage,
  };
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  tools?: OllamaTool[];
  options?: Record<string, unknown>;
  think?: boolean;
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: "assistant";
    content: string;
    thinking?: string;
    reasoning?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

type InputContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string }
  | { type: "toolCall"; id: string; name: string; arguments: unknown }
  | { type: "tool_use"; id: string; name: string; input: unknown };

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function extractOllamaImages(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "image"; data: string } => part.type === "image")
    .map((part) => part.data);
}

function ensureArgsObject(value: unknown): Record<string, unknown> {
  return parseJsonObjectPreservingUnsafeIntegers(value) ?? {};
}

function normalizeOllamaCompatMessageToolArgs(payloadRecord: Record<string, unknown>): void {
  const messages = payloadRecord.messages;
  if (!Array.isArray(messages)) {
    return;
  }

  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      continue;
    }
    const messageRecord = message as Record<string, unknown>;

    const functionCall = messageRecord.function_call;
    if (functionCall && typeof functionCall === "object" && !Array.isArray(functionCall)) {
      const functionCallRecord = functionCall as Record<string, unknown>;
      if (Object.hasOwn(functionCallRecord, "arguments")) {
        functionCallRecord.arguments = ensureArgsObject(functionCallRecord.arguments);
      }
    }

    const toolCalls = messageRecord.tool_calls;
    if (!Array.isArray(toolCalls)) {
      continue;
    }
    for (const toolCall of toolCalls) {
      if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
        continue;
      }
      const functionSpec = (toolCall as Record<string, unknown>).function;
      if (!functionSpec || typeof functionSpec !== "object" || Array.isArray(functionSpec)) {
        continue;
      }
      const functionRecord = functionSpec as Record<string, unknown>;
      if (Object.hasOwn(functionRecord, "arguments")) {
        functionRecord.arguments = ensureArgsObject(functionRecord.arguments);
      }
    }
  }
}

function extractToolCalls(content: unknown): OllamaToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const parts = content as InputContentPart[];
  const result: OllamaToolCall[] = [];
  for (const part of parts) {
    if (part.type === "toolCall") {
      result.push({ function: { name: part.name, arguments: ensureArgsObject(part.arguments) } });
    } else if (part.type === "tool_use") {
      result.push({ function: { name: part.name, arguments: ensureArgsObject(part.input) } });
    }
  }
  return result;
}

export function convertToOllamaMessages(
  messages: Array<{ role: string; content: unknown }>,
  system?: string,
): OllamaChatMessage[] {
  const result: OllamaChatMessage[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = extractTextContent(msg.content);
      const images = extractOllamaImages(msg.content);
      result.push({
        role: "user",
        content: text,
        ...(images.length > 0 ? { images } : {}),
      });
      continue;
    }

    if (msg.role === "assistant") {
      const text = extractTextContent(msg.content);
      const toolCalls = extractToolCalls(msg.content);
      result.push({
        role: "assistant",
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    if (msg.role === "tool" || msg.role === "toolResult") {
      const text = extractTextContent(msg.content);
      const toolName =
        typeof (msg as { toolName?: unknown }).toolName === "string"
          ? (msg as { toolName?: string }).toolName
          : undefined;
      result.push({
        role: "tool",
        content: text,
        ...(toolName ? { tool_name: toolName } : {}),
      });
    }
  }

  return result;
}

function extractOllamaTools(tools: Tool[] | undefined): OllamaTool[] {
  if (!tools || !Array.isArray(tools)) {
    return [];
  }
  const result: OllamaTool[] = [];
  for (const tool of tools) {
    if (typeof tool.name !== "string" || !tool.name) {
      continue;
    }
    result.push({
      type: "function",
      function: {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        parameters: (tool.parameters ?? {}) as Record<string, unknown>,
      },
    });
  }
  return result;
}

function extractToolCallShape(
  parsed: unknown,
): { name: string; arguments: Record<string, unknown> } | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  // Shape A: { "name": "...", "arguments": {...} }
  if (
    typeof obj.name === "string" &&
    obj.name &&
    typeof obj.arguments === "object" &&
    obj.arguments !== null &&
    !Array.isArray(obj.arguments)
  ) {
    return { name: obj.name, arguments: obj.arguments as Record<string, unknown> };
  }

  // Shape B: { "name": "...", "parameters": {...} }
  if (
    typeof obj.name === "string" &&
    obj.name &&
    typeof obj.parameters === "object" &&
    obj.parameters !== null &&
    !Array.isArray(obj.parameters)
  ) {
    return { name: obj.name, arguments: obj.parameters as Record<string, unknown> };
  }

  // Shape C: { "function": { "name": "...", "arguments": {...} | "..." } }
  if (typeof obj.function === "object" && obj.function !== null && !Array.isArray(obj.function)) {
    const fn = obj.function as Record<string, unknown>;
    if (typeof fn.name === "string" && fn.name) {
      let args: unknown = fn.arguments ?? fn.parameters ?? {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      if (typeof args === "object" && args !== null && !Array.isArray(args)) {
        return { name: fn.name, arguments: args as Record<string, unknown> };
      }
    }
  }

  // Shape D: { "tool_call": { ... } } or { "tool": "...", "args"|"arguments": {...} }
  if (typeof obj.tool_call === "object" && obj.tool_call !== null) {
    return extractToolCallShape(obj.tool_call);
  }
  if (typeof obj.tool === "string" && obj.tool) {
    const args = obj.arguments ?? obj.args ?? obj.parameters ?? {};
    if (typeof args === "object" && args !== null && !Array.isArray(args)) {
      return { name: obj.tool, arguments: args as Record<string, unknown> };
    }
  }

  return null;
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json|tool_call|tool)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

function extractFirstBalancedJsonObject(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function tryParseContentAsToolCall(
  text: string,
): { name: string; arguments: Record<string, unknown> } | null {
  if (!text) {
    return null;
  }

  // Strategy 1: try the whole text (after stripping markdown fences if present).
  const stripped = stripMarkdownCodeFence(text);
  if (stripped.startsWith("{")) {
    try {
      const parsed = JSON.parse(stripped) as unknown;
      const shape = extractToolCallShape(parsed);
      if (shape) {
        return shape;
      }
    } catch {
      // fall through
    }
  }

  // Strategy 2: extract first balanced JSON object from anywhere in the text.
  const extracted = extractFirstBalancedJsonObject(stripped);
  if (extracted) {
    try {
      const parsed = JSON.parse(extracted) as unknown;
      const shape = extractToolCallShape(parsed);
      if (shape) {
        return shape;
      }
    } catch {
      // fall through
    }
  }

  return null;
}

// Exported for testing.
export const __testTryParseContentAsToolCall = tryParseContentAsToolCall;

export function buildAssistantMessage(
  response: OllamaChatResponse,
  modelInfo: StreamModelDescriptor,
): AssistantMessage {
  const content: (TextContent | ToolCall)[] = [];
  const text = response.message.content || "";
  const toolCalls = response.message.tool_calls;

  // Some models (e.g. qwen2.5-coder) output tool calls as JSON in content
  // rather than in tool_calls. Detect and handle this case.
  const parsedContentToolCall =
    (!toolCalls || toolCalls.length === 0) && text ? tryParseContentAsToolCall(text) : null;

  if (parsedContentToolCall) {
    content.push({
      type: "toolCall",
      id: `ollama_call_${randomUUID()}`,
      name: parsedContentToolCall.name,
      arguments: parsedContentToolCall.arguments,
    });
  } else {
    if (text) {
      content.push({ type: "text", text });
    }
    if (toolCalls && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        content.push({
          type: "toolCall",
          id: `ollama_call_${randomUUID()}`,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        });
      }
    }
  }

  const hasToolUse = content.some((c) => c.type === "toolCall");
  return buildStreamAssistantMessage({
    model: modelInfo,
    content,
    stopReason: hasToolUse ? "toolUse" : "stop",
    usage: buildUsageWithNoCost({
      input: response.prompt_eval_count ?? 0,
      output: response.eval_count ?? 0,
    }),
  });
}

export async function* parseNdjsonStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<OllamaChatResponse> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        yield parseJsonPreservingUnsafeIntegers(trimmed) as OllamaChatResponse;
      } catch {
        log.warn(`Skipping malformed NDJSON line: ${trimmed.slice(0, 120)}`);
      }
    }
  }

  if (buffer.trim()) {
    try {
      yield parseJsonPreservingUnsafeIntegers(buffer.trim()) as OllamaChatResponse;
    } catch {
      log.warn(`Skipping malformed trailing data: ${buffer.trim().slice(0, 120)}`);
    }
  }
}

function resolveOllamaChatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const normalizedBase = trimmed.replace(/\/v1$/i, "");
  return `${normalizedBase || OLLAMA_NATIVE_BASE_URL}/api/chat`;
}

function resolveOllamaModelHeaders(model: {
  headers?: unknown;
}): Record<string, string> | undefined {
  if (!model.headers || typeof model.headers !== "object" || Array.isArray(model.headers)) {
    return undefined;
  }
  return model.headers as Record<string, string>;
}

export function createOllamaStreamFn(
  baseUrl: string,
  defaultHeaders?: Record<string, string>,
): StreamFn {
  const chatUrl = resolveOllamaChatUrl(baseUrl);

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        const ollamaTools = extractOllamaTools(context.tools);

        // Reinforce tool-calling instruction at the end of the system prompt so local
        // models don't lose it in the large context injected by OpenClaw.
        const systemPromptWithToolHint =
          ollamaTools.length > 0 && context.systemPrompt
            ? `${context.systemPrompt}\n\nIMPORTANT: You have access to tools listed above. When the user asks you to perform an action (browse a website, click, type, read a file, run a command, etc.), you MUST call the appropriate tool directly. Do NOT say you cannot perform the action. Do NOT describe what you would do. Just call the tool.`
            : context.systemPrompt;

        const ollamaMessagesWithHint = convertToOllamaMessages(
          context.messages ?? [],
          systemPromptWithToolHint,
        );

        const ollamaOptions: Record<string, unknown> = { num_ctx: model.contextWindow ?? 65536 };
        if (typeof options?.temperature === "number") {
          ollamaOptions.temperature = options.temperature;
        }
        if (typeof options?.maxTokens === "number") {
          ollamaOptions.num_predict = options.maxTokens;
        }

        const body = buildOllamaChatRequest({
          modelId: model.id,
          messages: ollamaMessagesWithHint,
          stream: true,
          tools: ollamaTools,
          options: ollamaOptions,
        });
        options?.onPayload?.(body, model);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...defaultHeaders,
          ...options?.headers,
        };
        if (
          options?.apiKey &&
          (!headers.Authorization || !isNonSecretApiKeyMarker(options.apiKey))
        ) {
          headers.Authorization = `Bearer ${options.apiKey}`;
        }

        const response = await fetch(chatUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options?.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "unknown error");
          throw new Error(`${response.status} ${errorText}`);
        }
        if (!response.body) {
          throw new Error("Ollama API returned empty response body");
        }

        const reader = response.body.getReader();
        let accumulatedContent = "";
        const accumulatedToolCalls: OllamaToolCall[] = [];
        let finalResponse: OllamaChatResponse | undefined;
        const modelInfo = { api: model.api, provider: model.provider, id: model.id };
        let streamStarted = false;
        let textBlockClosed = false;
        // Many local models (qwen2.5-coder, qwen2.5, etc.) emit tool calls as
        // JSON in the content channel instead of using native tool_calls. When
        // the very first non-whitespace character looks like it could start a
        // JSON object or a markdown ```json fence, we buffer the deltas instead
        // of forwarding them as text. At end-of-stream, if the buffered text
        // parses as a tool call, we emit only the tool-call message; if it does
        // not, we flush the buffer as a single text_delta so callers still get
        // the original text.
        const couldStartJsonToolCall = (text: string): boolean => {
          const stripped = text.replace(/^[\s﻿]+/, "");
          if (!stripped) return true; // still might be JSON — keep buffering
          if (stripped.startsWith("{")) return true;
          if (stripped.startsWith("```")) return true;
          return false;
        };

        // Strip chat-template special tokens that qwen2.5 / llama3 sometimes
        // emit verbatim into content (e.g. <|im_start|>, <|im_end|>).
        // These are internal markers that should never appear as user-visible text.
        // <|im_end|> and <|endoftext|> also function as stop signals — if the
        // *entire* remaining content is just one of these, treat it as empty.
        const SPECIAL_TOKEN_RE =
          /<\|(?:im_start|im_end|endoftext|eot_id|begin_of_text|end_of_turn|system|user|assistant)\|>(?:\w+\n?)?/g;
        const stripSpecialTokens = (text: string): string =>
          text.replace(SPECIAL_TOKEN_RE, "");

        let bufferingJsonCandidate = false;
        const hasTools = (context.tools ?? []).length > 0;

        const startStreamIfNeeded = () => {
          if (streamStarted) return;
          streamStarted = true;
          const emptyPartial = buildStreamAssistantMessage({
            model: modelInfo,
            content: [],
            stopReason: "stop",
            usage: buildUsageWithNoCost({}),
          });
          stream.push({ type: "start", partial: emptyPartial });
          stream.push({ type: "text_start", contentIndex: 0, partial: emptyPartial });
        };

        const emitTextDelta = (delta: string) => {
          const partial = buildStreamAssistantMessage({
            model: modelInfo,
            content: [{ type: "text", text: accumulatedContent }],
            stopReason: "stop",
            usage: buildUsageWithNoCost({}),
          });
          stream.push({ type: "text_delta", contentIndex: 0, delta, partial });
        };

        const closeTextBlock = () => {
          if (!streamStarted || textBlockClosed) {
            return;
          }
          textBlockClosed = true;
          const partial = buildStreamAssistantMessage({
            model: modelInfo,
            content: [{ type: "text", text: accumulatedContent }],
            stopReason: "stop",
            usage: buildUsageWithNoCost({}),
          });
          stream.push({
            type: "text_end",
            contentIndex: 0,
            content: accumulatedContent,
            partial,
          });
        };

        for await (const chunk of parseNdjsonStream(reader)) {
          if (chunk.message?.content) {
            const delta = stripSpecialTokens(chunk.message.content);
            if (!delta) continue; // entire chunk was a special token — skip it

            // Decide on the first content chunk whether to buffer (because the
            // content might be a JSON tool call) or to forward text deltas live.
            if (!streamStarted && !bufferingJsonCandidate) {
              if (hasTools && couldStartJsonToolCall(accumulatedContent + delta)) {
                bufferingJsonCandidate = true;
              }
            }

            accumulatedContent += delta;

            if (bufferingJsonCandidate) {
              // Defer text emission. If the final content parses as a tool call,
              // we never emit a text block; the runner gets only the tool call
              // via the done event's message.
              continue;
            }

            startStreamIfNeeded();
            emitTextDelta(delta);
          }
          if (chunk.message?.tool_calls) {
            closeTextBlock();
            accumulatedToolCalls.push(...chunk.message.tool_calls);
          }
          if (chunk.done) {
            finalResponse = chunk;
            break;
          }
        }

        if (!finalResponse) {
          throw new Error("Ollama API stream ended without a final response");
        }

        finalResponse.message.content = stripSpecialTokens(accumulatedContent);
        if (accumulatedToolCalls.length > 0) {
          finalResponse.message.tool_calls = accumulatedToolCalls;
        }

        const assistantMessage = buildAssistantMessage(finalResponse, modelInfo);

        // Flush the buffered candidate now that we know what it is.
        if (bufferingJsonCandidate && !streamStarted && accumulatedContent) {
          const becameToolCall = assistantMessage.content.some((c) => c.type === "toolCall");
          if (!becameToolCall) {
            // The buffer turned out to be plain text after all. Emit it as a
            // single text block so the UI still shows the response.
            startStreamIfNeeded();
            emitTextDelta(accumulatedContent);
          }
        }

        // Close the text block if we emitted any text_delta events.
        closeTextBlock();

        stream.push({
          type: "done",
          reason: assistantMessage.stopReason === "toolUse" ? "toolUse" : "stop",
          message: assistantMessage,
        });
      } catch (err) {
        stream.push({
          type: "error",
          reason: "error",
          error: buildStreamErrorAssistantMessage({
            model,
            errorMessage: formatErrorMessage(err),
          }),
        });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}

export function createConfiguredOllamaStreamFn(params: {
  model: { baseUrl?: string; headers?: unknown };
  providerBaseUrl?: string;
}): StreamFn {
  return createOllamaStreamFn(
    resolveOllamaBaseUrlForRun({
      modelBaseUrl: readStringValue(params.model.baseUrl),
      providerBaseUrl: params.providerBaseUrl,
    }),
    resolveOllamaModelHeaders(params.model),
  );
}
