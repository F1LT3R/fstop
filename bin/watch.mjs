#!/usr/bin/env node

// CLI entry point - wires together watcher, state, layout, and renderer

import { resolve, dirname, extname, relative } from 'path'
import { createServer } from 'net'
import readline from 'readline'
import { exec, execSync, spawn } from 'child_process'
import { TreeState } from '../lib/tree-state.mjs'
import { FileWatcher, createDebouncedHandler } from '../lib/file-watcher.mjs'
import { generateLayout, LAYOUT_CONFIG } from '../lib/layout.mjs'
import { createRenderer } from '../lib/renderer.mjs'
import { setupTerminal, onResize, getTerminalSize, enableMouse, disableMouse } from '../lib/terminal.mjs'
import { GitStatus } from '../lib/git-status.mjs'
import { loadConfig } from '../lib/config.mjs'

// Interactive state
let cursorIndex = 0
let filterPattern = ''
let visibleLines = []
let dirty = true  // Dirty flag for change-driven rendering
const manualFolds = new Set()   // paths of manually folded dirs
const manualOpens = new Set()   // dirs forced open (overrides auto-collapse)
const hiddenDirs = new Set()    // paths of completely hidden dirs

// Markdown preview state
let mdPreviewCmd = null  // e.g. 'markserv' — set by --markdown-preview
let mdPreviewFlags = []  // extra flags from structured config
let mdPreviewProcess = null
let mdPreviewPort = null

// Mouse state - flag to suppress keypress events during mouse sequences
let mouseActive = false

// Built-in defaults (used when neither config nor CLI specifies a value)
const DEFAULTS = {
	path: '.',
	history: 4,
	ignore: [
		'**/node_modules/**',
		'**/.git/**',
		'**/localdata/**',        // Database data directories
		'**/.postgres/**',        // PostgreSQL data
		'**/.mysql/**',           // MySQL data
		'**/.cache/**',           // Cache directories
		'**/target/**',           // Rust/Java build output
		'**/dist/**',             // JS/TS build output
		'**/build/**',            // Generic build output
		'**/.next/**',            // Next.js
		'**/.nuxt/**',            // Nuxt
		'**/.output/**',          // Nitro/Nuxt output
		'**/.venv/**',            // Python virtualenv
		'**/__pycache__/**',      // Python bytecode
		'**/.tox/**',             // Python tox
		'**/coverage/**',         // Test coverage
		'**/.nyc_output/**',      // NYC coverage
		'**/.terraform/**',       // Terraform state
		'**/.pulumi/**',          // Pulumi state
		'**/.DS_Store',           // macOS metadata
	],
	interval: 100,
	ghostSteps: 3,
	git: true,
	breathe: 2000,
	quick: false,
	skipLoopCheck: true,
	mdPreview: null,
}

/**
 * Parse command line arguments into a sparse object of only explicitly-set flags.
 * @returns {object} Only the options the user actually typed on the CLI
 */
function parseArgs() {
	const args = process.argv.slice(2)
	const cli = {}

	let i = 0
	while (i < args.length) {
		const arg = args[i]

		if (arg === '--history' || arg === '-n') {
			cli.history = parseInt(args[++i], 10) || 4
		} else if (arg === '--ignore' || arg === '-i') {
			cli.ignore = cli.ignore || []
			cli.ignore.push(args[++i])
		} else if (arg === '--interval') {
			cli.interval = parseInt(args[++i], 10) || 100
		} else if (arg === '--ghost-steps') {
			cli.ghostSteps = parseInt(args[++i], 10) || 3
		} else if (arg === '--no-git') {
			cli.git = false
		} else if (arg === '--breathe' || arg === '-b') {
			cli.breathe = parseInt(args[++i], 10) || 2000
		} else if (arg === '--quick' || arg === '-q') {
			cli.quick = true
		} else if (arg === '--markdown-preview') {
			cli.mdPreview = args[++i]
		} else if (arg === '--loopcheck') {
			cli.skipLoopCheck = false
		} else if (arg === '--help' || arg === '-h') {
			printHelp()
			process.exit(0)
		} else if (!arg.startsWith('-')) {
			cli.path = arg
		}

		i++
	}

	return cli
}

