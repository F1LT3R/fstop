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
- **⚡ Debounced Updates** — Smooth rendering even during rapid file changes

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


## 🎯 Git Status Symbols

| Symbol | Color | Meaning |
|--------|-------|---------|
| `✖` | 🔴 Red | Merge conflicts |
| `✚` | 🟡 Yellow | Unstaged changes |
| `●` | 🟢 Green | Staged for commit |
| `…` | 🟢 Green | Untracked (new to project) |
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
│   └── tree-state.mjs     # File tree state management
└── package.json
```

## 🎨 How It Works

1. **File Watcher** — Chokidar monitors the directory for changes
2. **Tree State** — Maintains a virtual file tree with event history
3. **Heat Scoring** — Calculates priority based on recency and event type
4. **Git Integration** — Fetches status via `git status --porcelain`
5. **Layout Engine** — Weight-based priority system adapts tree to terminal height
6. **Renderer** — Outputs ANSI-styled tree with in-place updates

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

