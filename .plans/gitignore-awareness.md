# Plan: .gitignore Awareness

Make fstop aware of `.gitignore` files so that gitignored files sink to the bottom
of the tree (lower weight) and render visually dimmed.

## Approach

Use `git ls-files` to discover which files are tracked/ignored, leveraging git's
own ignore logic (handles nested `.gitignore`, global ignores, `.git/info/exclude`).
This avoids parsing `.gitignore` files manually.

---

## 1. Add gitignore tracking to `lib/git-status.mjs`

The `GitStatus` class already runs `git status --porcelain=v1` and caches results
per-repo. Extend it to also track which files are gitignored.

**New field:** `this.ignoredFiles = new Set()` — stores full paths of gitignored files.

**New method:** `fetchIgnoredFiles()` — runs inside `refresh()` alongside existing
`fetchFileStatusInto()` and `fetchAheadBehindValues()`:

```
git ls-files --others --ignored --exclude-standard
```

This outputs paths of files that exist on disk but are excluded by `.gitignore`.
Parse the output the same way as `fetchFileStatusInto`: prepend `this.rootPath + '/'`
to each line to get full paths, store in a `Set`.

**New method:** `isIgnored(path, type)` — returns `true` if the path (file or
any ancestor directory) is in the ignored set. For directories, check if any
file in `ignoredFiles` starts with `path + '/'`.

**New static method:** `isPathIgnored(path, type)` — static lookup mirroring the
pattern of `getStatusForPath()`. Finds the best-match `GitStatus` instance and
delegates to `isIgnored()`.

**New method:** `aggregateDirIgnored()` — builds `this.ignoredDirs = new Set()`.
A directory is "ignored" if ALL of its children in the tree are ignored. This is
called after `fetchIgnoredFiles()` completes. Actually, simpler: just check
membership on the fly in `isIgnored()` by checking if any file under the dir
prefix exists in `ignoredFiles`.

**Change detection:** Include `ignoredFiles.size` in the `refresh()` change check
so the display updates when `.gitignore` changes.

---

## 2. Mark nodes as gitignored in tree state (`lib/tree-state.mjs`)

Add an `isGitIgnored` field to `createNode()` (default `false`).

No other changes needed in tree-state — the marking will happen at render/layout
time using the `GitStatus.isPathIgnored()` lookup, same pattern as how git status
symbols are looked up at render time rather than stored on nodes.

Actually, on reflection: **don't add a field to tree nodes.** The gitignore status
is already available via `GitStatus.isPathIgnored()` at layout/render time, same
as regular git status. This keeps the architecture consistent — git data lives in
`GitStatus`, not duplicated on tree nodes.

---

## 3. Lower weight for gitignored files in `lib/layout.mjs`

Add a new weight category in `WEIGHT`:

```js
gitignore: {
    ignored: -200,  // Negative weight — sinks below cold files
},
```

In `calculateLineWeight()`, after the git status weight section, add:

```js
// Gitignore penalty (sinks ignored files to bottom)
if (gitStatus && GitStatus.isPathIgnored(node.path, node.type)) {
    weight += WEIGHT.gitignore.ignored
}
```

This is additive with the existing system. A gitignored file starts with base
weight 50 (file type), minus 200 = -150. A normal cold file has weight 50.
So gitignored files sink well below normal files.

Also update the sort in `flattenTree()` — gitignored files should sort after
non-ignored files within the same directory:

```js
// 1.5. Gitignored files last
if (gitStatus) {
    const aIgnored = GitStatus.isPathIgnored(a.path, a.type)
    const bIgnored = GitStatus.isPathIgnored(b.path, b.type)
    if (aIgnored !== bIgnored) {
        return aIgnored ? 1 : -1
    }
}
```

Insert this after the "directories first" check and before the git status check.

---

## 4. Visual dimming in `lib/renderer.mjs`

In `renderNodeLine()`, after determining `colorFn`, check if the file is gitignored:

```js
const isIgnored = gitStatus && GitStatus.isPathIgnored(node.path, node.type)
```

Then in the color application block (lines 202-210), add an `isIgnored` branch:

```js
if (isIgnored) {
    coloredName = chalk.dim(styledName)  // dim gray
}
```

This should take priority over the default `chalk.white(styledName)` but NOT
override git status colors or hot colors — if a gitignored file gets modified,
the heat/git styling should still show (the file is actively being worked on).

So the priority order becomes:
1. Ghost (deleted) → `chalk.redBright`
2. Has git status OR is hot → `colorFn.bold`
3. Gitignored → `chalk.dim`
4. Default → `chalk.white`

