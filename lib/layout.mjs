// Layout algorithm - weight-based adaptive tree layout
// Every line gets a weight, top N weighted lines are shown

import { isHot } from './heat.mjs'
import { getTerminalSize } from './terminal.mjs'
import { GitStatus } from './git-status.mjs'

/**
 * Layout configuration
 */
export const LAYOUT_CONFIG = {
	// Reserved rows for header/footer
	headerRows: 2,
	footerRows: 1,
	// Minimum rows to show anything meaningful
	minRows: 5,
}

/**
 * Additive weight system - each category contributes independently
 * Final weight = sum of applicable weights from each category
 * Higher weight = more likely to be shown when space is limited
 * 
 * Users can customize by modifying these values:
 *   WEIGHT.git.conflict = 2000  // Prioritize conflicts
 *   WEIGHT.event.deleted = 900  // Deleted files at top
 */
export const WEIGHT = {
	// Base weights (required for root)
	base: {
		ROOT: 10000,      // Always visible
	},
	
	// Git status weights (granular - higher = more critical)
	git: {
		conflict:  800,   // ✖ Must fix immediately
		untracked: 750,   // … New file - fresh context!
		unstaged:  700,   // ✚ Needs attention
		both:      650,   // Staged + unstaged changes
		staged:    600,   // ● Ready to commit
		none:        0,
	},
	
	// Heat/temperature weights (binary hot/cold)
	heat: {
		hot:  350,        // Recently changed (isHot() = true)
		cold:   0,
	},
	
	// Node type weights
	type: {
		file:      0,   // Cold files reach zero weight and drop out
		markdown: 75,   // .md files persist longer (READMEs, docs)
		dir:     500,   // Directories are structural, always prefer showing
	},
	
	// Event type weights (what recently happened)
	event: {
		unlink:    150,   // Deleted file
		unlinkDir: 150,   // Deleted directory
		add:        75,   // Created file
		addDir:     75,   // Created directory
		change:     50,   // Modified file
		rename:     25,   // Renamed
		none:        0,
	},
	
	// Context modifiers
	context: {
		hasChangedChildren: 200,  // Dir with active children
		inHistory:          100,  // In rolling history
		ghost:               50,  // Deleted but fading
	},
	
	// Indicator line weights
	indicator: {
		more:       250,  // "⋮ +N more"
		collapsed:    5,  // "dir/..."
	},
	
	// Gitignore penalty (sinks ignored files below cold files)
	gitignore: {
		ignored: -200,
	},

	// Filter match weight
	filter: {
		match:     9000,  // Maximum priority (below ROOT) - matches bubble to top
	},
}

/**
 * Create a layout node from a tree node
 * @param {object} treeNode - Node from TreeState
 * @param {number} depth - Depth in tree
 * @param {boolean} isLast - Is this the last child
 * @param {boolean[]} parentContinues - Array indicating which parent levels have more siblings
 * @returns {object} Layout node
 */
function createLayoutNode(treeNode, depth, isLast, parentContinues) {
	return {
		path: treeNode.path,
		name: treeNode.name,
		type: treeNode.type,
		depth,
		isLast,
		parentContinues: [...parentContinues],
		heat: treeNode.heat || 0,
		eventType: treeNode.eventType,
		eventTime: treeNode.eventTime,
		isGhost: treeNode.isGhost,
		ghostFadeStep: treeNode.ghostFadeStep,
		isSymlink: treeNode.isSymlink,
		realPath: treeNode.realPath,
		wasTouched: treeNode.wasTouched || false,
		children: [],
		collapsed: false,
		manualFold: false,
		changeCount: 0,
	}
}

/**
 * Check if a node has git status
 * @param {object} node - Tree node to check
 * @param {object} gitStatus - GitStatus instance
 * @returns {boolean}
 */
function hasGitStatus(node, gitStatus) {
	if (!gitStatus) return false
	const status = GitStatus.getStatusForPath(node.path, node.realPath, node.type)
	return status !== null
}

/**
 * Check if a node or any of its descendants have git status or heat
 * @param {object} node - Tree node to check
 * @param {object} gitStatus - GitStatus instance
 * @returns {boolean}
 */
