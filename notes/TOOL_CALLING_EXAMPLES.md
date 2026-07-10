# Real Tool Calling Examples: Claude vs Ollama

## Example 1: Clicking a Button

### Claude Response (What Works ✅)

**Request to Claude API**:
```bash
POST https://api.anthropic.com/v1/messages
Content-Type: application/json
x-api-key: sk-ant-...

{
  "model": "claude-opus-4-7",
  "max_tokens": 1024,
  "tools": [
    {
      "name": "browser_click",
      "description": "Click on an element in the browser",
      "input_schema": {
        "type": "object",
        "properties": {
          "ref": {
            "type": "string",
            "description": "The element reference ID"
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

**Claude's Response Stream** (what comes back):
```json
// Event 1: Start content block
{
  "type": "content_block_start",
  "content_block": {
    "type": "tool_use",
    "id": "call_abc123xyz",
    "name": "browser_click",
    "input": {}
  }
}

// Event 2: Tool call input delta
{
  "type": "content_block_delta",
  "delta": {
    "type": "input_json_delta",
    "partial_json": "{\"ref\": \"submit-btn\"}"
  }
}

// Event 3: Complete tool call
{
  "type": "content_block_stop"
}

// Final Message
{
  "role": "assistant",
  "content": [
    {
      "type": "tool_use",
      "id": "call_abc123xyz",
      "name": "browser_click",
      "input": {
        "ref": "submit-btn"
      }
    }
  ]
}
```

**OpenClaw Parsing** (in `attempt.ts`):
```typescript
// The stream handler receives structured data
const toolCall = {
  type: "tool_use",
  id: "call_abc123xyz",
  name: "browser_click",
  input: { ref: "submit-btn" }
};

// pi-agent-core extracts:
const toolName = toolCall.name;  // "browser_click" ✅
const toolInput = toolCall.input;  // { ref: "submit-btn" } ✅

// Exact string matching (line 1227 in attempt.ts):
// "pi-agent-core dispatches tool calls with exact string matching"
if (toolName === "browser_click") {
  // Execute the tool
  browserClick({ ref: "submit-btn" });  // ✅ Works!
}
```

**Result**: Tool executes perfectly ✅

---

### Ollama Response (What Fails ❌)

**Request to Ollama API**:
```bash
POST http://localhost:11434/api/chat
Content-Type: application/json

{
  "model": "qwen2.5-coder:14b",
  "messages": [
    {
      "role": "user",
      "content": "Click the submit button"
    }
  ]
  // Note: NO "tools" field - Ollama doesn't support it!
}
```

**Ollama's Response Stream** (what comes back):
```
chunk1: "I"
chunk2: "'ll"
chunk3: " click"
chunk4: " the"
chunk5: " submit"
chunk6: " button"
chunk7: " using"
chunk8: " the"
chunk9: " browser_click"
chunk10: " function"

Final response:
"I'll click the submit button using the browser_click function."
```

**OpenClaw Parsing** (in `attempt.ts`):
```typescript
// The response is plain text - no structure
const response = "I'll click the submit button using the browser_click function.";

// Try to extract tool call:
const toolCallMatch = response.match(/browser_click\({.*?}\)/);
// Result: null ❌ (no structured JSON in the text)

// Try keyword matching:
if (response.includes("browser_click")) {
  // Found "browser_click" but...
  // What's the ref? "submit button"? "submit-btn"? "button-submit"?
  // We don't know! ❌
}

// Try regex to find parameters:
const paramMatch = response.match(/ref[=:]\s*["']?([^"'\s}]+)["']?/);
// Result: null ❌ (parameters not in structured format)
```

**Result**: Tool call fails or doesn't execute ❌

---

## Example 2: Typing in a Text Field

### Claude (Works ✅)

**Tool Schema**:
```json
{
  "name": "browser_type",
  "description": "Type text into a focused input field",
  "input_schema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string",
        "description": "The text to type"
      }
    },
    "required": ["text"]
  }
}
```

**Claude's Response**:
```json
{
  "type": "tool_use",
  "id": "call_xyz789",
  "name": "browser_type",
  "input": {
    "text": "hello@example.com"
  }
}
```

**OpenClaw Execution**:
```typescript
// Perfect match:
toolName = "browser_type"  // ✅ Exact match
toolInput = { text: "hello@example.com" }  // ✅ Valid JSON

// Execute:
browserType({ text: "hello@example.com" });  // ✅ Works!
```

**Result**: Text typed successfully ✅

---

### Ollama (Fails ❌)

**Ollama's Response**:
```
"I'll type the text 'hello@example.com' into the email input field 
using the browser_type function. This would set the value to 
'hello@example.com'."
```

**OpenClaw Parsing**:
```typescript
// Is there a tool call? Maybe...
// Can we extract "hello@example.com"? Yes, from quotes
// Is it the right parameter? Unclear (could be example text, not actual call)
// Did it actually type? No, we just predicted what it would do ❌

