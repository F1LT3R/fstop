// Git status module - parse git status and ahead/behind into status symbols

import { exec } from 'child_process'
import { promisify } from 'util'
import { relative, dirname } from 'path'

const execAsync = promisify(exec)

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
	untracked: 'gray',
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
	 */
	async refresh(force = false) {
		if (!this.isGitRepo) return

		const now = Date.now()
		if (!force && now - this.lastUpdate < this.cacheTTL) {
			return
		}

		this.lastUpdate = now

		// Fetch into temporary maps to avoid clearing during async operations
		const newFileStatus = new Map()
		const [, aheadBehind] = await Promise.all([
			this.fetchFileStatusInto(newFileStatus),
			this.fetchAheadBehindValues(),
		])

		// Atomically swap in the new data
		this.fileStatus = newFileStatus
		this.ahead = aheadBehind.ahead
		this.behind = aheadBehind.behind

		// Rebuild directory status from new file status
		this.dirStatus.clear()
		this.aggregateDirStatus()
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

