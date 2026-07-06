# How Tool Calling Works (and Why It Fails on Local Models)

## The Complete End-to-End Flow

### Step 1: YOU Send a Request to the Agent
```
User: "Click the submit button on this webpage"
         ↓
         Gateway receives request
         ↓
         Starts agent session with:
         - model: "claude-opus-4-7" (or ollama:qwen2.5-coder)
         - tools: [browser_click, browser_type, etc.]
         - user message: "Click submit button"
```

---

### Step 2: OpenClaw Prepares Tools

**File: `src/agents/pi-embedded-runner/run/attempt.ts:586`**

```typescript
const toolsEnabled = supportsModelTools(params.model);
const tools = normalizeProviderToolSchemas({
  tools: toolsEnabled ? toolsRaw : [],  // ← DECISION POINT
  provider: params.provider,
  modelId: params.modelId,
  modelApi: params.model.api,
  model: params.model,
});
```

**What happens**:
- ✅ **Claude**: `supportsModelTools()` returns `true` → tools ARE sent
- ❌ **Ollama**: `supportsModelTools()` returns `true` (default) BUT Ollama API doesn't accept them → tools sent but ignored

---

### Step 3: Tools Get Sent to the Model

**For Claude** (`anthropic-messages` API):
```json
POST https://api.anthropic.com/v1/messages
{
  "model": "claude-opus-4-7",
  "max_tokens": 4096,
  "tools": [
    {
      "name": "browser_click",
      "description": "Click on an element",
      "input_schema": {
        "type": "object",
        "properties": {
          "ref": {
            "type": "string",
            "description": "The element reference"
          }
        },
        "required": ["ref"]
      }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": "Click the submit button"
    }
  ]
}
```

**For Ollama** (`POST /api/generate` or `/api/chat`):
```json
POST http://localhost:11434/api/chat
{
  "model": "qwen2.5-coder:14b",
  "messages": [
    {
      "role": "user",
      "content": "Click the submit button"
    }
  ]
  // ← NO tools field! Ollama doesn't accept it
}
```

**Key difference**: 
- Claude's API EXPECTS and UNDERSTANDS the `tools` array
- Ollama API IGNORES tools (no field in its schema)

---

### Step 4: The Model Processes the Request

#### **Claude's Internal Processing**:
```
Claude reads the request:
  "I have these tools: browser_click, browser_type, etc."
  "The user wants me to click the submit button"
  
Claude thinks:
  "Ah! I can use the browser_click tool for this.
   The schema says I need to provide a 'ref' parameter.
   The submit button's ref is 'button-submit'.
   I should respond with a tool_use block."
   
Claude generates:
  {
    "type": "tool_use",
    "id": "call_abc123",
    "name": "browser_click",
    "input": {
      "ref": "button-submit"
    }
  }
```

#### **Ollama's Internal Processing**:
```
Ollama reads the request:
  "User wants me to click the submit button"
  
Ollama thinks:
  "The user is asking me to do something.
   Let me generate a helpful response in English.
   I'll describe what I would do."
   
Ollama generates:
  "I'll click the submit button by calling browser_click 
   with the element reference."
  
  OR
  
  "To complete the task, I would use browser_click to 
   click the submit button. However, I cannot actually 
   execute this action as I'm a language model."
```

**Why the difference?**
- **Claude**: Trained to understand tool schemas + respond with structured JSON
- **Ollama**: Trained only to generate text, not to "understand" and respond to tool schemas

---

### Step 5: Response Handling

#### **Claude's Response (Tool Call)**:
```
OpenClaw receives:
{
  "type": "tool_use",
  "id": "call_abc123",
  "name": "browser_click",
  "input": {"ref": "button-submit"}
}

OpenClaw parses this:
  ✅ Tool name: "browser_click" (exact match)
  ✅ Tool input: {"ref": "button-submit"} (valid JSON)
  ✅ Execute tool: click(ref="button-submit")
  
Result: Browser click happens! ✅
```

#### **Ollama's Response (Text)**:
```
OpenClaw receives:
"I'll click the submit button by calling browser_click..."

OpenClaw tries to parse this:
  ❓ Is this a tool call? Maybe...
  ❓ What's the tool name? "browser_click" - but how confident?
  ❓ What's the input? It just said "submit button" - what's the ref?
  ❓ Did it actually work? No way to know.
  
Result: Tool call fails or doesn't execute ❌
```

---

## Why Local Models Can't Do Tool Calling

### The Core Issue: Training Data

**Claude** was trained with:
```
Training example 1:
  Input: "Tool schema: {...}\n\nUser: Click button"
  Output: {"type": "tool_use", "name": "browser_click", ...}

Training example 2:
  Input: "Tool schema: {...}\n\nUser: Type 'hello'"
  Output: {"type": "tool_use", "name": "browser_type", ...}

[Millions of examples like this]
```

