// File watcher - chokidar wrapper that emits normalized events

import chokidar from 'chokidar'
import { EventEmitter } from 'events'
import { resolve, relative } from 'path'
import { stat } from 'fs/promises'

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
				'**/dist/**',
				'**/.DS_Store',
			],
			ignoreInitial: false,
			persistent: true,
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

