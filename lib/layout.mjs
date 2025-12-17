// Layout algorithm - weight-based adaptive tree layout
// Every line gets a weight, top N weighted lines are shown

import micromatch from 'micromatch'
import { isHot } from './heat.mjs'
import { getTerminalSize } from './terminal.mjs'

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
		unstaged:  700,   // ✚ Needs attention
		both:      650,   // Staged + unstaged changes
		staged:    600,   // ● Ready to commit
		untracked: 500,   // … New file
		none:        0,
	},
	
	// Heat/temperature weights (binary hot/cold)
	heat: {
		hot:  350,        // Recently changed (isHot() = true)
		cold:   0,
	},
	
	// Node type weights
	type: {
		file:  50,
		dir:  100,
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
		children: [],
		collapsed: false,
		childCount: treeNode.children?.size || 0,
		changeCount: 0,
	}
}

/**
 * Flatten tree to layout nodes (recursive)
 * @param {object} treeNode - Node from TreeState
 * @param {number} depth - Current depth
 * @param {boolean} isLast - Is last child at this level
 * @param {boolean[]} parentContinues - Parent continuation markers
 * @param {object} treeState - TreeState instance for counting changes
 * @param {object} gitStatus - GitStatus instance for sorting (optional)
 * @returns {object[]} Array of layout nodes
 */
function flattenTree(treeNode, depth, isLast, parentContinues, treeState, gitStatus) {
	const layoutNode = createLayoutNode(treeNode, depth, isLast, parentContinues)
	
	if (treeNode.type === 'directory') {
		layoutNode.changeCount = treeState.getChangeCount(treeNode)
	}
	
	const result = [layoutNode]
	
	if (treeNode.type === 'directory' && treeNode.children.size > 0) {
		const children = Array.from(treeNode.children.values())
		// Sort children: directories first, then git status, then heat, then alphabetically
		children.sort((a, b) => {
			// 0. Directories first
			if (a.type !== b.type) {
				return a.type === 'directory' ? -1 : 1
			}
			
			// 1. Git status (files with git status come first)
			if (gitStatus) {
				const aGit = gitStatus.getStatus(a.path, a.type)
				const bGit = gitStatus.getStatus(b.path, b.type)
				const aHasGit = aGit !== null
				const bHasGit = bGit !== null
				if (aHasGit !== bHasGit) {
					return aHasGit ? -1 : 1
				}
			}
			
			// 2. Heat (hot items first)
			if (Math.abs(a.heat - b.heat) > 5) {
				return b.heat - a.heat
			}
			
			// 3. Alphabetically
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
				gitStatus
			)
			layoutNode.children.push(...childNodes)
			result.push(...childNodes)
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
	const rootPath = treeState.root?.path || ''
	const availableRows = calculateAvailableRows(termSize.rows)
	const now = Date.now()
	
	// Calculate heat for all nodes
	treeState.calculateAllHeat(now)
	
	// Generate all possible lines with weights
	const allLines = generateAllLines(treeState, gitStatus, filterPattern, rootPath)
	
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
 * @returns {object[]} Array of line objects with weights
 */
function generateAllLines(treeState, gitStatus, filterPattern = '', rootPath = '') {
	const lines = []
	
	// Flatten tree to layout nodes
	const allNodes = flattenTree(treeState.root, 0, true, [], treeState, gitStatus)
	
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
 * Check if a node matches the filter pattern
 * Filesystem-style pattern semantics:
 *   - `heat` = substring match on name only
 *   - `/lib` or `/lib/` = exact directory match only
 *   - `/lib/*` = glob: direct children of lib
 *   - `/lib/**` = glob: all descendants of lib
 * NOTE: Parent directories are NOT matched - only actual matching files/dirs
 * @param {object} node - Layout node with name and path
 * @param {string} pattern - Filter pattern
 * @param {string} rootPath - Root path for relative path calculation
 * @returns {object|false} { match: true, type: 'glob'|'text' } or false
 */
function matchesFilter(node, pattern, rootPath = '') {
	if (!pattern) return false
	
	// Get relative path from root
	let relativePath = node.name
	if (rootPath && node.path) {
		relativePath = node.path.replace(rootPath + '/', '')
	}
	
	const isGlob = pattern.includes('*') || pattern.includes('?')
	
	// For path patterns (contains /), match against relative path
	if (pattern.includes('/')) {
		const cleanPattern = pattern.replace(/^\//, '')  // Remove leading /
		
		// Handle exact directory match: /dir or /dir/ (no glob chars)
		// This matches ONLY the directory itself, not its children
		if (!isGlob) {
			const dirPattern = cleanPattern.replace(/\/$/, '')  // Remove trailing /
			
			// If pattern is just a directory name (no further path), exact match only
			if (!dirPattern.includes('/')) {
				return relativePath.toLowerCase() === dirPattern.toLowerCase()
					? { match: true, type: 'text' }
					: false
			}
			
			// Pattern has nested path like /lib/heat - match files containing the pattern
			// Only match the actual file, NOT parent directories
			if (relativePath.toLowerCase().includes(dirPattern.toLowerCase())) {
				return { match: true, type: 'text' }
			}
			return false
		}
		
		// Glob matching - only match actual files, NOT parent directories
		if (micromatch.isMatch(relativePath, cleanPattern, { nocase: true })) {
			return { match: true, type: 'glob' }
		}
		return false
	}
	
	// Non-path patterns - match against name only
	if (isGlob) {
		return micromatch.isMatch(node.name, pattern, { nocase: true })
			? { match: true, type: 'glob' }
			: false
	}
	
	// Substring matching on name only
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
	
	// 1. Type weight (file vs directory)
	weight += node.type === 'file' ? WEIGHT.type.file : WEIGHT.type.dir
	
	// 2. Git status weight (granular)
	const gitInfo = gitStatus?.getStatus(node.path, node.type)
	if (gitInfo?.status) {
		const gitWeight = WEIGHT.git[gitInfo.status] ?? WEIGHT.git.none
		weight += gitWeight
	}
	
	// 3. Heat weight (hot vs cold)
	if (isHot(node.heat)) {
		weight += WEIGHT.heat.hot
	}
	
	// 4. Event type weight
	if (node.eventType) {
		const eventWeight = WEIGHT.event[node.eventType] ?? WEIGHT.event.none
		weight += eventWeight
	}
	
	// 5. Context modifiers
	if (node.type === 'directory' && node.changeCount > 0) {
		weight += WEIGHT.context.hasChangedChildren
	}
	
	if (treeState.isInHistory(node.path)) {
		weight += WEIGHT.context.inHistory
	}
	
	if (node.isGhost) {
		weight += WEIGHT.context.ghost
	}
	
	// 6. Filter match bonus
	if (matchesFilter(node, filterPattern, rootPath)) {
		weight += WEIGHT.filter.match
	}
	
	// 7. Heat value as tiebreaker (0-100)
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