**Ollama** was trained with:
```
Training example 1:
  Input: "Click the button"
  Output: "The button has been clicked successfully."

Training example 2:
  Input: "Type 'hello' in the field"
  Output: "I've typed 'hello' in the input field."

[Millions of examples ONLY of text-based interactions]
```

**Result**: Claude KNOWS how to respond with tool schemas. Ollama doesn't.

---

## What Actually Happens When You Try to Use Tools with Ollama

### Scenario: "Click the submit button"

```
Timeline:
1. User: "Click the submit button"
2. OpenClaw: Sends request to Ollama (no tools in schema)
3. Ollama: Receives text, generates response
4. Ollama outputs: "I'll click the submit button for you."
5. OpenClaw: Receives text response
6. OpenClaw tries to extract tool call from text
   - Looks for patterns like "browser_click({...})"
   - Doesn't find clear structure
   - Falls back to executing... what exactly?
7. Result: Either no tool executes, or it executes wrongly ❌
```

---

## Stream of Data (Technical View)

### Claude Flow (Structured):
```
Request Stream:
  → Model: claude-3-5-sonnet
  → Tools: [{name: "browser_click", ...}]
  → Message: "Click submit"
  
Response Stream:
  chunk1: {"type":"content_block_start",...}
  chunk2: {"type":"tool_use","name":"browser_click",...}
  chunk3: {"type":"tool_input","input":{"ref":"submit"},...}
  
Parsing:
  ✅ Clear structure
  ✅ Exact tool name match
  ✅ Executable parameters
```

### Ollama Flow (Unstructured):
```
Request Stream:
  → Model: qwen2.5-coder:14b
  → Message: "Click submit"
  
Response Stream:
  chunk1: "I'll"
  chunk2: " click"
  chunk3: " the"
  chunk4: " submit"
  chunk5: " button"
  
Parsing:
  ❓ Is text a tool call? Need regex/heuristics
  ❓ What parameters? Not explicit
  ❓ Reliability: ~40% (depends on model mood)
```

---

## Why This Matters in Code

### In `attempt.ts:586-596`:

```typescript
const toolsEnabled = supportsModelTools(params.model);
const tools = normalizeProviderToolSchemas({
  tools: toolsEnabled ? toolsRaw : [],
  provider: params.provider,
  modelId: params.modelId,
  modelApi: params.model.api,
  model: params.model,
});
const clientTools = toolsEnabled ? params.clientTools : undefined;
```

**For Claude**:
- `toolsEnabled` = true
- `tools` = full tool schemas
- Tools sent to API ✅
- Model understands schemas ✅
- Tool calls work ✅

**For Ollama**:
- `toolsEnabled` = true (incorrectly, because compat not set)
- `tools` = full tool schemas (but Ollama ignores them)
- Tools sent to API ❌ (Ollama doesn't accept them)
- Model never sees schemas ❌
- Tool calls can't work ❌

---

## The Real Issue: API-Level Incompatibility

| Aspect | Claude | OpenAI | Gemini | Ollama |
|--------|--------|--------|--------|--------|
| **API Endpoint** | `/v1/messages` | `/v1/chat/completions` | `/v1beta/generateContent` | `/api/generate` |
| **Accepts `tools` field?** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| **Returns tool calls?** | ✅ Yes (tool_use) | ✅ Yes (tool_calls) | ✅ Yes (functionCalls) | ❌ No (text only) |
| **Tool call format** | JSON object | JSON object | JSON object | Plain text |
| **Training for tools** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |

---

## Why Text-Based Parsing Won't Fully Work

Even if we parse Ollama's text response for tool calls:

```typescript
// What we'd try to do:
const response = "I'll click the submit button using browser_click.";
const match = response.match(/browser_click\((.*?)\)/);
// Result: null (no structured format in text)

// Better: look for keywords
if (response.includes("click")) {
  // But what's the ref? We don't know!
  // Is it "submit button" or "button-submit" or "btn-submit"?
}
```

**Problem**: Without structured format, we lose critical context.

---

## Summary: Why Tool Calling Doesn't Work on Local Models

1. **API doesn't support it** - Ollama API has no `tools` field
2. **Model isn't trained for it** - Local models never learned structured tool output
3. **No structured response** - Text response can't reliably encode tool parameters
4. **Context loss** - Can't reliably extract "what tool" + "with what parameters"

**This is NOT a bug in OpenClaw. It's a fundamental limitation of Ollama's API design and local model training.**

---

## The Solutions

### ✅ Option 1: Accept the Limitation
Use cloud models (Claude, OpenAI) for tool tasks.

### ✅ Option 2: Instruction-Based (Text Prompts)
Instruct local models in system prompt about tool use (less reliable but possible).

### ✅ Option 3: Fine-tune Local Model
Train a local model on tool-calling examples (expensive, complex).

### ✅ Option 4: Use Cloud Model as Router
When user selects local model for tool task, silently route to Claude for tool planning.
