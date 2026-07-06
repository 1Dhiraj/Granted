# Browser Tool Schema Toggle

OpenClaw now supports toggling between two browser tool schemas:

## Modes

### Full Schema (Default)
- **Value**: `"full"`
- **Parameters**: 30+ fields including `action`, `url`, `ref`, `text`, `element`, `selector`, `modifiers`, `button`, `doubleClick`, `fn`, `frame`, and more
- **Best for**: Claude, GPT, and other powerful models that excel with complex schemas
- **Trade-off**: Local models (Ollama, NVIDIA) may struggle with schema complexity and refuse to use the tool

### Simplified Schema  
- **Value**: `"simplified"`
- **Parameters**: 4 core fields only (`action`, `url`, `ref`, `text`)
- **Best for**: Local models (Ollama, NVIDIA, Mistral, Llama) that work better with minimal schemas
- **Trade-off**: Requires more sequential tool calls for complex tasks (but still fully capable)

## How to Configure

### Current Status ⚠️

The feature is implemented in code but requires a schema update for config validation. Currently:
- ✅ Code logic is ready (`resolveBrowserSchemaMode()` function)
- ✅ Browser tool respects the setting when configured
- ❌ Config schema validation doesn't recognize `tools.browser` key yet

### Workaround: Direct Code Setting

Until the schema is updated, set the schema mode directly in the browser tool creation:

1. In `extensions/browser/src/browser-tool.ts`, find the `resolveBrowserSchemaMode()` function
2. Change the default return value:

```typescript
function resolveBrowserSchemaMode(): "full" | "simplified" {
  // Temporarily set to "simplified" for local model testing
  return "simplified";  // Change to "full" for Claude/GPT
}
```

3. Rebuild and restart the gateway

### Method 1: Edit Config File Directly (Future)

Once the schema is updated, you'll be able to edit `~/.openclaw/openclaw.json`:

```json
{
  "tools": {
    "browser": {
      "schema": "simplified"
    }
  }
}
```

Valid values: `"full"` (default) or `"simplified"`

**Then restart the gateway:**
```bash
openclaw gateway restart
```

### Method 2: Use the Web UI Settings

1. Open **Settings** (bottom left gear icon)
2. Switch to **Raw** tab (top right)
3. Find the `"tools"` section and add/update:
   ```json
   "tools": {
     "browser": {
       "schema": "simplified"
     }
   }
   ```
4. Click **Save** button
5. Restart the gateway for changes to take effect

### Method 3: Command Line

```bash
# Read current config
openclaw config get

# Set schema mode
openclaw config set tools.browser.schema simplified

# Restart to apply
openclaw gateway restart
```

## After Changing

Restart the gateway or reload the chat session for the new schema to take effect.

## Why Two Schemas?

| Aspect | Full Schema | Simplified |
|--------|-----------|------------|
| Parameters | 30+ | 4 |
| Model Support | Claude, GPT, Vertex AI | Ollama, NVIDIA, local models |
| Execution Speed | Fewer calls per task | More calls per task |
| Example Task | Fill 4 fields in 1 call | Fill 4 fields in 4 calls |
| Accuracy | High (for capable models) | Good (models actually use it) |

## Example: Logging In

### With Full Schema (Claude)
```javascript
// 1 call
{
  "action": "fill",
  "fields": [
    { "ref": "email-field", "value": "user@example.com" },
    { "ref": "password-field", "value": "password123" }
  ]
}

// 1 call
{
  "action": "click",
  "ref": "login-button"
}

// Total: 2 calls
```

### With Simplified Schema (Local Models)
```javascript
// Click email field
{ "action": "act", "kind": "click", "ref": "email-field" }

// Type email
{ "action": "act", "kind": "type", "text": "user@example.com" }

// Click password field  
{ "action": "act", "kind": "click", "ref": "password-field" }

// Type password
{ "action": "act", "kind": "type", "text": "password123" }

// Click button
{ "action": "act", "kind": "click", "ref": "login-button" }

// Total: 5 calls
```

Both achieve the same result. The simplified schema just takes more steps.

## Troubleshooting

**Q: I set it to "simplified" but still getting errors**  
A: Make sure you restarted the gateway after editing the config file. The schema is loaded at startup.

**Q: Should I use "simplified" with Claude?**  
A: No, leave it as "full" (default). Claude can handle the full schema and will be more efficient.

**Q: Can I switch back easily?**  
A: Yes, just edit the config and change the value back to `"full"` (or remove the setting entirely).

**Q: Does this affect the browser tool's actual capabilities?**  
A: No. Both schemas support the same operations (navigate, click, type, snapshot, etc.). The schema is just the **interface** the model sees—the underlying tool functionality is unchanged.
