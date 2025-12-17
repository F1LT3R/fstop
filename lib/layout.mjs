// Layout algorithm - weight-based adaptive tree layout
// Every line gets a weight, top N weighted lines are shown

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
 * Line weights - every renderable line competes for space
 * Higher weight = more likely to be shown when space is limited
 */
export const LINE_WEIGHTS = {
	ROOT:             10000,  // Must always show
	FILE_GIT_HOT:      1000,  // Changed file with git status
	FILE_GIT:           800,  // File with git status
	FILE_HOT:           600,  // Recently changed file
	DIR_WITH_CHANGES:   400,  // Directory containing activity
	INDICATOR_MORE:     300,  // "⋮ +N more" line (expendable)
	DIR_STRUCTURE:      200,  // Directory (provides context)
	FILE_COLD:           50,  // Unchanged file
	INDICATOR_COLLAPSED:  5,  // "dir/..." marker (expendable)
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
 * @param {object} options - Layout options (terminalSize, gitStatus)
 * @returns {object} Layout result with lines and metadata
 */
export function generateLayout(treeState, options = {}) {
	const termSize = options.terminalSize || getTerminalSize()
	const gitStatus = options.gitStatus || null
	const availableRows = calculateAvailableRows(termSize.rows)
	const now = Date.now()
	
	// Calculate heat for all nodes
	treeState.calculateAllHeat(now)
	
	// Generate all possible lines with weights
	const allLines = generateAllLines(treeState, gitStatus)
	
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
	}
}

/**
 * Generate all possible display lines with weights
 * @param {object} treeState - TreeState instance
 * @param {object} gitStatus - GitStatus instance
 * @returns {object[]} Array of line objects with weights
 */
function generateAllLines(treeState, gitStatus) {
	const lines = []
	
	// Flatten tree to layout nodes
	const allNodes = flattenTree(treeState.root, 0, true, [], treeState, gitStatus)
	
	// Create a line for each node with its weight
	allNodes.forEach((node, index) => {
		lines.push({
			lineType: 'node',
			node: node,
			displayOrder: index,
			weight: calculateLineWeight(node, treeState, gitStatus),
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
 * Calculate weight for a node line (higher = more important to show)
 * @param {object} node - Layout node
 * @param {object} treeState - TreeState for history check
 * @param {object} gitStatus - GitStatus instance
 * @returns {number} Weight score
 */
function calculateLineWeight(node, treeState, gitStatus) {
	// Root always shows
	if (node.depth === 0) {
		return LINE_WEIGHTS.ROOT
	}
	
	const hasGit = gitStatus?.getStatus(node.path, node.type)
	const hot = isHot(node.heat)
	
	let baseWeight = 0
	
	if (node.type === 'file') {
		if (hasGit && hot) baseWeight = LINE_WEIGHTS.FILE_GIT_HOT
		else if (hasGit) baseWeight = LINE_WEIGHTS.FILE_GIT
		else if (hot) baseWeight = LINE_WEIGHTS.FILE_HOT
		else baseWeight = LINE_WEIGHTS.FILE_COLD
	} else {
		// Directory
		baseWeight = node.changeCount > 0 
			? LINE_WEIGHTS.DIR_WITH_CHANGES 
			: LINE_WEIGHTS.DIR_STRUCTURE
	}
	
	// Bonus for being in history
	if (treeState.isInHistory(node.path)) {
		baseWeight += 100
	}
	
	// Heat as tiebreaker (0-100)
	baseWeight += node.heat
	
	return baseWeight
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

