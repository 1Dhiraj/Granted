# Browser Tool Schema Toggle - UI Guide

## 📍 Where to Find the Toggle

### Current Status
The UI toggle component has been created but needs to be integrated into the main settings page. Here's how to access it:

### Quick Way (Edit Code Setting Directly)

For now, the easiest way to toggle is to **edit the default in the code**:

**File**: `extensions/browser/src/browser-tool.ts`

**Line**: Around 375 in the `resolveBrowserSchemaMode()` function

```typescript
function resolveBrowserSchemaMode(): "full" | "simplified" {
  try {
    const cfg = browserToolDeps.loadConfig() as { tools?: { browser?: { schema?: unknown } } };
    const mode = cfg.tools?.browser?.schema;
    return mode === "simplified" ? "simplified" : "full";
  } catch {
    return "simplified";  // ← TOGGLE THIS LINE
    //      ↓
    // Change between "simplified" and "full"
  }
}
```

### What to Change

**For Local Models (Ollama, NVIDIA):**
```typescript
return "simplified";  // ← Use this
```

**For Claude, GPT:**
```typescript
return "full";  // ← Use this
```

### After Changing

1. Save the file
2. Restart the gateway:
   ```bash
   pnpm openclaw gateway run
   ```
3. The new schema takes effect immediately

---

## 🎨 UI Toggle Component (Ready for Integration)

We've created a beautiful UI toggle component. Here's what it will look like:

```
┌─────────────────────────────────────────────┐
│  Browser Tool Schema                        │
│  Choose the tool schema that works best     │
│                                             │
│  ┌──────────────┐  ┌──────────────┐       │
│  │📋 Full       │  │⚡ Simplified │       │
│  │ 30+ params   │  │ 4 parameters │       │
│  │ Claude & GPT │  │ Ollama/Local │       │
│  └──────────────┘  └──────────────┘       │
│                                             │
│  Info about each option shown below         │
└─────────────────────────────────────────────┘
```

### To Enable the UI Toggle (Future)

The component is ready in: `ui/src/ui/views/browser-tool-settings.ts`

To integrate it into the Settings page:
1. Import the component in your settings view
2. Add it as a section in the browser tool settings
3. Wire up the `onToggle` callback to save the preference
4. Update the config schema to recognize `tools.browser.schema`

---

## 📝 Schema Comparison

### Full Schema (30+ parameters)
```typescript
{
  action: "navigate",
  url: "https://example.com",
  ref: "element-id",
  text: "search text",
  element: "description",
  selector: "css-selector",
  modifiers: ["Ctrl", "Shift"],
  button: "left",
  doubleClick: true,
  // ... and 20+ more parameters
}
```
✅ All advanced browser operations  
✅ Efficient (fewer calls)  
❌ Complex for local models  

### Simplified Schema (4 parameters)
```typescript
{
  action: "navigate",
  url: "https://example.com",
  ref: "element-id",
  text: "search text"
}
```
✅ Simple and clear  
✅ Local models understand it  
✅ Same capabilities, more calls  

---

## 🚀 How to Use

### Option 1: Code-Level Toggle (Right Now)
Edit `extensions/browser/src/browser-tool.ts` and change the return value

### Option 2: Config File (When Schema Updates)
Once the config schema recognizes `tools.browser`, use:
```json
{
  "tools": {
    "browser": {
      "schema": "simplified"
    }
  }
}
```

### Option 3: Web UI Toggle (Future Integration)
The UI component is ready to be integrated into the Settings page

---

## ✅ Quick Checklist

- [x] Schema variants created (simplified & full)
- [x] Runtime selection logic implemented
- [x] UI toggle component created
- [x] Documentation written
- [ ] Config schema updated (needed for UI toggle)
- [ ] UI component integrated into settings

---

## Need Help?

1. **Toggle not taking effect?**
   - Make sure you restarted the gateway
   - Check the file path: `extensions/browser/src/browser-tool.ts`
   - Look for `resolveBrowserSchemaMode()` function

2. **Which schema should I use?**
   - **Ollama, NVIDIA, local models** → Use `"simplified"`
   - **Claude, GPT, Vertex AI** → Use `"full"`

3. **Want the UI toggle?**
   - File is ready: `ui/src/ui/views/browser-tool-settings.ts`
   - Just needs to be integrated into the settings page
   - Config schema needs to recognize `tools.browser` key

---

## 📞 Support

For detailed technical info, see:
- `BROWSER_SCHEMA_TOGGLE_FINAL.md` - Complete implementation guide
- `BROWSER_TOOL_SCHEMA_TOGGLE.md` - User documentation
- `IMPLEMENTATION_SUMMARY.md` - Technical summary