The tree-drawing prefix (box lines) for ignored files should also be dimmed.
Apply `chalk.dim()` to the prefix when `isIgnored` is true.

---

## 5. Pass gitStatus into isPathIgnored lookups

The `renderNodeLine` function already receives `gitStatus` as a parameter, but
it's the per-file status object (symbol/color), not the `GitStatus` class instance.

For the `isPathIgnored` check, we need access to the static method
`GitStatus.isPathIgnored()` which uses the module-level cache. Since `GitStatus`
is already imported in `renderer.mjs`, we can call the static method directly
with just the path — no additional parameter passing needed.

Same for `layout.mjs` — `GitStatus` is already imported.

---

## 6. Directory handling

A directory should appear dimmed if ALL its visible children are gitignored.
The simplest approach: in `GitStatus.isIgnored(path, 'directory')`, return true
if every file under `path + '/'` in the tree is in `ignoredFiles`.

However, this is expensive for large directories. Better approach: track ignored
directories explicitly. After building `ignoredFiles`, derive `ignoredDirs`:
walk up from each ignored file path and mark each ancestor directory. A directory
is "fully ignored" only if it has no non-ignored descendants.

Simplest correct approach: `isIgnored(path, 'directory')` checks if the directory
path itself was output by `git ls-files` (it won't be — git only outputs files).
Instead, we can run:

```
git check-ignore --quiet <path>
```

But that's expensive per-directory. Better: use `git status --ignored --porcelain`
which includes `!! path/` for ignored directories. Actually let's combine:

**Final approach for directories:** Run `git status --porcelain=v1 --ignored`
instead of plain `git status --porcelain=v1`. This adds `!! path` entries for
ignored files/dirs. Parse `!!` entries into `ignoredFiles` set. This gives us
both files AND directories in one command, replacing the need for a separate
`git ls-files` call.

Wait — `git status --ignored` may double-report. Let's keep it clean:

**Revised approach:** Keep existing `git status --porcelain=v1` unchanged.
Add a *second* command:

```
git ls-files --others --ignored --exclude-standard --directory
```

The `--directory` flag makes it output ignored directory names (with trailing `/`)
instead of recursing into them. This gives us both ignored files and ignored
directories efficiently.

Parse output: lines ending in `/` → add to `ignoredDirs` set (strip trailing `/`).
Other lines → add to `ignoredFiles` set.

`isIgnored(path, type)`:
- If `type === 'file'`: return `ignoredFiles.has(path)`
- If `type === 'directory'`: return `ignoredDirs.has(path)`

---

## Files to modify

| File | Changes |
|------|---------|
| `lib/git-status.mjs` | Add `ignoredFiles`/`ignoredDirs` sets, `fetchIgnoredFiles()`, `isIgnored()`, static `isPathIgnored()` |
| `lib/layout.mjs` | Add `WEIGHT.gitignore.ignored`, penalty in `calculateLineWeight()`, sort order in `flattenTree()` |
| `lib/renderer.mjs` | Dim styling for ignored files (name + tree prefix) |

No changes needed to: `tree-state.mjs`, `file-watcher.mjs`, `heat.mjs`,
`watch.mjs`, `config.mjs`, `terminal.mjs`.

---

## Edge cases

- **File in `.gitignore` gets modified:** It gains heat + the `change` event weight.
  Heat styling overrides dim styling, so it becomes visible. Weight: 50 (file) +
  350 (hot) + 50 (change event) - 200 (ignored) = 250. Still positive, still visible.

- **Not a git repo:** `GitStatus.isPathIgnored()` returns `false` (no GitStatus
  instance exists). No dimming, no weight penalty. Same as current behavior.

- **Nested `.gitignore` files:** Handled by git itself — `git ls-files` respects
  all `.gitignore` files in the hierarchy.

- **Global gitignore (`~/.gitignore`):** Also handled by `--exclude-standard`.

- **File removed from `.gitignore`:** Next `refresh()` cycle rebuilds the sets
  from scratch. File immediately gets normal weight/styling.

- **Large repos:** `git ls-files --others --ignored --exclude-standard --directory`
  is fast because `--directory` avoids recursing into ignored directories.
  Same 10MB buffer as existing git commands.

---

## Testing

1. Create a test project with `.gitignore` containing `*.log`, `dist/`, `*.tmp`
2. Verify ignored files appear dimmed and at bottom of tree
3. Modify an ignored file → verify it gains heat and becomes visible/styled
4. Edit `.gitignore` to remove a pattern → verify files return to normal
5. Test in non-git directory → verify no change in behavior
6. Test with symlinked directories pointing to other repos