/**
 * Print help message
 */
function printHelp() {
	console.log(`
fstop - Live filesystem monitor with heat decay and adaptive tree display

Usage:
  node bin/watch.mjs [directory] [options]

Options:
  --history, -n <num>    Rolling history size (default: 4)
  --ignore, -i <glob>    Add glob pattern to ignore (can use multiple times)
  --interval <ms>        Debounce interval in ms (default: 100)
  --breathe, -b <ms>     Auto-refresh interval for heat decay (default: 2000)
  --ghost-steps <num>    Fade steps for deleted items (default: 3)
  --no-git               Disable git status indicators
  --quick, -q            Render once and exit (no watching)
  --markdown-preview <cmd>  Preview .md files with <cmd> (e.g. markserv)
                             Config: { "command": "<cmd>", "flags": [...] }
  --loopcheck            Enable symlink loop detection (slower startup, safer)
  --help, -h             Show this help message

Git Status Symbols:
  ✖  Conflicts (red)
  ✚  Unstaged changes (yellow)
  ●  Staged (green)
  …  Untracked (gray)
  ⇅  Ahead and behind (magenta)
  ↑  Ahead (cyan)
  ↓  Behind (red)

Config Files:
  ~/.config/fstop/config.json   Global defaults
  .fstop.json                   Per-project overrides (in project root)
  CLI flags override config. Config keys: markdownPreview, history,
  ignore, interval, breathe, ghostSteps, git, loopcheck.

Examples:
  node bin/watch.mjs .
  node bin/watch.mjs ./src --history 6
  node bin/watch.mjs ./project -i "*.log" -i "**/temp/**"
`)
}

/**
 * Main application
 */
