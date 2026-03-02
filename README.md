<p align="center">
  <img src="assets/fstop-logo.png" alt="fstop logo" width="600">
</p>

# 🔥 fstop

A mesmerizing terminal visualization that brings your file system to life. Watch files heat decay as they change, see git status at a glance, and experience your codebase breathing in real-time.

```
watching: /Users/dev/myproject  ↑3

+ myproject/
├── + src/
│   ├── ✚ App.tsx                               MODIFIED 2s ██████░
│   ├── ✚ components/
│   │   └── ● Button.tsx                        CREATED 8s ████░░░
│   │       ⋮ +2 more
│   ├── utils/...
│   └── index.ts
├── … package.json
└── README.md

●2 ✚3 …1
```

## ✨ Features

- **🌡️ Heat Visualization** — 7-color thermal gradient (red→blue) shows recency at a glance
- **🎨 Git Status Integration** — Instantly see staged, unstaged, untracked, and conflicted files with colored symbols
- **🌬️ Breathing Mode** — The tree auto-refreshes, showing heat decay in real-time like a living organism
- **📐 Space-Aware Layout** — Adapts to terminal size, collapsing cold branches when space is limited
- **🔝 Priority Bubbling** — Hot files and git-status items bubble to the top, always visible
- **📊 Git-First Sorting** — Files with git status appear first within directories
- **👻 Smart Ghosts** — Tracked deleted files stay visible until committed; untracked fade naturally
- **⋮ Partial Collapse** — Shows `⋮ +N more` when some directory contents are hidden
- **🎚️ Additive Weights** — Granular, composable priority system for fine-tuned control
- **⌨️ Cursor Navigation** — Use arrow keys or j/k to navigate, Enter to open files
- **🔍 Filter Mode** — Press `/` to search (vim-style), matches highlighted with yellow background
- **🔗 Clickable Links** — Filenames are clickable in iTerm and compatible terminals (OSC 8)
- **⚡ Debounced Updates** — Smooth rendering even during rapid file changes
- **🔗 Symlink Support** — Follows symlinked directories, showing their contents live; detects and prevents loops

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/fstop.git
cd fstop

# Install dependencies
npm install
```

### Global Installation

```bash
# Link globally to use from anywhere
npm link

# Now you can use it in any directory
cd ~/any-project
fstop .
```

To unlink: `npm unlink -g fstop`

## 🚀 Usage

```bash
# Watch current directory
node bin/watch.mjs .

# Watch a specific directory
node bin/watch.mjs ./src

# Watch with more history slots
node bin/watch.mjs . --history 8

# Faster breathing (500ms refresh)
node bin/watch.mjs . --breathe 500
```

## ⚙️ Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--history` | `-n` | `4` | Number of recent changes to keep hot |
| `--breathe` | `-b` | `2000` | Auto-refresh interval in ms |
| `--interval` | | `100` | Debounce interval for file changes |
| `--ignore` | `-i` | | Add glob patterns to ignore |
| `--ghost-steps` | | `3` | Fade steps for deleted items |
| `--no-git` | | | Disable git status indicators |
| `--quick` | `-q` | | Render once and exit (no watching) |
| `--markdown-preview` | | | Preview `.md` files with a command (e.g. `markserv`) |
| `--loopcheck` | | | Enable symlink loop detection (slower startup, safer) |

## 📝 Config Files

fstop loads defaults from config files so you don't have to repeat CLI flags:

| File | Scope |
|------|-------|
| `~/.config/fstop/config.json` | Global defaults |
| `.fstop.json` | Per-project overrides (in project root) |

CLI flags override config. Config keys use camelCase versions of flag names: `history`, `ignore`, `interval`, `breathe`, `ghostSteps`, `git`, `loopcheck`, `markdownPreview`.

### Markdown Preview Config