function hasActiveDescendants(node, gitStatus) {
	// Check node itself
	if (hasGitStatus(node, gitStatus) || isHot(node.heat || 0) || node.name?.toLowerCase().endsWith('.md')) {
		return true
	}

	// Check children recursively
	if (node.children && node.children.size > 0) {
		for (const child of node.children.values()) {
			if (hasActiveDescendants(child, gitStatus)) {
				return true
			}
		}
	}
	
	return false
}

/**
 * Determine if a directory should be auto-collapsed
 * Collapse if: directory has no git status, no heat, and no active descendants
 * @param {object} node - Tree node to check
 * @param {object} gitStatus - GitStatus instance
 * @returns {boolean}
 */
function shouldAutoCollapse(node, gitStatus) {
	// Never collapse if it has git status or heat
	if (hasGitStatus(node, gitStatus) || isHot(node.heat || 0)) {
		return false
	}
	
	// Collapse if no active descendants
	return !hasActiveDescendants(node, gitStatus)
}

/**
 * Flatten tree to layout nodes (recursive)
 * @param {object} treeNode - Node from TreeState
 * @param {number} depth - Current depth
 * @param {boolean} isLast - Is last child at this level
 * @param {boolean[]} parentContinues - Parent continuation markers
 * @param {object} treeState - TreeState instance for counting changes
 * @param {object} gitStatus - GitStatus instance for sorting (optional)
 * @param {boolean} collapse - Whether auto-collapsing is enabled (default true)
 * @returns {object[]} Array of layout nodes
 */
function flattenTree(treeNode, depth, isLast, parentContinues, treeState, gitStatus, collapse = true, manualFolds = null, manualOpens = null, hiddenDirs = null) {
	// Skip hidden dirs entirely
	if (hiddenDirs && hiddenDirs.has(treeNode.path)) {
		return []
	}

	const layoutNode = createLayoutNode(treeNode, depth, isLast, parentContinues)

	if (treeNode.type === 'directory') {
		layoutNode.changeCount = treeState.getChangeCount(treeNode)
	}

	const result = [layoutNode]

	// Manual fold: show dir line but don't recurse into children
	if (manualFolds && manualFolds.has(treeNode.path)) {
		layoutNode.collapsed = true
		layoutNode.manualFold = true
		return result
	}

	if (treeNode.type === 'directory' && treeNode.children.size > 0) {
		// Check if this directory should be auto-collapsed (only when space is tight)
		if (collapse && depth > 0 && gitStatus
			&& !(manualOpens && manualOpens.has(treeNode.path))
			&& shouldAutoCollapse(treeNode, gitStatus)) {
			layoutNode.collapsed = true
			// Don't recurse into children - they're collapsed
			return result
		}
		
		const children = Array.from(treeNode.children.values())
		// Sort children: directories first, gitignored last, then git status, then heat, then alphabetically
		children.sort((a, b) => {
			// 0. Directories first
			if (a.type !== b.type) {
				return a.type === 'directory' ? -1 : 1
			}

			// 1. Gitignored files last
			if (gitStatus) {
				const aIgnored = GitStatus.isPathIgnored(a.path, a.type)
				const bIgnored = GitStatus.isPathIgnored(b.path, b.type)
				if (aIgnored !== bIgnored) {
					return aIgnored ? 1 : -1
				}
			}

			// 2. Git status (files with git status come first)
			if (gitStatus) {
				const aGit = GitStatus.getStatusForPath(a.path, a.realPath, a.type)
				const bGit = GitStatus.getStatusForPath(b.path, b.realPath, b.type)
				const aHasGit = aGit !== null
				const bHasGit = bGit !== null
				if (aHasGit !== bHasGit) {
					return aHasGit ? -1 : 1
				}
			}
			
			// 3. Heat (hot items first)
			if (Math.abs(a.heat - b.heat) > 5) {
				return b.heat - a.heat
			}

			// 4. Alphabetically
			return a.name.localeCompare(b.name)
		})
		
		const newParentContinues = depth > 0 
			? [...parentContinues, !isLast]
			: parentContinues
		
		children.forEach((child, index) => {
			const childIsLast = index === children.length - 1
			const childNodes = flattenTree(
				child,
				depth + 1,
				childIsLast,
				newParentContinues,
				treeState,
				gitStatus,
				collapse,
				manualFolds,
				manualOpens,
				hiddenDirs
			)
			for (const cn of childNodes) {
				layoutNode.children.push(cn)
				result.push(cn)
			}
		})
	}
	
	return result
}

