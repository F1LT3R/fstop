// Renderer - ANSI output with colors, box-drawing, and in-place updates

import { 
	ANSI, 
	write, 
	writeLine, 
	clearScreen, 
	style, 
	strikethrough,
	truncate,
	padRight,
	visibleLength,
	BOX,
	getTerminalSize,
} from './terminal.mjs'

import {
	heatBar,
	formatTimeAgo,
	getHeatColor,
	isHot,
} from './heat.mjs'

import { LAYOUT_CONFIG, getNodeRow } from './layout.mjs'

/**
 * Renderer configuration
 */
const RENDER_CONFIG = {
	// Column widths
	nameColWidth: 24,
	timeColWidth: 6,
	heatColWidth: 8,
	eventColWidth: 10,
	// Update indicator
	updateChar: '●',
}

/**
 * Get ANSI color code from color name
 * @param {string} colorName - Color name from heat module
 * @returns {string} ANSI color code
 */
function getColorCode(colorName) {
	return ANSI.fg[colorName] || ANSI.fg.white
}

/**
 * Render the tree prefix (box-drawing characters)
 * @param {object} node - Layout node
 * @returns {string} Tree prefix string
 */
function renderTreePrefix(node) {
	if (node.depth === 0) return ''
	
	let prefix = ''
	
	// Add vertical lines for parent levels
	for (let i = 0; i < node.parentContinues.length; i++) {
		if (node.parentContinues[i]) {
			prefix += BOX.vertical + '   '
		} else {
			prefix += '    '
		}
	}
	
	// Add branch character
	prefix += node.isLast ? BOX.corner : BOX.tee
	prefix += BOX.horizontal + BOX.horizontal + ' '
	
	return prefix
}

/**
 * Format event type for display
 * @param {string} eventType - Event type
 * @returns {string} Formatted event label
 */
function formatEventType(eventType) {
	const labels = {
		add: 'created',
		addDir: 'created',
		change: 'modified',
		unlink: 'DELETED',
		unlinkDir: 'DELETED',
		rename: 'renamed',
		childChange: '',
	}
	return labels[eventType] || ''
}

/**
 * Render a single node line
 * @param {object} node - Layout node
 * @param {number} now - Current timestamp
 * @param {number} maxWidth - Maximum line width
 * @returns {string} Rendered line
 */
function renderNodeLine(node, now, maxWidth) {
	const prefix = renderTreePrefix(node)
	const prefixLen = visibleLength(prefix)
	
	// Determine styling based on state
	const isDeleted = node.eventType === 'unlink' || node.eventType === 'unlinkDir'
	const isGhostNode = node.isGhost
	const colorName = getHeatColor(node.heat)
	const color = getColorCode(colorName)
	
	// Build name with type indicator
	let name = node.name
	if (node.type === 'directory') {
		name += '/'
	}
	if (node.collapsed) {
		name += '...'
	}
	
	// Apply ghost/deleted styling
	if (isGhostNode || isDeleted) {
		name = strikethrough(name)
	}
	
	// Truncate name if needed
	const availableForName = RENDER_CONFIG.nameColWidth
	name = truncate(name, availableForName)
	name = padRight(name, availableForName)
	
	// Build the rest of the line
	let line = prefix
	
	// Apply heat color to name
	if (isHot(node.heat) && !isGhostNode) {
		line += style(name, color, ANSI.bold)
	} else if (isGhostNode) {
		line += style(name, ANSI.fg.red, ANSI.dim)
	} else {
		line += style(name, ANSI.fg.gray)
	}
	
	// Add heat indicators for hot items
	if (isHot(node.heat) || isGhostNode) {
		// Time ago
		const timeAgo = formatTimeAgo(node.eventTime, now)
		const timeStr = timeAgo ? `[${timeAgo}]` : ''
		line += ' ' + style(padRight(timeStr, RENDER_CONFIG.timeColWidth), ANSI.fg.gray)
		
		// Heat bar
		const bar = heatBar(node.heat)
		line += ' ' + style(bar, color)
		
		// Event type
		const eventLabel = formatEventType(node.eventType)
		if (eventLabel) {
			const eventColor = isDeleted ? ANSI.fg.red : ANSI.fg.gray
			line += '  ' + style(eventLabel, eventColor)
		}
	} else if (node.type === 'directory' && node.changeCount > 0) {
		// Show change count for directories with activity
		const countStr = `(${node.changeCount} ${node.changeCount === 1 ? 'change' : 'changes'})`
		line += ' ' + style(countStr, ANSI.fg.gray, ANSI.dim)
	}
	
	return line
}

/**
 * Render detail lines for an expanded hot node
 * @param {object} node - Layout node
 * @param {number} now - Current timestamp
 * @returns {string[]} Array of detail line strings
 */
