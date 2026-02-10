// Git status module - parse git status and ahead/behind into status symbols

import { exec } from 'child_process'
import { promisify } from 'util'
import { relative, dirname } from 'path'

const execAsync = promisify(exec)

// Static caches for multi-repo support
const gitStatusCache = new Map()  // gitRoot -> GitStatus instance
const pathToRootCache = new Map() // path -> gitRoot (permanent cache)

/**
 * Git status symbols with their meanings
 */
export const GIT_SYMBOLS = {
	conflict: '✖',
	unstaged: '✚',
	staged: '●',
	untracked: '…',
	bothModified: '⇅',
	ahead: '↑',
	behind: '↓',
}

/**
 * Git status colors (matching terminal.mjs color names)
 */
export const GIT_COLORS = {
	conflict: 'brightRed',
	unstaged: 'brightYellow',
	staged: 'brightGreen',
	untracked: 'green',
	bothModified: 'brightMagenta',
	ahead: 'brightCyan',
	behind: 'brightRed',
}

/**
 * GitStatus class - tracks git status for files in a directory
 */
export class GitStatus {
	constructor(rootPath) {
		this.rootPath = rootPath
		this.gitRoot = null
		this.fileStatus = new Map()  // path -> { symbol, color, status }
		this.dirStatus = new Map()   // dir path -> aggregated status
		this.ahead = 0
		this.behind = 0
		this.isGitRepo = false
		this.lastUpdate = 0
		this.cacheTTL = 1000  // 1 second cache
	}

	/**
	 * Get or create GitStatus instance for a path (static method)
	 * Discovers git root, caches it permanently, and returns appropriate GitStatus
	 * @param {string} path - Path to check for git repo
	 * @returns {Promise<GitStatus|null>} GitStatus instance or null if not in a repo
	 */
	static async getForPath(path) {
		// Check cache first
		if (pathToRootCache.has(path)) {
			const gitRoot = pathToRootCache.get(path)
			return gitRoot ? gitStatusCache.get(gitRoot) : null
		}
		
		// Discover git root for this path (only once)
		let gitRoot = null
		try {
			const { stdout } = await execAsync('git rev-parse --show-toplevel', {
				cwd: path,  // Use path itself, not dirname - works for both files and dirs
			})
			gitRoot = stdout.trim()
		} catch {
			// Not in a git repo, or path doesn't exist - try parent
			try {
				const { stdout } = await execAsync('git rev-parse --show-toplevel', {
					cwd: dirname(path),
				})
				gitRoot = stdout.trim()
			} catch {
				// Still not in a git repo
			}
		}
		
		// Cache the result permanently
		pathToRootCache.set(path, gitRoot)
		
		if (!gitRoot) {
			return null
		}
		
		// Get or create GitStatus instance for this repo
		// Important: GitStatus must be created with the actual git root, not the search path
		if (!gitStatusCache.has(gitRoot)) {
			const gitStatus = new GitStatus(gitRoot)
			// init() will discover and confirm the git root
			const success = await gitStatus.init()
			if (success) {
				gitStatusCache.set(gitRoot, gitStatus)
			} else {
				return null
			}
		}
		
		return gitStatusCache.get(gitRoot)
	}

	/**
	 * Get GitStatus for a path
	 * Uses cached data, so must be called after getForPath has been called for that path
	 * @param {string} path - Path to look up
	 * @param {string} realPath - Real path if symlink (kept for compatibility, not used)
	 * @param {string} type - 'file' or 'directory'
	 * @returns {object|null} Status object or null
	 */
	static getStatusForPath(path, realPath, type) {
		// Find the MOST SPECIFIC (longest) git root for this path
		// Git naturally handles symlinks, so we just use the path as-is
		let bestMatchGitStatus = null
		let bestMatchLength = 0
		
		for (const [gitRoot, gitStatus] of gitStatusCache.entries()) {
			// Check if path is under this git root
			if (path === gitRoot || path.startsWith(gitRoot + '/')) {
				if (gitRoot.length > bestMatchLength) {
					bestMatchGitStatus = gitStatus
					bestMatchLength = gitRoot.length
				}
			}
		}
		
		if (!bestMatchGitStatus) return null
		
		// Cache for faster future lookups
		if (bestMatchGitStatus.gitRoot) {
			pathToRootCache.set(path, bestMatchGitStatus.gitRoot)
		}
		
		// Simple lookup - git output already has correct paths
		return bestMatchGitStatus.getStatus(path, type)
	}