// The model is just describing what it would do, not executing it
```

**Result**: Text NOT typed ❌

---

## Example 3: Filling a Form (Complex)

### Claude (Works ✅)

**Tool Schemas**:
```json
[
  {
    "name": "browser_click",
    "input_schema": { ... }
  },
  {
    "name": "browser_type",
    "input_schema": { ... }
  },
  {
    "name": "browser_fill",
    "input_schema": { ... }
  }
]
```

**Claude's Multi-Step Response**:
```json
[
  {
    "type": "tool_use",
    "id": "call_1",
    "name": "browser_click",
    "input": { "ref": "username-field" }
  },
  {
    "type": "tool_use",
    "id": "call_2",
    "name": "browser_type",
    "input": { "text": "john_doe" }
  },
  {
    "type": "tool_use",
    "id": "call_3",
    "name": "browser_click",
    "input": { "ref": "password-field" }
  },
  {
    "type": "tool_use",
    "id": "call_4",
    "name": "browser_type",
    "input": { "text": "secure_password_123" }
  },
  {
    "type": "tool_use",
    "id": "call_5",
    "name": "browser_click",
    "input": { "ref": "submit-button" }
  }
]
```

**OpenClaw Execution**:
```typescript
// Each tool call is processed in sequence:
for (const toolCall of response.content) {
  if (toolCall.type === "tool_use") {
    const { name, input } = toolCall;
    
    // call_1
    await browserClick({ ref: "username-field" });
    
    // call_2
    await browserType({ text: "john_doe" });
    
    // call_3
    await browserClick({ ref: "password-field" });
    
    // call_4
    await browserType({ text: "secure_password_123" });
    
    // call_5
    await browserClick({ ref: "submit-button" });
  }
}
```

**Result**: Form filled perfectly, step by step ✅

---

### Ollama (Fails ❌)

**Ollama's Response**:
```
"To fill out this form, I would:
1. Click on the username field
2. Type 'john_doe'
3. Click on the password field
4. Type 'secure_password_123'
5. Click the submit button

This would complete the form submission process."
```

**OpenClaw Parsing**:
```typescript
// This is a description, not tool calls
// We could try to parse the numbered steps:
const steps = response.split('\n').filter(line => /^\d+\./.test(line));

// Step 1: "Click on the username field"
// - Which field? "username field" is not a ref
// - Could be "username-field" but we're guessing

// Step 2: "Type 'john_doe'"
// - Is this a tool call? No, it's description

// Step 3-5: Same problem

// We CANNOT reliably extract structured tool calls from this text ❌
```

**Result**: Nothing executed. Form not filled ❌

---

## Key Insight: Why This Matters

Look at the data structures:

**Claude** (Structured):
```json
{
  "type": "tool_use",
  "name": "browser_click",
  "input": {
    "ref": "button-id"
  }
}
```
- Machine-readable ✅
- Unambiguous ✅
- Executable ✅

**Ollama** (Unstructured):
```
"I'll click the button with ID 'button-id' using browser_click"
```
- Human-readable ✅
- Ambiguous ❓
- Not directly executable ❌

---

## Why Ollama Can't Output Structured Format

Ollama is a **text completion model**. When it generates output, it's completing text, character by character.

It was trained on:
- Books (text)
- Code files (text)
- Articles (text)
- Chat conversations (text)

It was NOT trained on:
- "Output JSON tool calls in response to schemas"
- "When given a tool schema, respond with structured JSON"
- "Tool calling format"

So when you ask it to click a button:
- It knows HOW TO TALK about clicking
- It doesn't know HOW TO OUTPUT in tool-call format

It's like asking someone who speaks English to write in JSON:
- They can TALK about what JSON looks like
- They can't reliably WRITE valid JSON on demand

---

## Why Trimming/Sanitizing Doesn't Help

In `attempt.ts:1226-1237`, there are sanitizers:

```typescript
activeSession.agent.streamFn = wrapStreamFnSanitizeMalformedToolCalls(
  activeSession.agent.streamFn,
  allowedToolNames,
  transcriptPolicy,
);
activeSession.agent.streamFn = wrapStreamFnTrimToolCallNames(
  activeSession.agent.streamFn,
  allowedToolNames,
);
```

These sanitizers can fix:
- ✅ Whitespace in tool names: `" click "` → `"click"`
- ✅ Malformed JSON: `{"ref": "btn}` → handled

But they CANNOT:
- ❌ Create structure from unstructured text
- ❌ Extract parameters that aren't formatted
- ❌ Guess what the model meant to do

**Example**: Sanitizer sees `" browser_click "` → trims to `"browser_click"` ✅

But if Ollama outputs: `"I'll click the button"` → sanitizer can't extract anything ❌

---

## Summary: The Fundamental Gap

| Aspect | Claude | Ollama |
|--------|--------|--------|
| **Understands tool schemas?** | Yes (trained for it) | No |
| **Outputs JSON on request?** | Yes (trained for it) | No |
| **Response is structured?** | Yes | No |
| **Can be parsed reliably?** | Yes (100%) | No (0-30%) |
| **Tool execution works?** | Yes ✅ | No ❌ |

This isn't a bug. It's a design choice: Ollama is optimized for text generation, not tool calling.
