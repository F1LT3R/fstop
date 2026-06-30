# Plan: Add config file system to fstop

## Context

Users want to persist CLI flags (like `--markdown-preview markserv`) across sessions without re-typing them. Rather than "sticky flags" (which are surprising), we're adding a config file system: global defaults at `~/.config/fstop/config.json`, with per-project overrides at `.fstop.json` in the project root.

## Precedence (highest wins)

1. CLI flags
2. `.fstop.json` (project root)
3. `~/.config/fstop/config.json` (global)
4. Built-in defaults

## Config file format

`.fstop.json` / `config.json`:
```json
{
  "markdownPreview": "markserv",
  "history": 4,
  "ignore": ["**/dist/**"],
  "interval": 100,
  "breathe": 2000,
  "ghostSteps": 3,
  "git": true,
  "loopcheck": false
}
```

All keys optional. `ignore` in config is **additive** to built-in defaults (same as `--ignore` CLI flag). No `path` or `quick` in config (those are always per-invocation).

## Files to modify

### 1. New file: `lib/config.mjs`

Config loader module:
- `loadConfig(projectRoot)` — reads global then project config, merges them
- Uses `fs.readFileSync` + `JSON.parse` — no dependencies needed
- Silently ignores missing files (returns `{}`)
- Logs a warning to stderr for malformed JSON, then skips that file
- Returns merged config object

### 2. `bin/watch.mjs`

- Import `loadConfig` from `lib/config.mjs`
- In `parseArgs()` or right after it in `main()`: load config, merge with defaults, then let CLI flags override
- The merge happens in `main()` after resolving `watchPath` (needed to locate `.fstop.json`):
  ```
  const config = loadConfig(watchPath)
  // Apply config values where CLI didn't explicitly set them
  ```
- Track which options were explicitly set via CLI (vs defaults) so CLI always wins

## Implementation detail: detecting explicit CLI flags

The tricky part: distinguishing "user passed `--history 4`" from "4 is the default". Approach: parse CLI into a sparse object (only keys the user actually typed), then merge:

```
finalOptions = { ...builtInDefaults, ...globalConfig, ...projectConfig, ...cliOverrides }
```

This means `parseArgs()` returns only the flags the user actually passed, and defaults live separately.

## Verification

1. `fstop` with no config, no flags → original defaults
2. Create `.fstop.json` with `{"markdownPreview": "markserv"}` → preview mode active
3. `fstop --no-git` with config that has `"git": true` → git disabled (CLI wins)
4. Global config + project config with different values → project wins
5. Malformed JSON → warning printed, fstop continues with defaults

---

![fstop word cloud](../wordcloud.png)
