# Plan: Manual Directory Fold/Hide with Toggle Indicators

Add keyboard and mouse controls for folding (collapsing) and hiding
directories, with visual toggle indicators on every directory line.

---

## Features

1. **Ctrl+Up** — fold directory at cursor (collapse, hide children)
2. **Ctrl+Down** — unfold directory at cursor (expand, show children)
3. **[▶▶▶]** indicator after folded directory names (clickable)
4. **[▼▼▼]** indicator after open directory names (clickable)
5. **Click on toggle** — fold/unfold the directory
6. **Ctrl+click on directory** — hide it entirely (removed from view)
7. **Escape** — clears everything: filter, manual folds, and hidden dirs

---

## State

In `bin/watch.mjs`, add two Sets alongside existing interactive state:

```js
const manualFolds = new Set()   // paths of manually folded dirs
const hiddenDirs = new Set()    // paths of completely hidden dirs
```

These are passed to `generateLayout` as options so the layout engine
can respect them.

---

## Changes

### 1. Add fold/hide state and keyboard handlers in `bin/watch.mjs`

Add `manualFolds` and `hiddenDirs` Sets near the existing interactive
state (line ~18).

**Keyboard handlers** (in the keypress handler, BEFORE the existing
up/down handlers so Ctrl variants are caught first):

```js
// Ctrl+Up: fold directory at cursor
if (key.name === 'up' && key.ctrl) {
    const line = visibleLines[cursorIndex]
    if (line?.node?.type === 'directory') {
        manualFolds.add(line.node.path)
    }
    dirty = true
    await doRender()
    return
}

// Ctrl+Down: unfold directory at cursor
if (key.name === 'down' && key.ctrl) {
    const line = visibleLines[cursorIndex]
    if (line?.node?.type === 'directory') {
        manualFolds.delete(line.node.path)
    }
    dirty = true
    await doRender()
    return
}
```

**Escape handler** — extend to clear everything:

```js
if (key.name === 'escape') {
    filterPattern = ''
    manualFolds.clear()
    manualOpens.clear()
    hiddenDirs.clear()
    cursorIndex = 0
    dirty = true
    await doRender()
    return
}
```

**Pass to layout** — in `doRender()`, add to `generateLayout` options:

```js
const layout = generateLayout(treeState, {
    terminalSize: getTerminalSize(),
    gitStatus,
    filterPattern,
    manualFolds,
    hiddenDirs,
})
```

### 2. Update mouse click handler in `bin/watch.mjs`

The existing handler (line ~218) needs three changes:

**a. Fix prefix length calculation** (currently wrong after tree spacing
tightening — uses `* 4 + 4` but should be `* 2 + 2`):

```js
// Before:
const prefixLen = node.depth > 0
    ? ((node.parentContinues?.length || 0) * 4 + 4) : 0

// After:
const prefixLen = node.depth > 0
    ? ((node.parentContinues?.length || 0) * 2 + 2) : 0
```

**b. Add toggle click zone** — after name, there's the toggle indicator
(5 visible chars: `[▶▶▶]` or `[▼▼▼]`). Detect clicks on it:

```js
const clickableEnd = prefixLen + gitLen + nameLen

// Toggle indicator zone (directories only)
if (node.type === 'directory' && node.depth > 0) {
    const toggleStart = clickableEnd + 1  // space after name
    const toggleEnd = toggleStart + 5     // [▶▶▶] or [▼▼▼]
    if (col > clickableEnd && col <= toggleEnd) {
        // Toggle fold
        if (manualFolds.has(node.path)) {
            manualFolds.delete(node.path)
        } else {
            manualFolds.add(node.path)
        }
        dirty = true
        await doRender()
        return
    }
}
```

**c. Handle Ctrl+click** — SGR mouse protocol encodes Ctrl as button +16.
Accept button 16 (Ctrl+left) for hiding:

```js
// Before:
if (button !== 0 || !isPress) return

// After:
const isCtrl = button === 16
if ((button !== 0 && button !== 16) || !isPress) return

// ... later, in the click handling:
if (isCtrl && node.type === 'directory') {
    hiddenDirs.add(node.path)
    dirty = true
    await doRender()
    return
}
```

