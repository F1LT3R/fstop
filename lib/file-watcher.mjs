// File watcher - chokidar wrapper that emits normalized events

import chokidar from 'chokidar'
import { EventEmitter } from 'events'
import { resolve, relative, join } from 'path'
import { stat, lstat, readdir, realpath } from 'fs/promises'
import micromatch from 'micromatch'

/**
 * Detect symlink loops by doing a DFS with cycle detection
 * @param {string} rootPath - Root path to start scanning
 * @param {string[]} ignorePatterns - Glob patterns to ignore
 * @throws {Error} If a symlink loop is detected
 */
async function detectSymlinkLoops(rootPath, ignorePatterns = []) {
	const inStack = new Set() // Realpaths currently in recursion stack
	const visited = new Set() // All realpaths we've seen (to avoid re-scanning)

	async function dfs(currentPath, pathForError) {
		// Check if this path matches any ignore patterns
		if (ignorePatterns.length > 0) {
			const rel = relative(rootPath, currentPath)
			if (rel && micromatch.isMatch(rel, ignorePatterns)) {
				return
			}
		}

		let stats
		try {
			stats = await lstat(currentPath)
		} catch (err) {
			// Permission denied, doesn't exist, etc. - skip silently
			return
		}

		// If it's a symlink, resolve it
		if (stats.isSymbolicLink()) {
			let target
			try {
				target = await realpath(currentPath)
			} catch (err) {
				// Broken symlink - skip
				return
			}

			// Check if the target is a directory
			let targetStats
			try {
				targetStats = await stat(target)
			} catch (err) {
				// Can't stat target - skip
				return
			}

			if (targetStats.isDirectory()) {
				// Check for cycle
				if (inStack.has(target)) {
					throw new Error(`Symlink loop detected: ${pathForError} -> ${target}`)
				}

				// If we've already visited this realpath in a different branch, skip
				if (visited.has(target)) {
					return
				}

				// Continue DFS from the target
				inStack.add(target)
				visited.add(target)
				try {
					await dfs(target, `${pathForError} -> ${target}`)
				} finally {
					inStack.delete(target)
				}
			}
			return
		}

		// If it's a regular directory, scan its children
		if (stats.isDirectory()) {
			const realCurrent = await realpath(currentPath)
			
			// Check for cycles (shouldn't happen with regular dirs, but be safe)
			if (inStack.has(realCurrent)) {
				return
			}

			if (visited.has(realCurrent)) {
				return
			}

			inStack.add(realCurrent)
			visited.add(realCurrent)
			
			try {
				let entries
				try {
					entries = await readdir(currentPath)
				} catch (err) {
					// Permission denied - skip
					return
				}

				for (const entry of entries) {
					await dfs(join(currentPath, entry), join(pathForError, entry))
				}
			} finally {
				inStack.delete(realCurrent)
			}
		}
	}

	await dfs(rootPath, rootPath)
}

/**
 * FileWatcher - wraps chokidar and normalizes events
 */

export class FileWatcher extends EventEmitter {
	constructor(targetPath, options = {}) {
		super()
		
		this.targetPath = resolve(targetPath)
		this.options = {
			ignored: options.ignored || [
				'**/node_modules/**',
				'**/.git/**',
				'**/.DS_Store',
			],
			ignoreInitial: false,
			persistent: true,
			followSymlinks: true,  // Follow symlinked directories
			ignorePermissionErrors: true,  // Skip directories with permission errors
			awaitWriteFinish: {
				stabilityThreshold: 100,
				pollInterval: 50,
			},
			...options,
		}
		
		this.watcher = null
		this.ready = false
		this.initialPaths = []
	}
	
	/**
	 * Start watching the target path
	 * @returns {Promise} Resolves when initial scan is complete
	 */
	async start() {
		// Detect symlink loops before starting the watcher (only if requested)
		if (!this.options.skipLoopCheck) {
			try {
				await detectSymlinkLoops(this.targetPath, this.options.ignored)
			} catch (err) {
				throw new Error(`Cannot start watcher: ${err.message}`)
			}
		}

		return new Promise((resolve, reject) => {
			this.watcher = chokidar.watch(this.targetPath, this.options)
			
			// Collect initial paths during startup
			const collectInitial = (path, stats) => {
				if (!this.ready) {
					this.initialPaths.push({
						path,
						type: stats?.isDirectory() ? 'directory' : 'file',
					})
				}
			}
			
			this.watcher
				.on('add', (path, stats) => {
					if (this.ready) {
						this.emitEvent('add', path, 'file')
					} else {
						collectInitial(path, stats)
					}
				})
				.on('addDir', (path, stats) => {
					if (this.ready) {
						this.emitEvent('addDir', path, 'directory')
					} else {
						collectInitial(path, { isDirectory: () => true })
					}
				})
				.on('change', (path) => {
					this.emitEvent('change', path, 'file')
				})
				.on('unlink', (path) => {
					this.emitEvent('unlink', path, 'file')
				})
				.on('unlinkDir', (path) => {
					this.emitEvent('unlinkDir', path, 'directory')
				})
				.on('error', (error) => {
					this.emit('error', error)
					if (!this.ready) {
						reject(error)
					}
				})
				.on('ready', () => {
					this.ready = true
					this.emit('ready', this.initialPaths)
					resolve(this.initialPaths)
				})
		})
	}
	
	/**
	 * Emit a normalized file event
	 * @param {string} eventType - Event type
	 * @param {string} path - Full file path
	 * @param {string} type - 'file' or 'directory'
	 */
	emitEvent(eventType, path, type) {
		const event = {
			eventType,
			path,
			type,
			relativePath: relative(this.targetPath, path),
			timestamp: Date.now(),
		}
		
		this.emit('change', event)
		this.emit(eventType, event)
	}
	
	/**
	 * Stop watching
	 */
	async stop() {
		if (this.watcher) {
			await this.watcher.close()
			this.watcher = null
			this.ready = false
		}
	}
	
	/**
	 * Get watched paths
	 * @returns {object} Object with watched paths
	 */
	getWatched() {
		if (!this.watcher) return {}
		return this.watcher.getWatched()
	}
}

/**
 * Create a debounced event handler
 * Groups rapid events together to reduce re-renders
 * @param {function} handler - Function to call with batched events
 * @param {number} delay - Debounce delay in ms
 * @returns {function} Debounced handler
 */
export function createDebouncedHandler(handler, delay = 100) {
	let timeout = null
	let batch = []
	
	return (event) => {
		batch.push(event)
		
		if (timeout) {
			clearTimeout(timeout)
		}
		
		timeout = setTimeout(() => {
			const events = batch
			batch = []
			timeout = null
			handler(events)
		}, delay)
	}
}