/**
 * Calculate available rows for tree display
 * @param {number} terminalRows - Total terminal rows
 * @returns {number} Available rows
 */
export function calculateAvailableRows(terminalRows) {
	const available = terminalRows - LAYOUT_CONFIG.headerRows - LAYOUT_CONFIG.footerRows
	return Math.max(available, LAYOUT_CONFIG.minRows)
}

/**
 * Generate layout from tree state using weight-based selection
 * Every line competes for space based on weight
 * @param {object} treeState - TreeState instance
 * @param {object} options - Layout options (terminalSize, gitStatus, filterPattern)
 * @returns {object} Layout result with lines and metadata
 */
export function generateLayout(treeState, options = {}) {
	const termSize = options.terminalSize || getTerminalSize()
	const gitStatus = options.gitStatus || null
	const filterPattern = options.filterPattern || ''
	const manualFolds = options.manualFolds || new Set()
	const manualOpens = options.manualOpens || new Set()
	const hiddenDirs = options.hiddenDirs || new Set()
	const rootPath = treeState.root?.path || ''
	const availableRows = calculateAvailableRows(termSize.rows)
	const now = Date.now()
	
	// Calculate heat for all nodes
	treeState.calculateAllHeat(now)
	
	// Generate all possible lines with weights
	const allLines = generateAllLines(treeState, gitStatus, filterPattern, rootPath, availableRows, manualFolds, manualOpens, hiddenDirs)
	
	// Select visible lines based on weight
	const visibleLines = selectVisibleLines(allLines, availableRows)
	
	// Extract nodes for backward compatibility with renderer
	const nodes = visibleLines
		.filter(line => line.lineType === 'node')
		.map(line => line.node)
	
	return {
		lines: visibleLines,
		nodes,  // backward compatibility
		totalRows: allLines.length,
		availableRows,
		collapsed: visibleLines.length < allLines.length,
		terminalSize: termSize,
		rootPath,  // for path-based filter matching
	}
}

/**
 * Generate all possible display lines with weights
 * @param {object} treeState - TreeState instance
 * @param {object} gitStatus - GitStatus instance
 * @param {string} filterPattern - Filter pattern for weight boosting
 * @param {string} rootPath - Root path for relative path calculation
 * @param {number} availableRows - Available terminal rows (for collapse decision)
 * @returns {object[]} Array of line objects with weights
 */
function generateAllLines(treeState, gitStatus, filterPattern = '', rootPath = '', availableRows = Infinity, manualFolds = null, manualOpens = null, hiddenDirs = null) {
	// First pass: flatten without collapsing to see if everything fits
	const expandedNodes = flattenTree(treeState.root, 0, true, [], treeState, gitStatus, false, manualFolds, manualOpens, hiddenDirs)

	// Only collapse if the expanded tree exceeds available space
	const allNodes = expandedNodes.length > availableRows
		? flattenTree(treeState.root, 0, true, [], treeState, gitStatus, true, manualFolds, manualOpens, hiddenDirs)
		: expandedNodes

	const lines = []

	// Create a line for each node with its weight
	allNodes.forEach((node, index) => {
		const filterMatch = matchesFilter(node, filterPattern, rootPath)
		lines.push({
			lineType: 'node',
			node: node,
			displayOrder: index,
			weight: calculateLineWeight(node, treeState, gitStatus, filterPattern, rootPath),
			filterMatch: filterMatch,  // { match: true, type: 'glob'|'text' } or false
		})
	})

	return lines
}

/**
 * Select visible lines based on weight
 * Simple algorithm: sort by weight, take top N, restore display order
 * @param {object[]} allLines - All possible lines
 * @param {number} availableRows - Number of rows available
 * @returns {object[]} Selected lines in display order
 */
function selectVisibleLines(allLines, availableRows) {
	if (allLines.length <= availableRows) {
		// Everything fits
		return allLines
	}
	
	// Sort by weight descending (highest first)
	const sorted = [...allLines].sort((a, b) => b.weight - a.weight)
	
	// Take top N
	const selected = sorted.slice(0, availableRows)
	
	// Restore display order
	selected.sort((a, b) => a.displayOrder - b.displayOrder)
	
	return selected
}

