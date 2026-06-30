# Plan: Pass flags through to markdown preview app

## Context

The user wants to configure markserv with a color scheme via `~/.config/fstop/config.json`. The `markdownPreview` config value changes from a plain string to a structured object:

```json
{ "markdownPreview": { "command": "markserv", "flags": ["--theme", "solarized"] } }
```

The `flags` array gets spread into the spawn call before fstop's own args.

## Changes — all in `bin/watch.mjs`

### 1. State declaration (line 24)

Add `mdPreviewFlags` alongside `mdPreviewCmd`:

```javascript
let mdPreviewCmd = null
let mdPreviewFlags = []
```

### 2. Option parsing (lines 170-173)

Handle both the structured object (from config) and plain string (from CLI `--markdown-preview markserv`):

```javascript
if (options.mdPreview) {
    if (typeof options.mdPreview === 'object') {
        mdPreviewCmd = options.mdPreview.command
        mdPreviewFlags = options.mdPreview.flags || []
    } else {
        mdPreviewCmd = options.mdPreview
    }
}
```

### 3. Spawn call in `openMdPreview()` (line 309)

Spread `mdPreviewFlags` into the args:

```javascript
spawn(mdPreviewCmd, [...mdPreviewFlags, watchPath, '--port', String(mdPreviewPort), '--browser', 'false'], { ... })
```

### 4. Help text (line 114)

Update to mention structured config support.

## Files modified

- `bin/watch.mjs` — 4 small edits

## Verification

1. Set config to `{ "markdownPreview": { "command": "markserv", "flags": ["--theme", "solarized"] } }`
2. Run fstop, click a `.md` file — markserv spawns with `--theme solarized`
3. Verify `--markdown-preview markserv` (plain string via CLI) still works

---

![fstop word cloud](../wordcloud.png)
