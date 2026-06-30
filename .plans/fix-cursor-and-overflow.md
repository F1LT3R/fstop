# Plan: Fix Cursor Wrap and Line Overflow

Two related bugs: the `<` cursor indicator wraps to the next line, and long
filenames bleed past the terminal edge.

---

## Problem

### Cursor wraps

Line 517-521 in `renderWithInteractive`:
```js
let renderedLine = renderNodeLine(node, now, isCursor ? cols - 2 : cols, ...)
if (isCursor) {
    renderedLine = chalk[RENDER_CONFIG.cursorBg](renderedLine) + ' ' + RENDER_CONFIG.cursorIndicator
}
```

Reserves 2 chars (`cols - 2`) then appends ` <` (2 chars) = `cols` total.
But `renderNodeLine` doesn't enforce its width budget — if the name is long,
`leftLen` exceeds `maxWidth`, padding goes to `minGap` (2), and the total
line overflows. Adding ` <` makes it worse.

### Names overflow and wrap

`renderNodeLine` never truncates `displayName`. It calculates `leftLen` and
uses it for padding math, but a name wider than `maxWidth` just bleeds past
the terminal edge and wraps to the next line.

---

## Changes

### 1. Truncate display name in `renderNodeLine()` in `lib/renderer.mjs`

Truncate BEFORE any ANSI styling to avoid cutting escape sequences.

Insert right after `displayName` is built (after the `directory` `/` append),
before filter highlight:

```js
// Truncate name to fit available width
const prefixLen = visibleLength(prefix)
const maxNameLen = maxWidth - prefixLen - gitSymbolLen
if (displayName.length > maxNameLen) {
    displayName = truncate(displayName, Math.max(1, maxNameLen))
}
```

This requires computing `gitSymbolLen` earlier (move it above truncation).

Final order in `renderNodeLine`:

1. `displayName` built (name + `/` for dirs)
2. `gitSymbolLen` computed
3. **Truncate `displayName`** (pure text, no ANSI yet)
4. Filter highlight applied
5. `styledName` built (strikethrough for ghosts/deleted)
6. `leftLen` computed (now always <= maxWidth)
7. Color/hyperlink styling applied

### 2. Superimpose cursor `<` on last column in `lib/renderer.mjs`

Render line at `cols - 1`, append `<` inside the bgRed block:

```js
// Before:
let renderedLine = renderNodeLine(node, now, isCursor ? cols - 2 : cols, ...)
if (isCursor) {
    renderedLine = chalk[RENDER_CONFIG.cursorBg](renderedLine) + ' ' + RENDER_CONFIG.cursorIndicator
}

// After:
let renderedLine = renderNodeLine(node, now, isCursor ? cols - 1 : cols, ...)
if (isCursor) {
    renderedLine = chalk[RENDER_CONFIG.cursorBg](renderedLine + RENDER_CONFIG.cursorIndicator)
}
```

Line is `cols - 1` visible chars + `<` = exactly `cols`. No space, no overflow.

---

## Files to modify

| File | Changes |
|------|---------|
| `lib/renderer.mjs` | Truncate `displayName` in `renderNodeLine()`, change cursor composition in `renderWithInteractive()` |

---

## Edge cases

- **Very narrow terminal:** `maxNameLen` could go to 0 or negative.
  `truncate()` handles `maxWidth <= 3` by slicing. Guard with `Math.max(1, ...)`.
- **Name shorter than maxWidth:** No truncation, no change in behavior.
- **Cursor on short line:** Line padded to `cols - 1` with trailing spaces,
  `<` lands at last column. Clean.
- **Filter highlight + truncation:** Truncation happens before filter
  highlight, so no ANSI sequences get cut mid-stream.

---

![fstop word cloud](../wordcloud.png)
