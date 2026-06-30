# Plan: Remove Spaces Between Branch, Git Icon, and Filename

Strip the padding between the tree branch character, git status symbol,
and filename so they sit flush against each other.

---

## Current

```
├ ✚ renderer.mjs      (branch + space + git + space + name)
├ renderer.mjs         (branch + space + name, no git)
│ └ ● staged.mjs       (continuation + branch + space + git + space + name)
```

## Proposed

```
├✚renderer.mjs         (branch + git + name)
├renderer.mjs          (branch + name, no git)
│└●staged.mjs          (continuation + branch + git + name)
```

---

## Changes

### 1. Remove trailing space from `renderTreePrefix()` in `lib/renderer.mjs`

```js
// Before (line ~112):
prefix += node.isLast ? BOX.corner : BOX.tee
prefix += ' '

// After:
prefix += node.isLast ? BOX.corner : BOX.tee
// No trailing space
```

### 2. Remove trailing space from `renderGitSymbol()` in `lib/renderer.mjs`

```js
// Before (line ~144):
return colorFn(gitStatus.symbol + ' ')

// After:
return colorFn(gitStatus.symbol)
```

### 3. Update `gitSymbolLen` in `renderNodeLine()` in `lib/renderer.mjs`

```js
// Before (line ~196):
const gitSymbolLen = gitStatus ? 2 : 0  // symbol + space

// After:
const gitSymbolLen = gitStatus ? 1 : 0  // symbol only
```

---

## Files to modify

| File | Changes |
|------|---------|
| `lib/renderer.mjs` | 3 one-line changes in `renderTreePrefix`, `renderGitSymbol`, `renderNodeLine` |

---

## Edge cases

- **No git status:** `├renderer.mjs` — branch directly touches name. Readable
  because branch chars (├└) are visually distinct from alphanumerics.
- **Symlink indicator:** `@` appended after dirname, unaffected (added after name).
- **Collapsed indicator:** `…` appended after dirname, unaffected.
- **Padding/truncation:** `visibleLength(prefix)` and `gitSymbolLen` are both
  updated, so right-aligned heat indicators stay correct.
- **Continuation lines:** `│` + 1 space still separates vertical bars from
  deeper content at the next branch — that spacing is unchanged.

---

![fstop word cloud](../wordcloud.png)
