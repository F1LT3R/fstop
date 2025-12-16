// Tree state management - file tree structure, rolling history, ghost tracking

import { dirname, basename, relative, sep } from 'path'
import { calculateHeat, calculateDirHeat, isHot } from './heat.mjs'

/**
 * Create a new tree node
 * @param {string} path - Full path to file/directory
 * @param {string} type - 'file' or 'directory'
 * @returns {object} Node object
 */
function createNode(path, type) {
	return {
		path,
		name: basename(path),
		type,
		eventType: null,
		eventTime: null,
		children: new Map(),
		isGhost: false,
		ghostFadeStep: 0,
	}
}

/**
 * TreeState class - manages the file tree and change history
 */
export class TreeState {
	constructor(rootPath, options = {}) {
		this.rootPath = rootPath
		this.rootName = basename(rootPath) || rootPath
		this.historyLimit = options.historyLimit || 4
		this.ghostFadeSteps = options.ghostFadeSteps || 3
		
		// Root node
		this.root = createNode(rootPath, 'directory')
		
		// path -> node lookup for quick access
		this.nodes = new Map()
		this.nodes.set(rootPath, this.root)
		
		// Rolling history of recent changes
		this.history = []
		
		// Ghost nodes (recently deleted, fading out)
		this.ghosts = new Map()
	}
	
	/**
	 * Get relative path segments from root
	 * @param {string} fullPath - Full file path
	 * @returns {string[]} Array of path segments
	 */
	getPathSegments(fullPath) {
		const rel = relative(this.rootPath, fullPath)
		if (!rel) return []
		return rel.split(sep)
	}
	
	/**
	 * Ensure all parent directories exist for a path
	 * @param {string} fullPath - Full file path
	 * @returns {object} Parent node
	 */
	ensureParents(fullPath) {
		const segments = this.getPathSegments(fullPath)
		if (segments.length === 0) return this.root
		
		let current = this.root
		let currentPath = this.rootPath
		
		// Create all parent directories (except the last segment which is the file/dir itself)
		for (let i = 0; i < segments.length - 1; i++) {
			const segment = segments[i]
			currentPath = currentPath + sep + segment
			
			if (!current.children.has(segment)) {
				const node = createNode(currentPath, 'directory')
				current.children.set(segment, node)
				this.nodes.set(currentPath, node)
			}
			
			current = current.children.get(segment)
		}
		
		return current
	}
	
	/**
	 * Add or update a node in the tree
	 * @param {string} fullPath - Full path
	 * @param {string} type - 'file' or 'directory'
	 * @param {string} eventType - Event type (add, change, unlink, etc.)
	 */
	setNode(fullPath, type, eventType) {
		const parent = this.ensureParents(fullPath)
		const name = basename(fullPath)
		const now = Date.now()
		
		let node = this.nodes.get(fullPath)
		
		if (!node) {
			node = createNode(fullPath, type)
			parent.children.set(name, node)
			this.nodes.set(fullPath, node)
		}
		
		// Update event info
		node.eventType = eventType
		node.eventTime = now
		node.type = type
		node.isGhost = false
		node.ghostFadeStep = 0
		
		// Remove from ghosts if it was there (file recreated)
		this.ghosts.delete(fullPath)
		
		// Add to history
		this.addToHistory(node)
		
		// Propagate event to parent directories
		this.propagateToParents(fullPath, eventType, now)
	}
	
	/**
	 * Remove a node from the tree (mark as ghost for deletion visualization)
	 * @param {string} fullPath - Full path
	 * @param {string} eventType - Event type (unlink or unlinkDir)
	 */
	removeNode(fullPath, eventType) {
		const node = this.nodes.get(fullPath)
		if (!node) return
		
		const now = Date.now()
		
		// Mark as ghost instead of removing immediately
		node.isGhost = true
		node.ghostFadeStep = 0
		node.eventType = eventType
		node.eventTime = now
		
		// If it's a directory, mark all children as ghosts too
		if (node.type === 'directory') {
			this.markChildrenAsGhosts(node)
		}
		
		// Track as ghost
		this.ghosts.set(fullPath, {
			node,
			deathTime: now,
			fadeStep: 0,
		})
		
		// Add to history
		this.addToHistory(node)
		
		// Propagate to parents
		this.propagateToParents(fullPath, eventType, now)
	}
	
	/**
	 * Mark all children of a node as ghosts (recursive)
	 * @param {object} node - Directory node
	 */
	markChildrenAsGhosts(node) {
		for (const child of node.children.values()) {
			child.isGhost = true
			child.ghostFadeStep = 0
			
			if (child.type === 'directory') {
				this.markChildrenAsGhosts(child)
			}
		}
	}
	
	/**
	 * Propagate event upward to parent directories
	 * @param {string} fullPath - Path of changed item
	 * @param {string} eventType - Event type
	 * @param {number} now - Current timestamp
	 */
	propagateToParents(fullPath, eventType, now) {
		let parentPath = dirname(fullPath)
		
		while (parentPath.length >= this.rootPath.length) {
			const parentNode = this.nodes.get(parentPath)
			if (parentNode) {
				// Update parent's event info if this is a more significant event
				// or if the parent doesn't have an event yet
				if (!parentNode.eventTime || now - parentNode.eventTime > 100) {
					parentNode.eventTime = now
					// Use a generic 'childChange' event type for directories
					// unless they have a direct event
					if (!parentNode.eventType || parentNode.eventType === 'childChange') {
						parentNode.eventType = 'childChange'
					}
				}
			}
			
			if (parentPath === this.rootPath) break
			parentPath = dirname(parentPath)
		}
	}
	
