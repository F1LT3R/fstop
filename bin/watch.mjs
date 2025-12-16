#!/usr/bin/env node

// CLI entry point - wires together watcher, state, layout, and renderer

import { resolve } from 'path'
import { TreeState } from '../lib/tree-state.mjs'
import { FileWatcher, createDebouncedHandler } from '../lib/file-watcher.mjs'
import { generateLayout } from '../lib/layout.mjs'
import { createRenderer } from '../lib/renderer.mjs'
import { setupTerminal, onResize, getTerminalSize } from '../lib/terminal.mjs'
import { GitStatus } from '../lib/git-status.mjs'

/**
 * Parse command line arguments
 * @returns {object} Parsed options
 */
function parseArgs() {
	const args = process.argv.slice(2)
	const options = {
		path: '.',
		history: 4,
		ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
		interval: 100,
		ghostSteps: 3,
		git: true,
		breathe: 2000,
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
watchers - Live file watcher with adaptive tree visualization

Usage:
  node bin/watch.mjs [directory] [options]

Options:
  --history, -n <num>    Rolling history size (default: 4)
  --ignore, -i <glob>    Add glob pattern to ignore (can use multiple times)
  --interval <ms>        Debounce interval in ms (default: 100)
  --breathe, -b <ms>     Auto-refresh interval for heat decay (default: 2000)
  --ghost-steps <num>    Fade steps for deleted items (default: 3)
  --no-git               Disable git status indicators
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
	})
	
	// Initialize git status tracker (if enabled)
	let gitStatus = null
	if (options.git) {
		gitStatus = new GitStatus(watchPath)
		await gitStatus.init()
	}
	
	// Initialize renderer
	const renderer = createRenderer(watchPath)
	if (gitStatus) {
		renderer.setGitStatus(gitStatus)
	}
	
	// Setup terminal (hide cursor, handle cleanup)
	const cleanup = setupTerminal()
	
	// Render function
	const doRender = async () => {
		// Refresh git status before rendering (if enabled)
		if (gitStatus) {
			await gitStatus.refresh()
		}
		
		const layout = generateLayout(treeState, {
			terminalSize: getTerminalSize(),
			gitStatus,
		})
		renderer.render(layout, gitStatus)
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
		await doRender()
	}, options.interval)
	
	// Subscribe to watcher events
	watcher.on('change', handleChanges)
	
	watcher.on('error', (error) => {
		console.error('Watcher error:', error)
	})
	
	// Handle terminal resize
	onResize(async () => {
		await doRender()
	})
	
	// Ghost fade timer - advance ghost states periodically
	const ghostTimer = setInterval(async () => {
		const hadGhosts = treeState.ghosts.size > 0
		if (hadGhosts) {
			treeState.advanceGhosts(gitStatus)
			await doRender()
		}
	}, 1000)
	
	// Breathe timer - periodic refresh for heat decay visualization
	const breatheTimer = setInterval(async () => {
		await doRender()
	}, options.breathe)
	
	// Cleanup on exit
	const handleExit = () => {
		clearInterval(ghostTimer)
		clearInterval(breatheTimer)
		watcher.stop()
		cleanup()
	}
	
	process.on('SIGINT', handleExit)
	process.on('SIGTERM', handleExit)
	
	// Start watching
	try {
		const initialPaths = await watcher.start()
		
		// Build initial tree from discovered files
		for (const item of initialPaths) {
			treeState.setNode(item.path, item.type, null)
		}
		
		// Clear event info for initial files (they weren't "changed")
		for (const node of treeState.nodes.values()) {
			node.eventType = null
			node.eventTime = null
		}
		
		// Initial render
		await doRender()
		
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