async function main() {
	const cli = parseArgs()
	const watchPath = resolve(cli.path || DEFAULTS.path)

	// Load config files and merge: defaults < global config < project config < CLI
	const config = loadConfig(watchPath)

	// Config uses "markdownPreview" key, map to internal "mdPreview"
	if (config.markdownPreview !== undefined) {
		config.mdPreview = config.markdownPreview
		delete config.markdownPreview
	}
	// Config uses "loopcheck" (boolean), map to internal "skipLoopCheck" (inverted)
	if (config.loopcheck !== undefined) {
		config.skipLoopCheck = !config.loopcheck
		delete config.loopcheck
	}

	// Merge: ignore is additive across all layers
	const cliIgnore = cli.ignore || []
	const configIgnore = config.ignore || []
	delete cli.ignore
	delete config.ignore

	const options = { ...DEFAULTS, ...config, ...cli }
	options.ignore = [...DEFAULTS.ignore, ...configIgnore, ...cliIgnore]

	// Store markdown preview command if provided
	if (options.mdPreview) {
		if (typeof options.mdPreview === 'object') {
			mdPreviewCmd = options.mdPreview.command
			mdPreviewFlags = options.mdPreview.flags || []
		} else {
			mdPreviewCmd = options.mdPreview
		}
	}

	// Initialize tree state
	const treeState = new TreeState(watchPath, {
		historyLimit: options.history,
		ghostFadeSteps: options.ghostSteps,
	})
	
	// Initialize file watcher
	const watcher = new FileWatcher(watchPath, {
		ignored: options.ignore,
		skipLoopCheck: options.skipLoopCheck,
	})
	
	// Initialize git status tracker (if enabled)
	// Note: We'll discover git roots after initial tree build
	let gitStatus = null
	const gitEnabled = options.git
	
	// Initialize renderer
	const renderer = createRenderer(watchPath)
	if (gitEnabled) {
		renderer.setGitStatus(gitStatus)
	}
	
	// Setup terminal (hide cursor, handle cleanup) - skip in quick mode
	let cleanup = () => {}
	let handleExit = () => {}
	if (!options.quick) {
		cleanup = setupTerminal()

		// Enable mouse tracking (for clicks, toggles, Ctrl+click hide)
		enableMouse()
		const baseCleanup = cleanup
		cleanup = () => { disableMouse(); baseCleanup() }

		// Handle mouse clicks (SGR protocol) - register before readline
		// so we can set mouseActive flag before keypress events fire
		process.stdin.on('data', async (data) => {
			const str = data.toString()
			// Suppress ALL SGR mouse data (press, release, scroll, partial sequences)
			// to prevent escape bytes leaking into readline as arrow characters
			if (!str.includes('\x1b[<')) return
			mouseActive = true
			setTimeout(() => { mouseActive = false }, 0)

			const match = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/)
			if (!match) return

			const button = parseInt(match[1])
			const col = parseInt(match[2])
			const row = parseInt(match[3])
			const isPress = match[4] === 'M'

			// Left click, Shift+left, or Ctrl+left press only
			const isShift = button === 4
			const isCtrl = button === 16
			if ((button !== 0 && button !== 4 && button !== 16) || !isPress) return

			const lineIndex = row - LAYOUT_CONFIG.headerRows - 1
			if (lineIndex < 0 || lineIndex >= visibleLines.length) return

			const line = visibleLines[lineIndex]
			const node = line?.node
			if (!node) return

			// Shift+click or Ctrl+click on directory: hide it entirely
			if ((isShift || isCtrl) && node.type === 'directory') {
				hiddenDirs.add(node.path)
				dirty = true
				await doRender()
				return
			}

			// Calculate where the clickable filename ends
			const prefixLen = node.depth > 0 ? ((node.parentContinues?.length || 0) * 2 + 2) : 0
			const nodeGit = gitStatus ? GitStatus.getStatusForPath(node.path, node.realPath, node.type) : null
			const gitLen = nodeGit ? 2 : 0
			let nameLen = node.name.length
			if (node.type === 'directory') nameLen += 1
			const clickableEnd = prefixLen + gitLen + nameLen

			// Toggle indicator zone (directories only)
			if (node.type === 'directory' && node.depth > 0) {
				const toggleStart = clickableEnd + 1
				const toggleEnd = toggleStart + 3
				if (col > clickableEnd && col <= toggleEnd) {
					if (manualFolds.has(node.path)) {
						manualFolds.delete(node.path)
						manualOpens.add(node.path)
					} else {
						manualFolds.add(node.path)
						manualOpens.delete(node.path)
					}
					dirty = true
					await doRender()
					return
				}
			}

			// Only open if click is on the filename, not trailing empty space
			if (col <= clickableEnd) {
				cursorIndex = lineIndex
				openSelected()
				dirty = true
				await doRender()
			}
		})

		// Enable raw mode for keypresses
		readline.emitKeypressEvents(process.stdin)
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true)
		}
	}
	
	/**
	 * Open selected file/directory
	 */
	function openSelected() {
		const line = visibleLines[cursorIndex]
		if (!line) return

		const path = line.node?.path
		if (!path) return

		// Markdown files: use preview command if configured
		if (mdPreviewCmd && extname(path).toLowerCase() === '.md') {
			openMdPreview(path)
			return
		}

		// macOS: open, Linux: xdg-open
		const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
		exec(`${cmd} "${path}"`, (err) => {
			// Silently ignore errors
		})
	}

	/**
	 * Get a free port by binding to port 0 and reading the assigned port.
	 */
	function getFreePort() {
		return new Promise((resolve, reject) => {
			const srv = createServer()
			srv.listen(0, () => {
				const port = srv.address().port
				srv.close(() => resolve(port))
			})
			srv.on('error', reject)
		})
	}

	/**
	 * Open a markdown file with the configured preview command.
	 * Spawns a single markserv instance for the project on first call,
	 * then opens specific file URLs in the browser.
	 */
	async function openMdPreview(filePath) {
		// First call: spawn markserv once for the whole project
		if (!mdPreviewProcess) {
			mdPreviewPort = await getFreePort()
			mdPreviewProcess = spawn(mdPreviewCmd, [...mdPreviewFlags, watchPath, '--port', String(mdPreviewPort), '--browser', 'false'], {
				cwd: watchPath,
				stdio: 'ignore',
				detached: false,
			})
			mdPreviewProcess.on('error', () => { mdPreviewProcess = null; mdPreviewPort = null })
			mdPreviewProcess.on('exit', () => { mdPreviewProcess = null; mdPreviewPort = null })
		}

		// Open the specific file URL in the browser
		const relPath = relative(watchPath, filePath)
		const url = `http://localhost:${mdPreviewPort}/${relPath}`
		const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
		exec(`${opener} "${url}"`)
	}
	
	/**
	 * Move cursor up or down
	 */
	function moveCursor(delta) {
		const maxIndex = Math.max(0, visibleLines.length - 1)
		cursorIndex = Math.max(0, Math.min(maxIndex, cursorIndex + delta))
	}
	
	
	// Keypress handler (only in interactive mode)
	if (!options.quick) {
		process.stdin.on('keypress', async (str, key) => {
		if (!key) return

		// Ignore characters from mouse sequences (handled by data listener)
		if (mouseActive) return

		// Ctrl+C to exit
		if (key.name === 'c' && key.ctrl) {
			handleExit()
			return
		}
		
		// Ctrl+Up: fold directory at cursor
		if (key.name === 'up' && key.ctrl) {
			const line = visibleLines[cursorIndex]
			if (line?.node?.type === 'directory') {
				manualFolds.add(line.node.path)
				manualOpens.delete(line.node.path)
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
				manualOpens.add(line.node.path)
			}
			dirty = true
			await doRender()
			return
		}

		// Cursor navigation (ALWAYS active, even during filter)
		if (key.name === 'up') {
			moveCursor(-1)
			dirty = true
			await doRender()
			return
		}
		if (key.name === 'down') {
			moveCursor(1)
			dirty = true
			await doRender()
			return
		}
		
	// Enter to open selected
	if (key.name === 'return') {
		openSelected()
		dirty = true
		await doRender()
		return
	}
	
	// Escape to clear filter + folds + hides + ghosts
	if (key.name === 'escape') {
		filterPattern = ''
		manualFolds.clear()
		manualOpens.clear()
		hiddenDirs.clear()
		treeState.clearGhosts()
		cursorIndex = 0
		dirty = true
		await doRender()
		return
	}
	
	// Backspace to remove filter character (always listening)
	if (key.name === 'backspace') {
		filterPattern = filterPattern.slice(0, -1)
		cursorIndex = 0  // Jump to first match
		dirty = true
		await doRender()
		return
	}
	
	// Typing adds to filter (always listening)
	if (str && str.length === 1 && !key.ctrl && !key.meta) {
		filterPattern += str
		cursorIndex = 0  // Jump to first match
		dirty = true
		await doRender()
		return
	}
		
		// j/k navigation only when NOT in filter mode
		if (str === 'k') {
			moveCursor(-1)
			dirty = true
			await doRender()
			return
		}
		if (str === 'j') {
			moveCursor(1)
			dirty = true
			await doRender()
			return
		}
	})
	}
	
	// Render function
	const doRender = async () => {
		// Early exit if nothing changed
		if (!dirty) {
			return
		}
		
		// Refresh git status before rendering (if enabled)
		// Git status changes can also set dirty flag
		if (gitStatus) {
			const gitChanged = await GitStatus.refreshAll()
			if (gitChanged) {
				dirty = true
			}
		}
		
		const layout = generateLayout(treeState, {
			terminalSize: getTerminalSize(),
			gitStatus,
			filterPattern,
			manualFolds,
			manualOpens,
			hiddenDirs,
		})
		
		// Store visible lines for cursor navigation
		visibleLines = layout.lines || []
		
		// Auto-jump to single match (fzf-style)
		if (filterPattern) {
			const matchingLines = visibleLines.filter(l => l.filterMatch && l.lineType === 'node')
			if (matchingLines.length === 1) {
				cursorIndex = visibleLines.indexOf(matchingLines[0])
			}
		}
		
		// Clamp cursor to valid range
		if (cursorIndex >= visibleLines.length) {
			cursorIndex = Math.max(0, visibleLines.length - 1)
		}
		
	renderer.render(layout, gitStatus, {
		cursorIndex,
		filterPattern,
		quick: options.quick,
		mdPreview: !!mdPreviewCmd,
	})
	
	// Clear dirty flag after successful render
	dirty = false
	}
	
	// Handle file change events (debounced)
	const handleChanges = createDebouncedHandler(async (events) => {
		for (const event of events) {
			if (event.eventType === 'unlink' || event.eventType === 'unlinkDir') {
				treeState.removeNode(event.path, event.eventType)
			} else {
				treeState.setNode(event.path, event.type, event.eventType)
			}

		}
		dirty = true
		await doRender()
	}, options.interval)
	
	// Interactive mode setup (watchers, timers, event handlers)
	if (!options.quick) {
		// Subscribe to watcher events
		watcher.on('change', handleChanges)
		
		watcher.on('error', (error) => {
			// Silently skip permission-denied directories
			if (error.code === 'EACCES' || error.code === 'EPERM') {
				return
			}
			// Log other errors but continue running
			console.error('Watcher error:', error.message)
		})
		
		// Handle terminal resize
		onResize(async () => {
			dirty = true
			await doRender()
		})
		
		// Ghost fade timer - advance ghost states periodically
		const ghostTimer = setInterval(async () => {
			const hadGhosts = treeState.ghosts.size > 0
			if (hadGhosts) {
				treeState.advanceGhosts(gitStatus)
				dirty = true
				await doRender()
			}
		}, 1000)
		
		// Breathe timer - periodic refresh for heat decay and git status
		// Only render when items are hot or ghosts exist
		const breatheTimer = setInterval(async () => {
			if (treeState.hasHotItems() || treeState.ghosts.size > 0) {
				dirty = true
				await doRender()
			}
		}, options.breathe)
		
		// Cleanup on exit
		handleExit = () => {
			clearInterval(ghostTimer)
			clearInterval(breatheTimer)
			watcher.stop()
			if (mdPreviewProcess) {
				mdPreviewProcess.kill()
				mdPreviewProcess = null
				mdPreviewPort = null
			}
			cleanup()
			process.exit(0)
		}
		
		process.on('SIGINT', handleExit)
		process.on('SIGTERM', handleExit)
	}
	
	// Start watching
	try {
		const initialPaths = await watcher.start()
		
		// Build initial tree from discovered files
		for (const item of initialPaths) {
			treeState.setNode(item.path, item.type, null)
		}
		
		// Detect symlinks once (async, parallel)
		await treeState.detectSymlinks()
		
		// Discover git roots: main repo + symlinked paths (one-time)
		if (gitEnabled) {
			// Add the main watched directory to the cache
			const mainGit = await GitStatus.getForPath(watchPath)
			if (mainGit) {
				gitStatus = mainGit // Keep reference for renderer
			}
			
			// Track which symlink paths we've already checked
			const checkedPaths = new Set()
			
			// Collect all symlinked directories to check
			const symlinkedDirs = []
			for (const node of treeState.nodes.values()) {
				if (node.isSymlink && !checkedPaths.has(node.path)) {
					checkedPaths.add(node.path)
					symlinkedDirs.push(node.path)
				}
			}
			
			// Discover git roots in parallel
			await Promise.all(
				symlinkedDirs.map(path => GitStatus.getForPath(path))
			)
		}
		
		// Clear event info for initial files (they weren't "changed")
		for (const node of treeState.nodes.values()) {
			node.eventType = null
			node.eventTime = null
		}
		
		// Initial render (force dirty in case a debounced watcher event
		// already consumed it during async setup above)
		dirty = true
		await doRender()
		
		// Quick mode: exit after first render
		if (options.quick) {
			process.exit(0)
		}
		
	} catch (error) {
		cleanup()
		console.error('Failed to start watcher:', error)
		process.exit(1)
	}
}

// Run the app
main().catch((error) => {
	console.error('Fatal error:', error)
	process.exit(1)
})


