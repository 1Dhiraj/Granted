# 🎯 Quick Toggle Guide - 3 Simple Steps

## Current: Simplified Schema (4 params) is Active ✅

---

## How to Toggle Right Now

### Step 1️⃣ Open File
**Path:** `extensions/browser/src/browser-tool.ts`

### Step 2️⃣ Find the Toggle Line
**Search for:** `resolveBrowserSchemaMode`

**You'll find:**
```typescript
function resolveBrowserSchemaMode(): "full" | "simplified" {
  try {
    const cfg = browserToolDeps.loadConfig() as { tools?: { browser?: { schema?: unknown } } };
    const mode = cfg.tools?.browser?.schema;
    return mode === "simplified" ? "simplified" : "full";
  } catch {
    return "simplified";  // ← THIS IS THE TOGGLE
  }
}
```

### Step 3️⃣ Change It
Change `return "simplified";` to what you want:

#### For Ollama / Local Models 🦙
```typescript
return "simplified";
```

#### For Claude / GPT 🤖
```typescript
return "full";
```

### Step 4️⃣ Restart Gateway
```bash
pnpm openclaw gateway run
```

**Done!** ✅ The new schema is now active.

---

## What Changes?

### Before (What You Change)
- Line has: `return "simplified";`
- Browser tool uses: 4-parameter schema
- Best for: Ollama, NVIDIA, local models

### After (If You Change to "full")
- Line has: `return "full";`
- Browser tool uses: 30+-parameter schema
- Best for: Claude, GPT, Vertex AI

---

## Visual Guide

```
File: extensions/browser/src/browser-tool.ts
Line: ~375

BEFORE                          AFTER
═════════════════════════════════════════════════

return "simplified";            return "full";
     ↓                               ↓
Ollama gets 4 params           Claude gets 30+ params
    ✅ Works great!                 ✅ Works great!


To switch:
  1. Open file
  2. Change word
  3. Restart gateway
  4. Done!
```

---

## Where is This File?

From your OpenClaw root directory:

```
openclaw/
├── extensions/
│   ├── browser/
│   │   ├── src/
│   │   │   └── browser-tool.ts  ← EDIT THIS FILE
│   │   └── ...
│   └── ...
└── ...
```

Or use your IDE to search for `browser-tool.ts`

---

## Common Scenarios

### Scenario 1: Using Ollama
**Current setting**: `return "simplified";` ✅  
**Status**: Already perfect for you!  
**Action needed**: None

### Scenario 2: Using Claude
**Current setting**: `return "simplified";` ❌  
**Status**: Not ideal (Claude can handle full schema)  
**Action needed**: 
```
Change to: return "full";
Restart gateway
```

### Scenario 3: Want to Switch Back
**Current setting**: `return "full";`  
**Action needed**:
```
Change to: return "simplified";
Restart gateway
```

---

## Testing Your Toggle

After restarting the gateway:

1. Go to chat: `http://localhost:5173/chat`
2. Ask your model to use browser tool
3. If it works and tool calls are made → ✅ Toggle is working!
4. If errors appear → Model may not support current schema

---

## FAQ

**Q: Do I need to rebuild?**  
A: No, just change the line and restart the gateway.

**Q: Will my changes be saved?**  
A: Yes, the file is changed permanently until you change it back.

**Q: Which should I use?**  
A: 
- Local models (Ollama, NVIDIA) → `"simplified"`
- Powerful models (Claude, GPT) → `"full"`

**Q: Can I use config file instead?**  
A: Soon! Once the config schema is updated, you'll be able to use:
```json
{
  "tools": {
    "browser": {
      "schema": "simplified"
    }
  }
}
```

**Q: Can I see a UI toggle?**  
A: The UI component is ready! It just needs the config schema update to work properly.

---

## What This Does

### `"simplified"` Mode
Sends only these 4 parameters to the model:
- `action` - what to do (navigate, click, type, etc.)
- `url` - the website URL
- `ref` - element ID
- `text` - text to type

Result: Local models understand it better ✅

### `"full"` Mode
Sends all 30+ parameters including:
- `action`, `url`, `ref`, `text` (basic)
- `element`, `selector`, `modifiers`, `button` (advanced)
- `fn`, `frame`, `loadState`, `timeout` (expert)
- ... and more

Result: Powerful models can do everything ✅

---

## Still Can't Find It?

1. **Open your IDE** (VS Code, etc.)
2. **Press**: `Ctrl+P` (or `Cmd+P` on Mac)
3. **Type**: `browser-tool.ts`
4. **Press**: Enter
5. **Search**: `resolveBrowserSchemaMode` with `Ctrl+F`
6. **Look for**: `return "simplified";` or `return "full";`
7. **Edit**: Change the word
8. **Save**: `Ctrl+S`
9. **Restart gateway**: `pnpm openclaw gateway run`

---

**That's it! You now have control over which schema your browser tool uses.** 🎉
