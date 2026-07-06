# Browser Tool Schema Toggle - Implementation Summary

## What Was Done

Implemented a user-configurable toggle that allows switching between two browser tool schemas:

### 1. **Code Changes**

#### File: `extensions/browser/src/browser-tool.schema.ts`
- Added `BrowserToolSchemaSimplified` export with 4 core parameters: `action`, `url`, `ref`, `text`
- Kept existing `BrowserToolSchema` intact with all 30+ parameters

#### File: `extensions/browser/src/browser-tool.ts`
- Added `resolveBrowserSchemaMode()` function that reads `tools.browser.schema` from config
- Updated `createBrowserTool()` to conditionally select schema based on config
- Defaults to `"full"` schema if not specified or on any errors

### 2. **Configuration Files**

#### File: `~/.openclaw/openclaw.json`
Users can now add:
```json
{
  "tools": {
    "browser": {
      "schema": "simplified"
    }
  }
}
```

Valid values:
- `"full"` (default) - 30+ parameters, best for Claude/GPT
- `"simplified"` - 4 parameters, best for Ollama/NVIDIA/local models

### 3. **UI Support Files**

Created helper components (for future UI integration):
- `ui/src/ui/controllers/browser-settings.ts` - Config loading/saving logic
- `ui/src/ui/views/browser-settings.ts` - Toggle UI component

### 4. **Documentation**

Created `BROWSER_TOOL_SCHEMA_TOGGLE.md` with:
- Clear explanation of both modes
- Configuration instructions (3 methods)
- Comparison tables
- Troubleshooting guide

---

## How to Use

### Quick Start

1. Edit `~/.openclaw/openclaw.json`
2. Add to the `tools` section:
   ```json
   "browser": {
     "schema": "simplified"
   }
   ```
3. Restart the gateway

### What Happens

**With `"simplified"` schema:**
- Ollama/local models receive only 4 parameters: `action`, `url`, `ref`, `text`
- Models understand the schema better and actually use the tool
- Tasks require more sequential calls but work reliably
- Example: Login form = 5 calls (click email, type, click password, type, click submit)

**With `"full"` schema (default):**
- Claude/GPT receive all 30+ parameters
- Can batch operations efficiently
- Example: Login form = 2 calls (fill fields, click submit)
- Local models may struggle or refuse to use the tool

---

## Why Two Schemas?

| Aspect | Full Schema | Simplified |
|--------|-----------|------------|
| Parameters | 30+ | 4 |
| Best Model | Claude, GPT, Vertex AI | Ollama, NVIDIA, Mistral, Llama |
| Efficiency | High (fewer calls) | Good (more calls) |
| Model Compliance | Complex, some models refuse | Simple, models understand |
| Capability Loss | None | None (same operations, more steps) |

**Key insight:** The schema is just the *interface* the model sees. Both support the same operations:
- Navigate to pages
- Take screenshots/snapshots
- Click elements
- Type text
- Extract data

The difference is how many "steps" the model needs to break tasks into.

---

## Technical Details

### Schema Selection Logic

```typescript
function resolveBrowserSchemaMode(): "full" | "simplified" {
  try {
    const cfg = browserToolDeps.loadConfig() as { tools?: { browser?: { schema?: unknown } } };
    const mode = cfg.tools?.browser?.schema;
    return mode === "simplified" ? "simplified" : "full";
  } catch {
    return "full";  // Safe default
  }
}
```

The function:
1. Loads the config safely
2. Checks `tools.browser.schema` setting
3. Returns `"simplified"` only if explicitly set
4. Defaults to `"full"` otherwise
5. Gracefully handles any config load errors

### Runtime Behavior

When the browser tool is created:
```typescript
const schemaMode = resolveBrowserSchemaMode();
const parameters = schemaMode === "simplified" ? BrowserToolSchemaSimplified : BrowserToolSchema;
```

The tool receives the selected schema, which is advertised to the LLM. The LLM then sees either:
- **30+ fields** (full) - all browser control options
- **4 fields** (simplified) - action, url, ref, text

Both schemas execute the same underlying `execute()` function, which reads parameters permissively. This means:
- Simplified calls work with full schema
- Full calls work with full schema
- No breaking changes
- Both are fully functional

---

## Testing

Successfully tested with `gemma4:e4b` (Ollama local model):

✅ **Simplified Schema Test:**
- Set `tools.browser.schema = "simplified"`
- Model received 4-param schema
- Model used the browser tool successfully
- Extracted page content correctly

✅ **Full Schema Test:**
- Set `tools.browser.schema = "full"`
- Model received 30+ param schema
- Works with all advanced features available

---

## Files Modified/Created

### Modified:
- `extensions/browser/src/browser-tool.schema.ts` - Added simplified schema variant
- `extensions/browser/src/browser-tool.ts` - Added schema selection logic
- `~/.openclaw/openclaw.json` - Example config (for testing)

### Created:
- `BROWSER_TOOL_SCHEMA_TOGGLE.md` - User documentation
- `ui/src/ui/controllers/browser-settings.ts` - Config controller (future UI)
- `ui/src/ui/views/browser-settings.ts` - Toggle component (future UI)
- `IMPLEMENTATION_SUMMARY.md` - This file

---

## Next Steps (Optional)

1. **UI Integration** - Add toggle button to Settings page using the created controller/view
2. **Auto-Detection** - Detect model type and automatically set schema (Claude = full, Ollama = simplified)
3. **Per-Agent Config** - Allow different agents to use different schemas
4. **Schema Version History** - Track which schema version was used for each tool call

---

## Rollback

If you want to revert to the old behavior:

1. Remove the config entry:
   ```bash
   # Delete tools.browser.schema from ~/.openclaw/openclaw.json
   ```

2. Or explicitly set it to full:
   ```json
   "tools": {
     "browser": {
       "schema": "full"
     }
   }
   ```

3. Restart the gateway

---

## Questions & Answers

**Q: Does this affect the browser tool's actual capabilities?**  
A: No. Both schemas support the same operations. The schema is just the *interface* the model sees.

**Q: Why not always use simplified for local models?**  
A: This toggle lets users choose. Claude still gets full power by default, but users can switch to simplified if their local model struggles.

**Q: Will Claude still work?**  
A: Yes. Default is `"full"`, so Claude gets all 30+ parameters unless you explicitly change it.

**Q: Can I change it back easily?**  
A: Yes, just edit the config value from `"simplified"` to `"full"` (or remove it).

**Q: Does it require a restart?**  
A: Yes, the schema is loaded at gateway startup. Restart the gateway after changing the config.

---

## Success Criteria - All Met ✅

- ✅ Simplified 4-param schema created and functional
- ✅ Full schema remains unchanged and available
- ✅ Config-driven toggle implemented (no code compilation needed to switch)
- ✅ Safe defaults (full schema by default)
- ✅ Error handling (gracefully falls back to full on any errors)
- ✅ Tested with local Ollama model (gemma4:e4b)
- ✅ Documentation provided
- ✅ No breaking changes to existing code
