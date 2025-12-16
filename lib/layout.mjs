// Layout algorithm - space-aware adaptive tree layout

import { isHot, compareByHeatAsc } from './heat.mjs'
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
 * Generate layout from tree state
 * Adapts to available terminal space
 * @param {object} treeState - TreeState instance
 * @param {object} options - Layout options (terminalSize, gitStatus)
 * @returns {object} Layout result with nodes and metadata
 */
export function generateLayout(treeState, options = {}) {
	const termSize = options.terminalSize || getTerminalSize()
	const gitStatus = options.gitStatus || null
	const availableRows = calculateAvailableRows(termSize.rows)
	const now = Date.now()
	
	// Calculate heat for all nodes
	treeState.calculateAllHeat(now)
	
	// Flatten tree to layout nodes (with git status for sorting)
	const allNodes = flattenTree(treeState.root, 0, true, [], treeState, gitStatus)
	
	// Count initial rows needed
	let rowsNeeded = allNodes.length
	
	// If we have more rows than needed, we're in "abundant" mode
	// If we have fewer, we need to collapse
	
	if (rowsNeeded <= availableRows) {
		// We have enough space
		return {
			nodes: allNodes,
			totalRows: rowsNeeded,
			availableRows,
			collapsed: false,
			terminalSize: termSize,
		}
	} else {
		// Need to collapse - find coldest directories to hide
		const result = collapseToFit(allNodes, availableRows, treeState, gitStatus)
		return {
			nodes: result.nodes,
			totalRows: result.totalRows,
			availableRows,
			collapsed: true,
			terminalSize: termSize,
		}
	}
}

/**
 * Collapse cold directories to fit in available space
 * @param {object[]} nodes - Layout nodes
 * @param {number} availableRows - Available rows
 * @param {object} treeState - TreeState for history check
 * @param {object} gitStatus - GitStatus for priority scoring
 * @returns {object} Result with filtered nodes and total rows
 */
function collapseToFit(nodes, availableRows, treeState, gitStatus = null) {
	// Find directories that could be collapsed (coldest first)
	const collapsibleDirs = nodes.filter(n => 
		n.type === 'directory' && 
		n.depth > 0 && 
		!isHot(n.heat) &&
		!treeState.isInHistory(n.path)
	)
	
	// Sort by heat ascending (coldest first)
	collapsibleDirs.sort(compareByHeatAsc)
	
	// Build set of paths to hide (collapsed directory contents)
	const hiddenPaths = new Set()
	const collapsedDirs = new Set()
	
	let currentRows = nodes.length
	
	for (const dir of collapsibleDirs) {
		if (currentRows <= availableRows) break
		if (hiddenPaths.has(dir.path)) continue // Already hidden by parent collapse
		
		// Find all descendants of this directory
		const descendants = nodes.filter(n => 
			n.path !== dir.path && 
			n.path.startsWith(dir.path + '/')
		)
		
		// Only collapse if it actually saves space
		if (descendants.length > 0) {
			// Check if any descendants are protected (history, heat, or git status)
			const hasProtected = descendants.some(d => 
				treeState.isInHistory(d.path) || 
				isHot(d.heat) ||
				gitStatus?.getStatus(d.path, d.type)
			)
			
			if (!hasProtected) {
				for (const desc of descendants) {
					hiddenPaths.add(desc.path)
				}
				collapsedDirs.add(dir.path)
				currentRows -= descendants.length
			}
		}
	}
	
	// Filter out hidden nodes and mark collapsed directories
	let filteredNodes = nodes.filter(n => !hiddenPaths.has(n.path))
	
	for (const node of filteredNodes) {
		if (collapsedDirs.has(node.path)) {
			node.collapsed = true
		}
	}
	
	// If still over limit after collapsing dirs, prioritize by importance
	if (filteredNodes.length > availableRows) {
		// Score each node by priority
		const scored = filteredNodes.map((node, originalIndex) => ({
			node,
			originalIndex,
			priority: getNodePriority(node, treeState, gitStatus)
		}))
		
		// Sort by priority descending, keep top N
		scored.sort((a, b) => b.priority - a.priority)
		const kept = scored.slice(0, availableRows)
		
		// Restore original tree order
		kept.sort((a, b) => a.originalIndex - b.originalIndex)
		filteredNodes = kept.map(s => s.node)
	}
	
	// Mark directories with hidden children (partial collapse)
	for (const node of filteredNodes) {
		if (node.type === 'directory' && node.childCount > 0) {
			// Count visible direct children
			const visibleChildren = filteredNodes.filter(n => 
				n.path !== node.path &&
				n.path.startsWith(node.path + '/') &&
				!n.path.slice(node.path.length + 1).includes('/')
			).length
			const hiddenChildren = node.childCount - visibleChildren
			if (hiddenChildren > 0 && visibleChildren > 0) {
				node.hiddenChildCount = hiddenChildren
			}
		}
	}
	
	return { nodes: filteredNodes, totalRows: filteredNodes.length }
}

/**
 * Calculate priority score for a node (higher = more important to show)
 * @param {object} node - Layout node
 * @param {object} treeState - TreeState for history check
 * @param {object} gitStatus - GitStatus instance
 * @returns {number} Priority score
 */
function getNodePriority(node, treeState, gitStatus) {
	let score = 0
	
	// Git status is highest priority
	if (gitStatus?.getStatus(node.path, node.type)) {
		score += 1000
	}
	
	// Hot nodes are important
	if (isHot(node.heat)) {
		score += 500
	}
	
	// Nodes in history are protected
	if (treeState.isInHistory(node.path)) {
		score += 300
	}
	
	// Directories provide structure (keep them visible)
	if (node.type === 'directory') {
		score += 100
	}
	
	// Root node must always show
	if (node.depth === 0) {
		score += 10000
	}
	
	// Heat as tiebreaker
	score += node.heat
	
	return score
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