### 3. Respect folds/hides in layout — `lib/layout.mjs`

**a. Pass options through** — `generateLayout` → `generateAllLines` →
`flattenTree` need the Sets.

In `generateLayout`, extract from options:

```js
const manualFolds = options.manualFolds || new Set()
const hiddenDirs = options.hiddenDirs || new Set()
```

Pass to `generateAllLines` and then to `flattenTree`.

**b. In `flattenTree`** — add two checks:

```js
// Skip hidden dirs entirely
if (hiddenDirs.has(treeNode.path)) {
    return []  // not even the dir line shows
}

// Manual fold: show dir line but don't recurse
if (manualFolds.has(treeNode.path)) {
    layoutNode.collapsed = true
    layoutNode.manualFold = true  // flag for renderer
    return result
}
```

These checks go BEFORE the existing auto-collapse check. Manual fold
takes priority over auto-collapse decisions.

**c. Add `manualFold` to layout node** — in `createLayoutNode`, add:

```js
manualFold: false,
```

### 4. Render toggle indicators — `lib/renderer.mjs`

In `renderNodeLine`, after the collapsed `…` indicator block (line ~237),
add the toggle indicator for directories:

```js
// Directory fold/unfold toggle indicator
if (node.type === 'directory' && node.depth > 0) {
    if (node.collapsed || node.manualFold) {
        leftPart += ' ' + chalk.dim('[▶▶▶]')
        leftLen += 6  // space + 5 chars
    } else {
        leftPart += ' ' + chalk.dim('[▼▼▼]')
        leftLen += 6
    }
}
```

This goes AFTER the symlink `@` and collapsed `…` indicators, so:
`dir_name/@…[▶▶▶]` in the most complex case.

The `leftLen` increase ensures right-aligned heat indicators don't
overlap.

---

## Files to modify

| File | Changes |
|------|---------|
| `bin/watch.mjs` | Add state Sets, Ctrl+Up/Down handlers, extend Escape, fix mouse prefix calc, add toggle/Ctrl+click zones, pass folds/hides to layout |
| `lib/layout.mjs` | Accept folds/hides in generateLayout/flattenTree, add `manualFold` field, skip hidden/fold children |
| `lib/renderer.mjs` | Render `[▶▶▶]`/`[▼▼▼]` toggle indicators on directory lines |

---

## Edge cases

- **Fold a dir, child gets git status:** Dir stays folded (manual fold
  overrides auto-expand). User must Ctrl+Down or Escape to see the child.
- **Hide a dir, then Escape:** Reveals all hidden dirs (clears everything).
- **Ctrl+click on a file (not dir):** Ignored — only dirs can be hidden.
  Regular click opens the file as before.
- **Ctrl+Up on a file:** Ignored — fold only applies to directories.
- **Root directory:** Skip toggle/fold for depth 0 (root always shows).
- **Auto-collapsed dir:** Shows `…[▶▶▶]` — clicking toggle manually
  unfolds it (adds to `manualOpens`... hmm, this needs thought).

### Auto-collapse vs manual fold interaction

When a dir is auto-collapsed and the user clicks `[▶▶▶]` to unfold:
- Remove from `manualFolds` (if present)
- Need a `manualOpens` Set to override auto-collapse? Or simpler: once
  the user interacts with a dir, it's fully manual.

Simplest approach: only use `manualFolds`. Clicking the toggle on an
auto-collapsed dir opens it by adding its path to a `manualOpens` Set.
Auto-collapse skips dirs in `manualOpens`.

Add a third Set:

```js
const manualOpens = new Set()  // dirs forced open (overrides auto-collapse)
```

In `flattenTree`, the auto-collapse check becomes:

```js
if (collapse && depth > 0 && gitStatus
    && !manualOpens.has(treeNode.path)
    && shouldAutoCollapse(treeNode, gitStatus)) {
```

Escape clears all three Sets.

---

## Rendering examples

Open directory:
```
├ lib/ [▼▼▼]
│ ├ renderer.mjs
│ └ layout.mjs
```

Manually folded:
```
├ lib/…[▶▶▶]
```

Hidden (Ctrl+click): not shown at all.

---

![fstop word cloud](../wordcloud.png)