	/**
	 * Refresh all cached git repos
	 * @param {boolean} force - Force refresh ignoring cache
	 * @returns {Promise<boolean>} True if any git status changed
	 */
	static async refreshAll(force = false) {
		const promises = []
		for (const gitStatus of gitStatusCache.values()) {
			promises.push(gitStatus.refresh(force))
		}
		const results = await Promise.all(promises)
		// Return true if any repo had changes
		return results.some(changed => changed)
	}

	/**
	 * Find the git root directory
	 * @returns {Promise<string|null>}
	 */
	async findGitRoot() {
		try {
			const { stdout } = await execAsync('git rev-parse --show-toplevel', {
				cwd: this.rootPath,
			})
			return stdout.trim()
		} catch {
			return null
		}
	}

	/**
	 * Initialize - check if in a git repo
	 * @returns {Promise<boolean>}
	 */
	async init() {
		this.gitRoot = await this.findGitRoot()
		this.isGitRepo = this.gitRoot !== null
		if (this.isGitRepo) {
			await this.refresh()
		}
		return this.isGitRepo
	}

	/**
	 * Refresh git status (with caching)
	 * @param {boolean} force - Force refresh ignoring cache
	 * @returns {Promise<boolean>} True if status changed
	 */
	async refresh(force = false) {
		if (!this.isGitRepo) return false

		const now = Date.now()
		if (!force && now - this.lastUpdate < this.cacheTTL) {
			return false
		}

		this.lastUpdate = now

		// Store old state for comparison
		const oldFileStatusSize = this.fileStatus.size
		const oldAhead = this.ahead
		const oldBehind = this.behind
		const oldFileStatusKeys = new Set(this.fileStatus.keys())

		// Fetch into temporary maps to avoid clearing during async operations
		const newFileStatus = new Map()
		const [, aheadBehind] = await Promise.all([
			this.fetchFileStatusInto(newFileStatus),
			this.fetchAheadBehindValues(),
		])

		// Check if anything changed
		let changed = false
		
		// Check ahead/behind changes
		if (aheadBehind.ahead !== oldAhead || aheadBehind.behind !== oldBehind) {
			changed = true
		}
		
		// Check file status changes (size or keys)
		if (newFileStatus.size !== oldFileStatusSize) {
			changed = true
		} else {
			// Same size, check if keys are different
			for (const key of newFileStatus.keys()) {
				if (!oldFileStatusKeys.has(key)) {
					changed = true
					break
				}
			}
			// Also check if any old keys are missing
			if (!changed) {
				for (const key of oldFileStatusKeys) {
					if (!newFileStatus.has(key)) {
						changed = true
						break
					}
				}
			}
		}

		// Atomically swap in the new data
		this.fileStatus = newFileStatus
		this.ahead = aheadBehind.ahead
		this.behind = aheadBehind.behind

		// Rebuild directory status from new file status
		this.dirStatus.clear()
		this.aggregateDirStatus()
		
		return changed
	}

	/**
	 * Fetch file-level git status into a provided map
	 * @param {Map} targetMap - Map to populate with file statuses
	 */
	async fetchFileStatusInto(targetMap) {
		try {
			const { stdout } = await execAsync('git status --porcelain=v1', {
				cwd: this.rootPath,
				maxBuffer: 10 * 1024 * 1024,  // 10MB buffer for large repos
			})

			for (const line of stdout.split('\n')) {
				if (!line) continue

				const indexStatus = line[0]
				const workTreeStatus = line[1]
				const filePath = line.slice(3)

				// Handle renamed files (format: "R  old -> new")
				const actualPath = filePath.includes(' -> ')
					? filePath.split(' -> ')[1]
					: filePath

				const fullPath = this.rootPath + '/' + actualPath
				const status = this.parseStatus(indexStatus, workTreeStatus)

				if (status) {
					targetMap.set(fullPath, status)
				}
			}
		} catch (error) {
			// Silently fail - might not be a git repo or git not installed
		}
	}

