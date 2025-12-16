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

import { GIT_COLORS } from './git-status.mjs'

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
 * Format event type for display (uppercase)
 * @param {string} eventType - Event type
 * @returns {string} Formatted event label
 */
function formatEventType(eventType) {
	const labels = {
		add: 'CREATED',
		addDir: 'CREATED',
		change: 'MODIFIED',
		unlink: 'DELETED',
		unlinkDir: 'DELETED',
		rename: 'RENAMED',
		childChange: '',
	}
	return labels[eventType] || ''
}

/**
 * Render git status symbol with color
 * @param {object} gitStatus - Git status object with symbol and color
 * @returns {string} Colored symbol or empty string
 */
function renderGitSymbol(gitStatus) {
	if (!gitStatus) return ''
	
	const colorCode = ANSI.fg[gitStatus.color] || ANSI.fg.gray
	return style(gitStatus.symbol + ' ', colorCode)
}

/**
 * Render a single node line
 * @param {object} node - Layout node
 * @param {number} now - Current timestamp
 * @param {number} maxWidth - Maximum line width
 * @param {object} gitStatus - Git status object (optional)
 * @returns {string} Rendered line
 */
function renderNodeLine(node, now, maxWidth, gitStatus = null) {
	const prefix = renderTreePrefix(node)
	
	// Determine styling based on state
	const isDeleted = node.eventType === 'unlink' || node.eventType === 'unlinkDir'
	const isGhostNode = node.isGhost
	// Prioritize git status color, fall back to heat color
	const colorName = gitStatus?.color || getHeatColor(node.heat)
	const color = getColorCode(colorName)
	
	// Build name with type indicator
	let displayName = node.name
	if (node.type === 'directory') {
		displayName += '/'
	}
	if (node.collapsed) {
		displayName += '...'
	}
	
	// Apply ghost/deleted styling to name
	let styledName = displayName
	if (isGhostNode || isDeleted) {
		styledName = strikethrough(displayName)
	}
	
	// Git symbol
	const gitSymbol = renderGitSymbol(gitStatus)
	const gitSymbolLen = gitStatus ? 2 : 0  // symbol + space
	
	// Calculate left side length (visible characters)
	const leftLen = visibleLength(prefix) + gitSymbolLen + displayName.length
	
	// Build left part of line
	let leftPart = prefix + gitSymbol
	
	// Apply color to name
	const hasGitStatus = gitStatus !== null
	if ((hasGitStatus || isHot(node.heat)) && !isGhostNode) {
		leftPart += style(styledName, color, ANSI.bold)
	} else if (isGhostNode) {
		leftPart += style(styledName, ANSI.fg.brightRed)
	} else {
		leftPart += style(styledName, ANSI.fg.gray)
	}
	
	// Build right part (heat indicators) for hot items
	const showHeatIndicators = (isHot(node.heat) || isGhostNode) && node.depth > 0
	
	let rightPart = ''
	let rightLen = 0
	
	if (showHeatIndicators) {
		// Build heat indicator string: "MODIFIED 0s █████░ 60%"
		const parts = []
		const plainParts = []  // For length calculation
		
		// Event type
		const eventLabel = formatEventType(node.eventType)
		if (eventLabel) {
			const eventColor = isDeleted ? ANSI.fg.red : color
			parts.push(style(eventLabel, eventColor))
			plainParts.push(eventLabel)
		}
		
		// Time ago
		const timeAgo = formatTimeAgo(node.eventTime, now)
		if (timeAgo) {
			parts.push(style(timeAgo, ANSI.fg.gray))
			plainParts.push(timeAgo)
		}
		
		// Heat bar
		const bar = heatBar(node.heat)
		parts.push(style(bar, color))
		plainParts.push(bar)
		
		// Heat percentage
		const heatPct = Math.round(node.heat)
		const pctStr = `${heatPct}%`
		parts.push(style(pctStr, ANSI.fg.gray, ANSI.dim))
		plainParts.push(pctStr)
		
		rightPart = parts.join(' ')
		rightLen = plainParts.join(' ').length
	} else if (node.type === 'directory' && node.changeCount > 0 && node.depth > 0) {
		// Show change count for directories with activity
		const countStr = `(${node.changeCount} ${node.changeCount === 1 ? 'change' : 'changes'})`
		rightPart = style(countStr, ANSI.fg.gray, ANSI.dim)
		rightLen = countStr.length
	}
	
	// Calculate padding to right-align
	const minGap = 2  // Minimum space between name and heat info
	const availableForPadding = maxWidth - leftLen - rightLen - minGap
	const padding = Math.max(minGap, availableForPadding + minGap)
	
	// Combine parts
	if (rightPart) {
		return leftPart + ' '.repeat(padding) + rightPart
	}
	return leftPart
}

/**
 * Render the header
 * @param {string} watchPath - Path being watched
 * @param {object} termSize - Terminal size
 * @param {object} gitStatus - GitStatus instance (optional)
 * @returns {string[]} Header lines
 */
function renderHeader(watchPath, termSize, gitStatus = null) {
	let title = style('watching: ', ANSI.fg.gray) + style(watchPath, ANSI.fg.cyan, ANSI.bold)
	
	// Add git ahead/behind info
	if (gitStatus) {
		const aheadBehind = gitStatus.getAheadBehind()
		if (aheadBehind) {
			const abColor = ANSI.fg[aheadBehind.color] || ANSI.fg.gray
			title += '  ' + style(aheadBehind.text, abColor)
		}
	}
	
	return [title, '']
}

