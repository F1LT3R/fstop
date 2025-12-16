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
 * @returns {object[]} Array of layout nodes
 */
function flattenTree(treeNode, depth, isLast, parentContinues, treeState) {
	const layoutNode = createLayoutNode(treeNode, depth, isLast, parentContinues)
	
	if (treeNode.type === 'directory') {
		layoutNode.changeCount = treeState.getChangeCount(treeNode)
	}
	
	const result = [layoutNode]
	
	if (treeNode.type === 'directory' && treeNode.children.size > 0) {
		const children = Array.from(treeNode.children.values())
		// Sort children: directories first, then by heat (hottest first), then alphabetically
		children.sort((a, b) => {
			// Directories first
			if (a.type !== b.type) {
				return a.type === 'directory' ? -1 : 1
			}
			// Then by heat (hot items first)
			if (Math.abs(a.heat - b.heat) > 5) {
				return b.heat - a.heat
			}
			// Then alphabetically
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
				treeState
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
 * @param {object} options - Layout options
 * @returns {object} Layout result with nodes and metadata
 */
export function generateLayout(treeState, options = {}) {
	const termSize = options.terminalSize || getTerminalSize()
	const availableRows = calculateAvailableRows(termSize.rows)
	const now = Date.now()
	
	// Calculate heat for all nodes
	treeState.calculateAllHeat(now)
	
	// Flatten tree to layout nodes
	const allNodes = flattenTree(treeState.root, 0, true, [], treeState)
	
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
		const result = collapseToFit(allNodes, availableRows, treeState)
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
 * @returns {object} Result with filtered nodes and total rows
 */
function collapseToFit(nodes, availableRows, treeState) {
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
			// Check if any descendants are in history (protected)
			const hasProtected = descendants.some(d => 
				treeState.isInHistory(d.path) || isHot(d.heat)
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
	const filteredNodes = nodes.filter(n => !hiddenPaths.has(n.path))
	
	for (const node of filteredNodes) {
		if (collapsedDirs.has(node.path)) {
			node.collapsed = true
		}
	}
	
	return { nodes: filteredNodes, totalRows: filteredNodes.length }
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