The `markdownPreview` key accepts either a plain command string or a structured object with extra flags. Works great with [markserv](https://github.com/F1LT3R/markserv):

```json
{
  "markdownPreview": {
    "command": "markserv",
    "flags": ["--theme", "solarized"]
  }
}
```

The `flags` array is passed to the command before fstop's own arguments.

## ⌨️ Keyboard Controls

fstop is fully interactive:

| Key | Action |
|-----|--------|
| `↑` / `k` | Move cursor up |
| `↓` / `j` | Move cursor down |
| `Enter` | Open selected file/directory |
| Any character | Start/continue filtering |
| `Backspace` | Remove last filter character |
| `Esc` | Clear filter |
| `Ctrl+C` | Quit |

### Filter Mode

Just start typing to filter and highlight matching files:

```
├── ✚ [lay]out.mjs        <- "lay" highlighted
├── renderer.mjs
└── terminal.mjs

/lay_
```

- Matching files get a weight boost (bubble to top)
- Matched substring shown with yellow background
- Cursor navigation works during filter
- `Enter` opens selected
- `Backspace` removes last filter character
- `Esc` clears filter

## 🎯 Git Status Symbols

| Symbol | Color | Meaning |
|--------|-------|---------|
| `✖` | 🔴 Red | Merge conflicts |
| `✚` | 🟡 Yellow | Unstaged changes |
| `●` | 🟢 Green | Staged for commit |
| `…` | ⚪ Gray | Untracked (new to project) |
| `⇅` | 🟣 Magenta | Ahead and behind remote |
| `↑` | 🔵 Cyan | Ahead of remote |
| `↓` | 🔴 Red | Behind remote |

## 🌡️ Heat System

Files pulse with a 7-segment thermal gradient from hot to cold:

```
███████  brightRed     — Just changed (< 1s)
██████░  red           — Hot
█████░░  magenta       — Warm  
████░░░  brightMagenta — Cooling
███░░░░  cyan          — Cool
██░░░░░  brightCyan    — Cold
█░░░░░░  blue          — Coldest
```

Heat decays exponentially with a ~10 second half-life. The breathing timer keeps the visualization alive, smoothly transitioning colors as files cool down.

**Note:** The heat bar color is always based on temperature, independent of git status. Filenames use git colors, bars use thermal colors.

## 📁 Project Structure

```
fstop/
├── bin/
│   └── watch.mjs          # CLI entry point
├── lib/
│   ├── file-watcher.mjs   # Chokidar wrapper
│   ├── git-status.mjs     # Git status parsing
│   ├── heat.mjs           # Heat scoring system
│   ├── layout.mjs         # Space-aware tree layout
│   ├── renderer.mjs       # ANSI terminal rendering
│   ├── terminal.mjs       # Terminal utilities
│   ├── tree-state.mjs     # File tree state management
│   └── config.mjs         # Config file loading
└── package.json
```

## 🎨 How It Works

1. **File Watcher** — Chokidar monitors the directory for changes (follows symlinked directories)
2. **Symlink Loop Detection** — Preflight check detects and prevents directory symlink cycles
3. **Tree State** — Maintains a virtual file tree with event history
4. **Heat Scoring** — Calculates priority based on recency and event type
5. **Git Integration** — Fetches status via `git status --porcelain`
6. **Layout Engine** — Weight-based priority system adapts tree to terminal height
7. **Renderer** — Outputs ANSI-styled tree with in-place updates

## 🎚️ Priority Weight System

When space is limited, fstop uses an **additive weight system** to decide what to show. Each line gets a score from multiple categories:

| Category | Options | Weights |
|----------|---------|---------|
| **Git** | conflict, unstaged, staged, untracked | 800, 700, 600, 500 |
| **Heat** | hot, cold | 350, 0 |
| **Type** | dir, file | 100, 50 |
| **Event** | deleted, created, modified | 150, 75, 50 |
| **Context** | hasChildren, inHistory, ghost | 200, 100, 50 |

**Example:** A hot unstaged file that was just modified:
- type.file (50) + git.unstaged (700) + heat.hot (350) + event.change (50) = **1150**

### Customizing Weights

Edit `lib/layout.mjs` to tune priorities:

```javascript
// Prioritize deletions above everything
WEIGHT.event.unlink = 900

// Heat-first workflow (over git)
WEIGHT.heat.hot = 800
WEIGHT.git.unstaged = 300
```

## 💡 Tips

- **Resize your terminal** to see the adaptive layout in action
- **Use `--breathe 500`** for faster, more responsive heat decay
- **Use `--history 8`** to track more simultaneous changes
- **Press `Ctrl+C`** to exit cleanly
- **Symlinked directories** are followed automatically; if you have symlink loops, fstop will exit with an error before starting

## 📁 What Gets Watched

By default, fstop ignores:
- `**/node_modules/**`
- `**/.git/**`
- `**/localdata/**`, `**/.postgres/**`, `**/.mysql/**` (database data)
- `**/.cache/**`

**Note:** `dist/` directories are **not** ignored by default. Use `--ignore "**/dist/**"` if you want to exclude them.

Symlinked directories are followed, including those pointing outside the watched root. If a symlink loop is detected, fstop will fail with a clear error message before starting the watcher.

## 🛠️ Requirements

- Node.js 18+
- A terminal with ANSI color support
- Git (optional, for git status features)

## 📄 License

MIT

---

<p align="center">
  <i>Watch your code breathe.</i>
</p>

