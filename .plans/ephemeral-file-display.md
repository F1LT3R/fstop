# Plan: Ephemeral File Display

Files that aren't gitignored should cool down and disappear from view. Directories
persist as structural skeleton. Markdown files get a boost (clickable READMEs).
The tree becomes a pure "what's happening now" view.

---

## Problem

Currently, cold tracked files never reach zero weight:

| Node type      | Cold weight (no git status, no heat) |
|----------------|--------------------------------------|
| File           | 50 (type) + 75 (wasTouched, sticky) = **125** |
| Directory      | 100 (type) + 75 (wasTouched, sticky) = **175** |

The `wasTouched` flag is set once when a file is modified and **never cleared**.
Combined with the base type weight, files always have positive weight and never
drop out of the display. They only disappear when the terminal is too small and
higher-weight lines win the competition — but in a medium-sized project they all
fit and all stay visible forever.

---

## Changes

### 1. Rebalance `WEIGHT.type` in `lib/layout.mjs`

```js
type: {
    file:      0,   // was 50 — cold files should reach zero
    markdown: 75,   // NEW — .md files persist longer (READMEs, docs)
    dir:     500,   // was 100 — directories are structural, always prefer showing
},
```

Files start at 0 base weight. When hot or git-active they gain weight from those
categories. When cold with no git status, they're at 0 + tiebreaker heat (also 0)
= **0 total weight**. They lose the competition and drop out.

Directories at 500 will almost always survive. They only disappear if the terminal
is tiny and many higher-priority items compete (git conflicts at 800, filter matches
at 9000, etc).

Markdown files at 75 sit between files (0) and directories (500) — they'll persist
longer than regular files but still yield to active content.

### 2. Apply markdown weight in `calculateLineWeight()` in `lib/layout.mjs`

Change the type weight section:

```js
// 1. Type weight (file vs directory)
if (node.type === 'directory') {
    weight += WEIGHT.type.dir
} else if (node.name.toLowerCase().endsWith('.md')) {
    weight += WEIGHT.type.markdown
} else {
    weight += WEIGHT.type.file  // 0
}
```

### 3. Remove `wasTouched` as a permanent weight boost in `lib/layout.mjs`

The `WEIGHT.context.touched` (75) makes files sticky forever. Remove it from
`calculateLineWeight()`:

```js
// REMOVE this block:
if (node.wasTouched) {
    weight += WEIGHT.context.touched
}
```

And remove from `WEIGHT.context`:

```js
context: {
    hasChangedChildren: 200,
    inHistory:          100,
    // touched: 75,  — REMOVED
    ghost:               50,
},
```

**Note:** `wasTouched` is still used by `hasActiveDescendants()` and
`shouldAutoCollapse()` for the collapse system. We need to update those too,
otherwise directories with any previously-touched child will never collapse.

### 4. Update auto-collapse to not use `wasTouched` in `lib/layout.mjs`

In `hasActiveDescendants()` and `shouldAutoCollapse()`, remove the `wasTouched`
check:

```js
// Before:
if (hasGitStatus(node, gitStatus) || isHot(node.heat || 0) || node.wasTouched) {

// After:
if (hasGitStatus(node, gitStatus) || isHot(node.heat || 0)) {
```

This means directories with cold, non-git-status children will now collapse.
That's the desired behavior — only active content keeps the tree open.

### 5. Adjust `hasChangedChildren` weight in `lib/layout.mjs`

Directories with active children currently get +200. This should stay — it keeps
parent directories visible when they contain hot files. But verify: a directory
with `dir` weight 500 + `hasChangedChildren` 200 = 700 is below git conflict
(800) and filter match (9000). Good.

No change needed here.

### 6. Verify gitignored file interaction

Gitignored files: weight = 0 (file) - 200 (ignored) = **-200**. Still well below
cold tracked files at 0. Good — they sink further than ephemeral cold files.

Gitignored markdown: weight = 75 (markdown) - 200 (ignored) = **-125**. Still
negative, still sinks. Good.

---

## Weight table after changes

| Scenario | Weight |
|----------|--------|
| Root | 10000 |
| Filter match (file) | 9000 |
| Git conflict (file) | 800 |
| Git untracked (file) | 750 |
| Git unstaged (file) | 700 |
| Git staged (file) | 600 |
| Directory (cold, no children) | 500 |
| Directory (with active children) | 700 |
| Hot file (recently modified) | 350 + heat tiebreaker |
| Hot file + git unstaged | 1050 |
| File in history | 100 |
| Markdown file (cold) | 75 |
| Regular file (cold) | **0** |
| Gitignored file | -200 |
| Gitignored markdown | -125 |

---

## Files to modify

| File | Changes |
|------|---------|
| `lib/layout.mjs` | Rebalance `WEIGHT.type`, add `markdown` key, remove `WEIGHT.context.touched`, update `calculateLineWeight()` type section, remove `wasTouched` from `hasActiveDescendants()` and `shouldAutoCollapse()` |

Single file change. No changes needed to `heat.mjs`, `tree-state.mjs`,
`renderer.mjs`, `git-status.mjs`, or `watch.mjs`.

The `wasTouched` field on tree nodes can stay — it's harmless and could be
useful for future features. We just stop using it for weight and collapse
decisions.

---

## Edge cases

- **File modified, then goes cold:** Gains heat weight (350) + event weight (50)
  immediately. Over ~10s heat decays below threshold, loses heat weight. Falls to
  `inHistory` (100) briefly, then to 0. Disappears from view.

- **Directory with one hot child:** Dir gets 500 + 200 (hasChangedChildren) = 700.
  When child cools, dir drops to 500. Still visible as skeleton.

- **Empty directory:** Weight 500. Visible. If no children are active, it may
  auto-collapse (shown as `dir/…`).

- **README.md never modified:** Weight 75. Persists longer than regular files but
  will yield to active content when space is tight.

- **Everything is cold:** Tree shows directories (500 each) + any markdown files
  (75 each). Regular files at 0 drop out. Display is a clean directory skeleton
  with READMEs.

- **`selectVisibleLines` when everything fits:** If `allLines.length <= availableRows`,
  ALL lines show regardless of weight. Zero-weight files would still appear in a
  small project. This is fine — the ephemeral behavior only kicks in when the tree
  exceeds terminal height.

---

## Testing

1. Modify a file, watch it appear hot, then cool and disappear (~10-15s)
2. Verify directories stay visible after all children cool
3. Verify README.md persists longer than regular files
4. Verify git-status files (staged, unstaged) persist until committed
5. Verify gitignored files still sink below everything
6. Test in a small project where everything fits — all files should still show
7. Test in a large project — cold files should drop, leaving directory skeleton
