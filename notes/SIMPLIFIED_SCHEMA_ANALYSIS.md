# Simplified Browser Schema - Fundamental Limitation

## The Problem You're Seeing

When you toggle to "simplified" mode and ask the agent to:
1. Open google.com → **works** ✅
2. Type "weather" in that same browser → **fails** ❌ (agent claims it typed but nothing appears)

## Why This Happens

### Simplified Schema (4 parameters)
```
action, url, ref, text
```

### Full Schema (30+ parameters)
```
action, target, targetId, url, ref, ..., modifiers, key, ..., [30+ total]
```

### The Critical Missing Parameter: `targetId`

When the browser executes `action: "navigate", url: "google.com"`:
1. The browser opens Google in a tab with a unique `targetId` (e.g., `"t42"`)
2. The API returns this `targetId` to the model
3. **But simplified schema has no field to store/return `targetId`** ❌
4. The model's context loses track of which browser tab is active

When the model then tries to execute `action: "type", text: "weather"`:
1. The model has no way to specify `targetId` parameter (doesn't exist in simplified schema)
2. Without `targetId`, the browser handler doesn't know **which tab to type into**
3. It either fails or hits a fallback that only works for single-tab scenarios

### Code Evidence

**browser-tool.schema.ts (lines 88-93)** - Simplified Schema Definition:
```typescript
export const BrowserToolSchemaSimplified = Type.Object({
  action: stringEnum(BROWSER_TOOL_ACTIONS),
  url: Type.Optional(Type.String()),
  ref: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
});
```

**BrowserActSchema (line 51)** - Full Schema includes:
```typescript
targetId: Type.Optional(Type.String()),
```

**browser-tool.actions.ts (line 397)** - Error message when tab isn't found:
```typescript
throw new Error(
  `Chrome tab not found (stale targetId?). Run action=tabs profile="${profile}" and use one of the returned targetIds.`,
  { cause: err },
);
```

## The Fundamental Issue

**The simplified schema was designed for single-action, single-step operations** (e.g., navigate OR screenshot OR click). It was never intended for:
- Multi-step sequences in a single conversation
- Maintaining state across multiple calls
- Complex workflows like "open Google, then search, then click results"

## What Works With Simplified Schema
✅ Single action: `action: "navigate", url: "google.com"`
✅ Single action: `action: "screenshot"`
✅ Single action: `action: "snapshot"`

## What Fails With Simplified Schema
❌ Multi-step: Open Google, then type in the same tab
❌ Multi-step: Navigate to site, click element, fill form
❌ Multi-tab operations: Track different browser tabs
❌ Complex automation: Anything requiring state preservation

## Solution

**Switch back to "full" schema mode** for real agent work that requires:
- Multi-step automation
- State preservation across calls
- Complex workflows

The "simplified" mode is a **technical limitation**, not a feature. It trades capability for model simplicity, but that tradeoff breaks practical use cases.

### Why Was Simplified Added?

Some smaller models (Ollama, older local models) struggle to parse the 30-parameter schema correctly. The simplified schema was an experiment to see if reducing parameter count would improve reliability. However, it inadvertently breaks the tool's core functionality.

## Recommendation

- **For Claude/GPT models**: Always use "full" schema ✅
- **For Ollama/local models**: Use "full" schema (works better than simplified) ✅
- **Simplified schema**: Reserved for special cases where model can't parse JSON at all (rare)

If Ollama models are having difficulty with the 30-parameter schema, the fix is to improve the **model's training/prompting**, not to remove critical parameters like `targetId`.
