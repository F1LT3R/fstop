# 🔥 Watchers

A mesmerizing terminal visualization that brings your file system to life. Watch files pulse with heat as they change, see git status at a glance, and experience your codebase breathing in real-time.

```
watching: /Users/dev/myproject  3↑

myproject/
├── src/
│   ├── ✚ App.tsx                                    MODIFIED 2s █████░ 78%
│   ├── ✚ components/
│   │   └── ● Button.tsx                             CREATED 8s ███░░░ 45%
│   ├── utils/
│   │   └── helpers.ts
│   └── index.ts
├── … package.json
└── README.md

●2 ✚3 …1
```

## ✨ Features

- **🌡️ Heat Visualization** — Recently changed files glow hot with color-coded heat bars that decay over time
- **🎨 Git Status Integration** — Instantly see staged, unstaged, untracked, and conflicted files with colored symbols
- **🌬️ Breathing Mode** — The tree auto-refreshes, showing heat decay in real-time like a living organism
- **📐 Space-Aware Layout** — Adapts to terminal size, collapsing cold branches when space is limited
- **👻 Ghost Mode** — Deleted files fade out gracefully over multiple frames
- **⚡ Debounced Updates** — Smooth rendering even during rapid file changes

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/watchers.git
cd watchers

# Install dependencies
npm install
```

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
| `…` | ⚪ Gray | Untracked files |
| `⇅` | 🟣 Magenta | Ahead and behind remote |
| `↑` | 🔵 Cyan | Ahead of remote |
| `↓` | 🔴 Red | Behind remote |

## 🌡️ Heat System

Files pulse with heat based on how recently they changed:

```
█████░  80%+  — Just changed (bright, bold)
████░░  60%   — Recent activity
███░░░  40%   — Cooling down
██░░░░  20%   — Getting cold
█░░░░░  <20%  — Cold (dims and may collapse)
```

Heat decays exponentially with a ~10 second half-life. The breathing timer keeps the visualization alive, smoothly updating heat bars as files cool down.

## 📁 Project Structure

```
watchers/
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
5. **Layout Engine** — Adapts tree to terminal height, collapsing cold branches
6. **Renderer** — Outputs ANSI-styled tree with in-place updates

## 🔮 Event Priority

When space is limited, watchers prioritizes showing:

1. **Deleted** items (highest priority — dramatic!)
2. **Created** items (something new appeared)
3. **Modified** items (content changed)
4. **Hot directories** (contain recent activity)

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