/**
 * Check if a node matches the filter pattern (text-only matching)
 * Simple substring matching:
 *   - `heat` = substring match on name only
 *   - `/lib` or `/lib/` = exact directory match only
 *   - `/lib/heat` = substring match on relative path
 * NOTE: Parent directories are NOT matched - only actual matching files/dirs
 * @param {object} node - Layout node with name and path
 * @param {string} pattern - Filter pattern
 * @param {string} rootPath - Root path for relative path calculation
 * @returns {object|false} { match: true, type: 'text' } or false
 */
function matchesFilter(node, pattern, rootPath = '') {
	if (!pattern) return false
	
	// Get relative path from root
	let relativePath = node.name
	if (rootPath && node.path) {
		relativePath = node.path.replace(rootPath + '/', '')
	}
	
	// For path patterns (contains /), match against relative path
	if (pattern.includes('/')) {
		const cleanPattern = pattern.replace(/^\//, '').replace(/\/$/, '')  // Remove leading/trailing /
		
		// If pattern is just a directory name (no further path), exact match only
		if (!cleanPattern.includes('/')) {
			return relativePath.toLowerCase() === cleanPattern.toLowerCase()
				? { match: true, type: 'text' }
				: false
		}
		
		// Pattern has nested path like /lib/heat - substring match on relative path
		if (relativePath.toLowerCase().includes(cleanPattern.toLowerCase())) {
			return { match: true, type: 'text' }
		}
		return false
	}
	
	// Non-path patterns - substring match on name only
	return node.name.toLowerCase().includes(pattern.toLowerCase())
		? { match: true, type: 'text' }
		: false
}

/**
 * Calculate weight for a node line using additive system
 * Each category contributes independently to the final weight
 * @param {object} node - Layout node
 * @param {object} treeState - TreeState for history check
 * @param {object} gitStatus - GitStatus instance
 * @param {string} filterPattern - Filter pattern for weight boost
 * @param {string} rootPath - Root path for relative path calculation
 * @returns {number} Weight score
 */
function calculateLineWeight(node, treeState, gitStatus, filterPattern = '', rootPath = '') {
	// Root always shows with max weight
	if (node.depth === 0) {
		return WEIGHT.base.ROOT
	}
	
	let weight = 0
	
	// 1. Type weight (file vs directory vs markdown)
	if (node.type === 'directory') {
		weight += WEIGHT.type.dir
	} else if (node.name.toLowerCase().endsWith('.md')) {
		weight += WEIGHT.type.markdown
	} else {
		weight += WEIGHT.type.file
	}
	
	// 2. Git status weight (granular)
	const gitInfo = gitStatus ? GitStatus.getStatusForPath(node.path, node.realPath, node.type) : null
	if (gitInfo?.status) {
		const gitWeight = WEIGHT.git[gitInfo.status] ?? WEIGHT.git.none
		weight += gitWeight
	}
	
	// 3. Gitignore penalty
	if (gitStatus && GitStatus.isPathIgnored(node.path, node.type)) {
		weight += WEIGHT.gitignore.ignored
	}

	// 4. Heat weight (hot vs cold)
	if (isHot(node.heat)) {
		weight += WEIGHT.heat.hot
	}
	
	// 5. Event type weight
	if (node.eventType) {
		const eventWeight = WEIGHT.event[node.eventType] ?? WEIGHT.event.none
		weight += eventWeight
	}

	// 6. Context modifiers
	if (node.type === 'directory' && node.changeCount > 0) {
		weight += WEIGHT.context.hasChangedChildren
	}
	
	if (treeState.isInHistory(node.path)) {
		weight += WEIGHT.context.inHistory
	}
	
	if (node.isGhost) {
		weight += WEIGHT.context.ghost
	}
	
	// 7. Filter match bonus
	if (matchesFilter(node, filterPattern, rootPath)) {
		weight += WEIGHT.filter.match
	}
	
	// 8. Heat value as tiebreaker (0-100)
	weight += node.heat
	
	return weight
}

/**
 * Get nodes that should be visible in the current layout
 * @param {object} layout - Layout result from generateLayout
 * @returns {object[]} Visible nodes in render order
 */
export function getVisibleNodes(layout) {
	return layout.nodes
}

/**
 * Calculate row index for a specific node
 * Accounts for header offset
 * @param {object[]} nodes - Layout nodes
 * @param {number} nodeIndex - Index of node
 * @returns {number} Row number (1-indexed)
 */
export function getNodeRow(nodes, nodeIndex) {
	return LAYOUT_CONFIG.headerRows + 1 + nodeIndex
}