	/**
	 * Parse git status codes into symbol and color
	 * @param {string} index - Index (staged) status character
	 * @param {string} workTree - Work tree (unstaged) status character
	 * @returns {object|null} Status object with symbol and color
	 */
	parseStatus(index, workTree) {
		// Conflict states
		if (index === 'U' || workTree === 'U' || (index === 'A' && workTree === 'A') || (index === 'D' && workTree === 'D')) {
			return {
				symbol: GIT_SYMBOLS.conflict,
				color: GIT_COLORS.conflict,
				status: 'conflict',
			}
		}

		// Untracked
		if (index === '?' && workTree === '?') {
			return {
				symbol: GIT_SYMBOLS.untracked,
				color: GIT_COLORS.untracked,
				status: 'untracked',
			}
		}

		// Both staged and unstaged changes
		if (index !== ' ' && index !== '?' && workTree !== ' ' && workTree !== '?') {
			return {
				symbol: GIT_SYMBOLS.unstaged,  // Show unstaged as priority
				color: GIT_COLORS.unstaged,
				status: 'both',
			}
		}

		// Unstaged changes only
		if (workTree !== ' ' && workTree !== '?') {
			return {
				symbol: GIT_SYMBOLS.unstaged,
				color: GIT_COLORS.unstaged,
				status: 'unstaged',
			}
		}

		// Staged changes only
		if (index !== ' ' && index !== '?') {
			return {
				symbol: GIT_SYMBOLS.staged,
				color: GIT_COLORS.staged,
				status: 'staged',
			}
		}

		return null
	}

	/**
	 * Fetch ahead/behind count relative to upstream
	 */
	/**
	 * Fetch ahead/behind count and return values
	 * @returns {object} { ahead, behind }
	 */
	async fetchAheadBehindValues() {
		try {
			const { stdout } = await execAsync(
				'git rev-list --left-right --count HEAD...@{upstream}',
				{ cwd: this.rootPath }
			)

			const [ahead, behind] = stdout.trim().split('\t').map(Number)
			return { ahead: ahead || 0, behind: behind || 0 }
		} catch {
			// No upstream configured or other error
			return { ahead: 0, behind: 0 }
		}
	}

	/**
	 * Aggregate file status up to parent directories
	 */
	aggregateDirStatus() {
		for (const [filePath, status] of this.fileStatus) {
			// If this is an untracked directory (path itself, not just containing files),
			// add it directly to dirStatus
			if (status.status === 'untracked' && filePath.endsWith('/')) {
				const dirPath = filePath.slice(0, -1) // Remove trailing slash
				this.dirStatus.set(dirPath, { ...status })
			}
			
			let dir = dirname(filePath)

			while (dir.length >= this.rootPath.length) {
				const existing = this.dirStatus.get(dir)

				if (!existing || this.statusPriority(status.status) > this.statusPriority(existing.status)) {
					this.dirStatus.set(dir, { ...status })
				}

				if (dir === this.rootPath) break
				dir = dirname(dir)
			}
		}
	}

	/**
	 * Get priority of a status (higher = more important to show)
	 * @param {string} status - Status name
	 * @returns {number} Priority value
	 */
	statusPriority(status) {
		const priorities = {
			conflict: 5,
			unstaged: 4,
			both: 3,
			staged: 2,
			untracked: 1,
		}
		return priorities[status] || 0
	}

	/**
	 * Get status for a specific path (file or directory)
	 * @param {string} path - Full path
	 * @param {string} type - 'file' or 'directory'
	 * @returns {object|null} Status object or null
	 */
	getStatus(path, type) {
		if (!this.isGitRepo) return null

		if (type === 'file') {
			return this.fileStatus.get(path) || null
		} else {
			return this.dirStatus.get(path) || null
		}
	}

	/**
	 * Get ahead/behind symbol and color
	 * @returns {object|null} Symbol info or null if neither ahead nor behind
	 */
	getAheadBehind() {
		if (!this.isGitRepo) return null

		if (this.ahead > 0 && this.behind > 0) {
			return {
				symbol: GIT_SYMBOLS.bothModified,
				color: GIT_COLORS.bothModified,
				text: `${this.ahead}↑ ${this.behind}↓`,
			}
		} else if (this.ahead > 0) {
			return {
				symbol: GIT_SYMBOLS.ahead,
				color: GIT_COLORS.ahead,
				text: `${this.ahead}↑`,
			}
		} else if (this.behind > 0) {
			return {
				symbol: GIT_SYMBOLS.behind,
				color: GIT_COLORS.behind,
				text: `${this.behind}↓`,
			}
		}

		return null
	}

	/**
	 * Check if any files have git status
	 * @returns {boolean}
	 */
	hasChanges() {
		return this.fileStatus.size > 0
	}

	/**
	 * Get count of files with each status type
	 * @returns {object} Counts by status
	 */
	getCounts() {
		const counts = {
			conflict: 0,
			unstaged: 0,
			staged: 0,
			untracked: 0,
		}

		for (const status of this.fileStatus.values()) {
			if (status.status === 'conflict') counts.conflict++
			else if (status.status === 'unstaged' || status.status === 'both') counts.unstaged++
			else if (status.status === 'staged') counts.staged++
			else if (status.status === 'untracked') counts.untracked++
		}

		return counts
	}
}

