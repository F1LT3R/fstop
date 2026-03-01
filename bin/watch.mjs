#!/usr/bin/env node

// CLI entry point - wires together watcher, state, layout, and renderer

import { resolve, dirname } from 'path'
import readline from 'readline'
import { exec } from 'child_process'
import { TreeState } from '../lib/tree-state.mjs'
import { FileWatcher, createDebouncedHandler } from '../lib/file-watcher.mjs'
import { generateLayout } from '../lib/layout.mjs'
import { createRenderer } from '../lib/renderer.mjs'
import { setupTerminal, onResize, getTerminalSize } from '../lib/terminal.mjs'
import { GitStatus } from '../lib/git-status.mjs'

// Interactive state
let cursorIndex = 0
let filterPattern = ''
let visibleLines = []
let dirty = true  // Dirty flag for change-driven rendering

/**
 * Parse command line arguments
 * @returns {object} Parsed options
 */
function parseArgs() {
	const args = process.argv.slice(2)
	const options = {
		path: '.',
		history: 4,
		ignore: [
			'**/node_modules/**',
			'**/.git/**',
			'**/localdata/**',        // Database data directories
			'**/.postgres/**',        // PostgreSQL data
			'**/.mysql/**',           // MySQL data
			'**/.cache/**',           // Cache directories
		],
		interval: 100,
		ghostSteps: 3,
		git: true,
		breathe: 2000,
		quick: false,
		skipLoopCheck: true,
	}
	
	let i = 0
	while (i < args.length) {
		const arg = args[i]
		
		if (arg === '--history' || arg === '-n') {
			options.history = parseInt(args[++i], 10) || 4
		} else if (arg === '--ignore' || arg === '-i') {
			options.ignore.push(args[++i])
		} else if (arg === '--interval') {
			options.interval = parseInt(args[++i], 10) || 100
		} else if (arg === '--ghost-steps') {
			options.ghostSteps = parseInt(args[++i], 10) || 3
		} else if (arg === '--no-git') {
			options.git = false
		} else if (arg === '--breathe' || arg === '-b') {
			options.breathe = parseInt(args[++i], 10) || 2000
		} else if (arg === '--quick' || arg === '-q') {
			options.quick = true
		} else if (arg === '--loopcheck') {
			options.skipLoopCheck = false
		} else if (arg === '--help' || arg === '-h') {
			printHelp()
			process.exit(0)
		} else if (!arg.startsWith('-')) {
			options.path = arg
		}
		
		i++
	}
	
	return options
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
	const options = parseArgs()
	const watchPath = resolve(options.path)
	
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
		
		// macOS: open, Linux: xdg-open
		const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
		exec(`${cmd} "${path}"`, (err) => {
			// Silently ignore errors
		})
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
		
		// Ctrl+C to exit
		if (key.name === 'c' && key.ctrl) {
			handleExit()
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
	
	// Escape to clear filter
	if (key.name === 'escape') {
		filterPattern = ''
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
		
		// Initial render
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