	/**
	 * Add a node to the rolling history
	 * @param {object} node - Node to add
	 */
	addToHistory(node) {
		// Remove if already in history
		this.history = this.history.filter(n => n.path !== node.path)
		
		// Add to front
		this.history.unshift(node)
		
		// Trim to limit
		if (this.history.length > this.historyLimit) {
			this.history = this.history.slice(0, this.historyLimit)
		}
	}
	
	/**
	 * Advance ghost fade state (call on each render cycle)
	 * Returns true if any ghosts were fully removed
	 */
	advanceGhosts() {
		let removed = false
		
		for (const [path, ghost] of this.ghosts) {
			ghost.fadeStep++
			ghost.node.ghostFadeStep = ghost.fadeStep
			
			if (ghost.fadeStep >= this.ghostFadeSteps) {
				// Fully fade out - remove from tree
				this.fullyRemoveNode(path)
				this.ghosts.delete(path)
				removed = true
			}
		}
		
		return removed
	}
	
	/**
	 * Fully remove a node from the tree (after ghost fading)
	 * @param {string} fullPath - Path to remove
	 */
	fullyRemoveNode(fullPath) {
		const node = this.nodes.get(fullPath)
		if (!node) return
		
		// Remove from parent's children
		const parentPath = dirname(fullPath)
		const parent = this.nodes.get(parentPath)
		if (parent) {
			parent.children.delete(node.name)
		}
		
		// Remove from nodes map (and all children)
		this.removeFromNodesMap(node)
		
		// Remove from history
		this.history = this.history.filter(n => n.path !== fullPath)
	}
	
	/**
	 * Remove a node and all its children from the nodes map
	 * @param {object} node - Node to remove
	 */
	removeFromNodesMap(node) {
		this.nodes.delete(node.path)
		
		for (const child of node.children.values()) {
			this.removeFromNodesMap(child)
		}
	}
	
	/**
	 * Calculate heat for all nodes (recursive)
	 * @param {number} now - Current timestamp
	 * @returns {object} Root node with heat values attached
	 */
	calculateAllHeat(now = Date.now()) {
		this.calculateNodeHeat(this.root, now)
		return this.root
	}
	
	/**
	 * Calculate heat for a node and its children (recursive)
	 * @param {object} node - Node to calculate heat for
	 * @param {number} now - Current timestamp
	 * @returns {number} Node's heat value
	 */
	calculateNodeHeat(node, now) {
		// Calculate own heat from direct events
		const ownHeat = calculateHeat(node.eventType, node.eventTime, now)
		
		if (node.type === 'directory' && node.children.size > 0) {
			// Calculate children's heat
			const childHeats = []
			for (const child of node.children.values()) {
				childHeats.push(this.calculateNodeHeat(child, now))
			}
			
			// Aggregate for directory
			node.heat = calculateDirHeat(childHeats, ownHeat)
		} else {
			node.heat = ownHeat
		}
		
		// Ghost nodes get boosted heat for visibility
		if (node.isGhost && node.ghostFadeStep < this.ghostFadeSteps) {
			// Deleted items are very hot initially
			node.heat = Math.max(node.heat, 90 - (node.ghostFadeStep * 25))
		}
		
		return node.heat
	}
	
	/**
	 * Check if a path is in the rolling history
	 * @param {string} path - Path to check
	 * @returns {boolean}
	 */
	isInHistory(path) {
		return this.history.some(n => n.path === path)
	}
	
	/**
	 * Get count of recent changes in a directory
	 * @param {object} node - Directory node
	 * @returns {number} Count of hot children
	 */
	getChangeCount(node) {
		if (node.type !== 'directory') return 0
		
		let count = 0
		for (const child of node.children.values()) {
			if (isHot(child.heat)) {
				count++
			}
			if (child.type === 'directory') {
				count += this.getChangeCount(child)
			}
		}
		return count
	}
	
	/**
	 * Build initial tree from an array of file paths
	 * @param {string[]} paths - Array of file/directory paths
	 */
	buildFromPaths(paths) {
		for (const fullPath of paths) {
			const isDir = fullPath.endsWith(sep)
			const cleanPath = isDir ? fullPath.slice(0, -1) : fullPath
			const type = isDir ? 'directory' : 'file'
			
			this.ensureParents(cleanPath)
			const name = basename(cleanPath)
			const parent = this.nodes.get(dirname(cleanPath)) || this.root
			
			if (!parent.children.has(name)) {
				const node = createNode(cleanPath, type)
				parent.children.set(name, node)
				this.nodes.set(cleanPath, node)
			}
		}
	}
	
	/**
	 * Get all nodes as a flat array for debugging
	 * @returns {object[]} Array of all nodes
	 */
	getAllNodes() {
		return Array.from(this.nodes.values())
	}
}

