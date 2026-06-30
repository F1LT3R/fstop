# Plan: Tighten Tree Indentation

Reduce tree indent from 4 chars per level to 2. Currently wastes horizontal
space — deeply nested files get pushed far right.

---

## Current spacing (4 chars/level)

```
├── lib/
│   ├── renderer.mjs
│   │   └── deep-thing.mjs
│   └── layout.mjs
└── test/
    └── foo.mjs
```

Each level: `│` + 3 spaces = 4 chars. Branch: `├──` + space = 4 chars.

## Proposed spacing (2 chars/level)

```
├ lib/
│ ├ renderer.mjs
│ │ └ deep-thing.mjs
│ └ layout.mjs
└ test/
  └ foo.mjs
```

Each level: `│` + 1 space = 2 chars. Branch: `├` + space or `└` + space = 2 chars.
Drop `BOX.horizontal` (`─`) entirely — the branch character alone is enough.

---

## Changes

### 1. `renderTreePrefix()` in `lib/renderer.mjs` (lines 96-115)

```js
// Before:
for (let i = 0; i < node.parentContinues.length; i++) {
    if (node.parentContinues[i]) {
        prefix += BOX.vertical + '   '    // 4 chars
    } else {
        prefix += '    '                   // 4 chars
    }
}
prefix += node.isLast ? BOX.corner : BOX.tee
prefix += BOX.horizontal + BOX.horizontal + ' '  // ── + space

// After:
for (let i = 0; i < node.parentContinues.length; i++) {
    if (node.parentContinues[i]) {
        prefix += BOX.vertical + ' '      // 2 chars
    } else {
        prefix += '  '                    // 2 chars
    }
}
prefix += node.isLast ? BOX.corner : BOX.tee
prefix += ' '                            // just space, no horizontals
```

### 2. Verify `visibleLength` calculations

`renderNodeLine()` uses `visibleLength(prefix)` for padding math (line 199).
Since `visibleLength` counts actual characters, not ANSI codes, this should
just work — shorter prefix = more room for name + heat indicators. No change
needed.

### 3. Verify `treeBranch()` in `lib/terminal.mjs` (line 196)

There's also a `treeBranch()` export. Check if anything uses it — if so, it
needs the same tightening. If unused, leave it (or tighten for consistency).

---

## Files to modify

| File | Changes |
|------|---------|
| `lib/renderer.mjs` | `renderTreePrefix()` — reduce indent from 4 to 2 chars/level, drop horizontal bars |

Single function change. The padding/truncation logic in `renderNodeLine()`
adapts automatically since it measures visible prefix length.

---

## Edge cases

- **Deep nesting:** Main beneficiary — 6 levels deep goes from 24 chars to 12
- **Root node:** Returns `''` unchanged (depth 0 early return)
- **Collapsed dirs:** `…` indicator appended after name, unaffected by prefix
- **Cursor highlight:** Applied to full line, unaffected
- **Filter highlighting:** Applied to name portion, unaffected

---

![fstop word cloud](../wordcloud.png)