function renderDetailLines(node, now) {
	if (node.detailLines === 0) return []
	
	const lines = []
	const indent = '    '.repeat(node.depth + 1)
	const color = getColorCode(getHeatColor(node.heat))
	
	// Detail line 1: Event info
	if (node.detailLines >= 1 && node.eventType) {
		const eventLabel = formatEventType(node.eventType)
		const timeAgo = formatTimeAgo(node.eventTime, now)
		lines.push(indent + style(`├─ ${eventLabel} ${timeAgo} ago`, ANSI.fg.gray, ANSI.dim))
	}
	
	// Detail line 2: Heat visualization
	if (node.detailLines >= 2) {
		const bar = heatBar(node.heat)
		const heatPct = Math.round(node.heat)
		lines.push(indent + style(`├─ heat: ${bar} ${heatPct}%`, ANSI.fg.gray, ANSI.dim))
	}
	
	// Detail line 3: Path info
	if (node.detailLines >= 3) {
		lines.push(indent + style(`└─ ${node.path}`, ANSI.fg.gray, ANSI.dim))
	}
	
	return lines
}

/**
 * Render the header
 * @param {string} watchPath - Path being watched
 * @param {object} termSize - Terminal size
 * @returns {string[]} Header lines
 */
function renderHeader(watchPath, termSize) {
	const title = style('watching: ', ANSI.fg.gray) + style(watchPath, ANSI.fg.cyan, ANSI.bold)
	return [title, '']
}

/**
 * Render the footer
 * @param {object} layout - Layout result
 * @returns {string[]} Footer lines
 */
function renderFooter(layout) {
	const status = layout.collapsed 
		? style('(some items collapsed to fit)', ANSI.fg.yellow, ANSI.dim)
		: ''
	return [status]
}

/**
 * Full render - clears screen and renders entire tree
 * @param {object} layout - Layout result from generateLayout
 * @param {string} watchPath - Path being watched
 */
export function render(layout, watchPath) {
	const now = Date.now()
	const { rows, cols } = layout.terminalSize
	
	// Clear screen and move to home
	clearScreen()
	
	// Render header
	const headerLines = renderHeader(watchPath, layout.terminalSize)
	headerLines.forEach((line, i) => {
		writeLine(i + 1, line)
	})
	
	// Render tree nodes
	let currentRow = LAYOUT_CONFIG.headerRows + 1
	
	for (const node of layout.nodes) {
		// Main node line
		const line = renderNodeLine(node, now, cols)
		writeLine(currentRow, line)
		currentRow++
		
		// Detail lines if expanded
		const detailLines = renderDetailLines(node, now)
		for (const detailLine of detailLines) {
			writeLine(currentRow, detailLine)
			currentRow++
		}
	}
	
	// Clear remaining lines
	const availableRows = rows - LAYOUT_CONFIG.footerRows
	while (currentRow <= availableRows) {
		writeLine(currentRow, '')
		currentRow++
	}
	
	// Render footer
	const footerLines = renderFooter(layout)
	footerLines.forEach((line, i) => {
		writeLine(rows - LAYOUT_CONFIG.footerRows + i + 1, line)
	})
}

/**
 * Incremental render - only update changed nodes
 * For now, this just calls full render, but could be optimized
 * @param {object} layout - Layout result
 * @param {string} watchPath - Path being watched
 * @param {Set} changedPaths - Set of paths that changed
 */
export function renderIncremental(layout, watchPath, changedPaths) {
	// For simplicity, do a full render
	// Could be optimized to only update specific lines
	render(layout, watchPath)
}

/**
 * Render a "flash" effect on recently changed nodes
 * @param {object} layout - Layout result
 * @param {Set} changedPaths - Paths that just changed
 */
export function flashChanges(layout, changedPaths) {
	const now = Date.now()
	
	for (let i = 0; i < layout.nodes.length; i++) {
		const node = layout.nodes[i]
		if (changedPaths.has(node.path)) {
			const row = getNodeRow(layout.nodes, i)
			const line = renderNodeLine(node, now, layout.terminalSize.cols)
			
			// Flash with bright background briefly
			writeLine(row, style(RENDER_CONFIG.updateChar + ' ', ANSI.fg.brightGreen) + line)
		}
	}
}

/**
 * Create a renderer instance with state
 * @param {string} watchPath - Path being watched
 * @returns {object} Renderer instance
 */
export function createRenderer(watchPath) {
	let lastLayout = null
	
	return {
		/**
		 * Render the tree
		 * @param {object} layout - Layout result
		 */
		render(layout) {
			lastLayout = layout
			render(layout, watchPath)
		},
		
		/**
		 * Get last rendered layout
		 */
		getLastLayout() {
			return lastLayout
		},
	}
}