/**
 * Render the footer
 * @param {object} layout - Layout result
 * @param {object} gitStatus - GitStatus instance (optional)
 * @returns {string[]} Footer lines
 */
function renderFooter(layout, gitStatus = null) {
	const parts = []
	
	if (layout.collapsed) {
		parts.push(style('(some items collapsed to fit)', ANSI.fg.yellow, ANSI.dim))
	}
	
	// Show git status summary if available
	if (gitStatus && gitStatus.hasChanges()) {
		const counts = gitStatus.getCounts()
		const statusParts = []
		
		if (counts.staged > 0) {
			statusParts.push(style(`●${counts.staged}`, ANSI.fg.green))
		}
		if (counts.unstaged > 0) {
			statusParts.push(style(`✚${counts.unstaged}`, ANSI.fg.yellow))
		}
		if (counts.untracked > 0) {
			statusParts.push(style(`…${counts.untracked}`, ANSI.fg.gray))
		}
		if (counts.conflict > 0) {
			statusParts.push(style(`✖${counts.conflict}`, ANSI.fg.red))
		}
		
		if (statusParts.length > 0) {
			parts.push(statusParts.join(' '))
		}
	}
	
	return [parts.join('  ')]
}

/**
 * Full render - clears screen and renders entire tree
 * @param {object} layout - Layout result from generateLayout
 * @param {string} watchPath - Path being watched
 * @param {object} gitStatus - GitStatus instance (optional)
 */
export function render(layout, watchPath, gitStatus = null) {
	const now = Date.now()
	const { rows, cols } = layout.terminalSize
	
	// Clear screen and move to home
	clearScreen()
	
	// Render header
	const headerLines = renderHeader(watchPath, layout.terminalSize, gitStatus)
	headerLines.forEach((line, i) => {
		writeLine(i + 1, line)
	})
	
	// Render tree nodes
	let currentRow = LAYOUT_CONFIG.headerRows + 1
	
	// Track directories with hidden children to show "more" indicator
	const dirsWithHidden = new Map()
	for (const node of layout.nodes) {
		if (node.type === 'directory' && node.hiddenChildCount > 0) {
			dirsWithHidden.set(node.path, {
				count: node.hiddenChildCount,
				parentContinues: node.parentContinues,
				depth: node.depth,
			})
		}
	}
	
	for (let i = 0; i < layout.nodes.length; i++) {
		const node = layout.nodes[i]
		const nextNode = layout.nodes[i + 1]
		
		// Get git status for this node
		const nodeGitStatus = gitStatus?.getStatus(node.path, node.type) || null
		
		// Main node line
		const line = renderNodeLine(node, now, cols, nodeGitStatus)
		writeLine(currentRow, line)
		currentRow++
		
		// Check if we need to render "more" indicator after this node
		// This happens when current node is child of a dir with hiddenChildCount
		// and next node is NOT a child of that same dir
		for (const [dirPath, info] of dirsWithHidden) {
			const isChildOfDir = node.path.startsWith(dirPath + '/') && node.path !== dirPath
			const nextIsChildOfDir = nextNode && nextNode.path.startsWith(dirPath + '/') && nextNode.path !== dirPath
			
			if (isChildOfDir && !nextIsChildOfDir) {
				// Build prefix for the "more" line
				let morePrefix = ''
				const newParentContinues = [...info.parentContinues, true]
				for (let j = 0; j < newParentContinues.length; j++) {
					if (newParentContinues[j]) {
						morePrefix += BOX.vertical + '   '
					} else {
						morePrefix += '    '
					}
				}
				morePrefix += '    ' // Indent under last child
				
				const moreText = `⋮ +${info.count} more`
				const moreLine = morePrefix + style(moreText, ANSI.fg.gray, ANSI.dim)
				writeLine(currentRow, moreLine)
				currentRow++
			}
		}
	}
	
	// Clear remaining lines
	const availableRows = rows - LAYOUT_CONFIG.footerRows
	while (currentRow <= availableRows) {
		writeLine(currentRow, '')
		currentRow++
	}
	
	// Render footer
	const footerLines = renderFooter(layout, gitStatus)
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
 * @param {object} gitStatus - GitStatus instance (optional)
 */
export function flashChanges(layout, changedPaths, gitStatus = null) {
	const now = Date.now()
	
	for (let i = 0; i < layout.nodes.length; i++) {
		const node = layout.nodes[i]
		if (changedPaths.has(node.path)) {
			const row = getNodeRow(layout.nodes, i)
			const nodeGitStatus = gitStatus?.getStatus(node.path, node.type) || null
			const line = renderNodeLine(node, now, layout.terminalSize.cols, nodeGitStatus)
			
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
	let gitStatusRef = null
	
	return {
		/**
		 * Set git status reference
		 * @param {object} gitStatus - GitStatus instance
		 */
		setGitStatus(gitStatus) {
			gitStatusRef = gitStatus
		},
		
		/**
		 * Render the tree
		 * @param {object} layout - Layout result
		 * @param {object} gitStatus - GitStatus instance (optional, uses stored ref if not provided)
		 */
		render(layout, gitStatus = null) {
			lastLayout = layout
			render(layout, watchPath, gitStatus || gitStatusRef)
		},
		
		/**
		 * Get last rendered layout
		 */
		getLastLayout() {
			return lastLayout
		},
	}
}

