// Renderer - chalk output with colors, box-drawing, and in-place updates

import { 
	chalk,
	CURSOR,
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
	hyperlink,
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
 * Map color names to chalk functions
 */
const colorMap = {
	black: chalk.black,
	red: chalk.red,
	green: chalk.green,
	yellow: chalk.yellow,
	blue: chalk.blue,
	magenta: chalk.magenta,
	cyan: chalk.cyan,
	white: chalk.white,
	gray: chalk.gray,
	brightRed: chalk.redBright,
	brightGreen: chalk.greenBright,
	brightYellow: chalk.yellowBright,
	brightBlue: chalk.blueBright,
	brightMagenta: chalk.magentaBright,
	brightCyan: chalk.cyanBright,
	brightWhite: chalk.whiteBright,
}

/**
 * Map background color names to chalk functions
 */
const bgColorMap = {
	black: chalk.bgBlack,
	red: chalk.bgRed,
	green: chalk.bgGreen,
	yellow: chalk.bgYellow,
	blue: chalk.bgBlue,
	magenta: chalk.bgMagenta,
	cyan: chalk.bgCyan,
	white: chalk.bgWhite,
}

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
 * Get chalk color function from color name
 * @param {string} colorName - Color name from heat module
 * @returns {function} Chalk color function
 */
function getChalkColor(colorName) {
	return colorMap[colorName] || chalk.white
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
	
	const colorFn = colorMap[gitStatus.color] || chalk.gray
	return colorFn(gitStatus.symbol + ' ')
}

/**
 * Render a single node line
 * @param {object} node - Layout node
 * @param {number} now - Current timestamp
 * @param {number} maxWidth - Maximum line width
 * @param {object} gitStatus - Git status object (optional)
 * @param {object} filterMatch - Filter match result { match: true, type: 'glob'|'text' } or false
 * @param {string} filterPattern - Filter pattern for highlighting (optional)
 * @returns {string} Rendered line
 */
function renderNodeLine(node, now, maxWidth, gitStatus = null, filterMatch = false, filterPattern = '') {
	const prefix = renderTreePrefix(node)
	
	// Determine styling based on state
	const isDeleted = node.eventType === 'unlink' || node.eventType === 'unlinkDir'
	const isGhostNode = node.isGhost
	// Prioritize git status color, fall back to heat color
	const colorName = gitStatus?.color || getHeatColor(node.heat)
	const colorFn = getChalkColor(colorName)
	
	// Build name with type indicator
	let displayName = node.name
	if (node.type === 'directory') {
		displayName += '/'
	}
	if (node.collapsed) {
		displayName += '...'
	}
	
	// Apply filter highlight if filterMatch provided
	if (filterMatch && filterMatch.match) {
		displayName = highlightMatch(displayName, filterPattern, filterMatch.type)
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
	let coloredName
	if ((hasGitStatus || isHot(node.heat)) && !isGhostNode) {
		coloredName = colorFn.bold(styledName)
	} else if (isGhostNode) {
		coloredName = chalk.redBright(styledName)
	} else {
		coloredName = chalk.gray(styledName)
	}
	
	// Wrap name in clickable hyperlink (OSC 8)
	const fileUrl = 'file://' + node.path
	leftPart += hyperlink(coloredName, fileUrl)
	
	// Build right part (heat indicators) for hot items
	const showHeatIndicators = (isHot(node.heat) || isGhostNode) && node.depth > 0
	
	let rightPart = ''
	let rightLen = 0
	
	if (showHeatIndicators) {
		// Build heat indicator string: "MODIFIED 0s █████░"
		const parts = []
		const plainParts = []  // For length calculation
		
		// Event type
		const eventLabel = formatEventType(node.eventType)
		if (eventLabel) {
			const eventColorFn = isDeleted ? chalk.red : colorFn
			parts.push(eventColorFn(eventLabel))
			plainParts.push(eventLabel)
		}
		
		// Time ago
		const timeAgo = formatTimeAgo(node.eventTime, now)
		if (timeAgo) {
			parts.push(chalk.gray(timeAgo))
			plainParts.push(timeAgo)
		}
		
		// Heat bar (always uses heat color, independent of git)
		const bar = heatBar(node.heat)
		const heatColorFn = getChalkColor(getHeatColor(node.heat))
		parts.push(heatColorFn(bar))
		plainParts.push(bar)
		
		rightPart = parts.join(' ')
		rightLen = plainParts.join(' ').length
	} else if (node.type === 'directory' && node.changeCount > 0 && node.depth > 0) {
		// Show change count for directories with activity
		const countStr = `(${node.changeCount} ${node.changeCount === 1 ? 'change' : 'changes'})`
		rightPart = chalk.gray.dim(countStr)
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
	let title = chalk.gray('watching: ') + chalk.cyan.bold(watchPath)
	
	// Add git ahead/behind info
	if (gitStatus) {
		const aheadBehind = gitStatus.getAheadBehind()
		if (aheadBehind) {
			const abColorFn = colorMap[aheadBehind.color] || chalk.gray
			title += '  ' + abColorFn(aheadBehind.text)
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
		parts.push(chalk.yellow.dim('(some items collapsed to fit)'))
	}
	
	// Show git status summary if available
	if (gitStatus && gitStatus.hasChanges()) {
		const counts = gitStatus.getCounts()
		const statusParts = []
		
		if (counts.staged > 0) {
			statusParts.push(chalk.green(`●${counts.staged}`))
		}
		if (counts.unstaged > 0) {
			statusParts.push(chalk.yellow(`✚${counts.unstaged}`))
		}
		if (counts.untracked > 0) {
			statusParts.push(chalk.gray(`…${counts.untracked}`))
		}
		if (counts.conflict > 0) {
			statusParts.push(chalk.red(`✖${counts.conflict}`))
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
	
	// Render tree lines (weight-based selection already done by layout)
	let currentRow = LAYOUT_CONFIG.headerRows + 1
	
	// Use lines array if available (new system), fall back to nodes (backward compat)
	const linesToRender = layout.lines || layout.nodes.map(n => ({ lineType: 'node', node: n }))
	
	for (const line of linesToRender) {
		if (line.lineType === 'node') {
			const node = line.node
			const nodeGitStatus = gitStatus?.getStatus(node.path, node.type) || null
			const filterMatch = line.filterMatch || false
			const renderedLine = renderNodeLine(node, now, cols, nodeGitStatus, filterMatch)
			writeLine(currentRow, renderedLine)
		}
		// Future: handle other line types like 'more-indicator'
		currentRow++
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
			writeLine(row, chalk.greenBright(RENDER_CONFIG.updateChar + ' ') + line)
		}
	}
}

/**
 * Highlight matched name based on match type
 * - Glob matches: dim cyan background on entire name
 * - Text matches: dim yellow background on matched portion only
 * @param {string} name - The name to highlight
 * @param {string} pattern - Filter pattern
 * @param {string} matchType - 'glob' or 'text'
 * @returns {string} Name with highlighted match
 */
function highlightMatch(name, pattern, matchType) {
	if (!pattern) return name
	
	// Glob matches: dim cyan background on entire name
	if (matchType === 'glob') {
		return chalk.bgCyan.dim.black(name)
	}
	
	// Text matches: dim yellow background on matched portion only
	let searchPattern = pattern.replace(/^\//, '').replace(/\/$/, '')
	
	// For path patterns, use last segment to find match in name
	// e.g., "/lib/re" -> search for "re" in "renderer.mjs"
	if (searchPattern.includes('/')) {
		const segments = searchPattern.split('/')
		searchPattern = segments[segments.length - 1]
	}
	
	const lowerName = name.toLowerCase()
	const matchIndex = lowerName.indexOf(searchPattern.toLowerCase())
	
	if (matchIndex === -1) {
		// No match found in name - return unhighlighted
		return name
	}
	
	const before = name.slice(0, matchIndex)
	const match = name.slice(matchIndex, matchIndex + searchPattern.length)
	const after = name.slice(matchIndex + searchPattern.length)
	
	// Dim yellow background for matched part only
	const highlighted = chalk.bgYellow.dim.black(match)
	return before + highlighted + after
}

/**
 * Full render with interactive features (cursor, filter)
 * @param {object} layout - Layout result from generateLayout
 * @param {string} watchPath - Path being watched
 * @param {object} gitStatus - GitStatus instance (optional)
 * @param {object} interactive - { cursorIndex, filterMode, filterPattern }
 */
function renderWithInteractive(layout, watchPath, gitStatus = null, interactive = {}) {
	const { cursorIndex = -1, filterMode = false, filterPattern = '' } = interactive
	const now = Date.now()
	const { rows, cols } = layout.terminalSize
	
	// Clear screen and move to home
	clearScreen()
	
	// Render header
	const headerLines = renderHeader(watchPath, layout.terminalSize, gitStatus)
	headerLines.forEach((line, i) => {
		writeLine(i + 1, line)
	})
	
	// Render tree lines
	let currentRow = LAYOUT_CONFIG.headerRows + 1
	
	const linesToRender = layout.lines || layout.nodes.map(n => ({ lineType: 'node', node: n }))
	
	for (let i = 0; i < linesToRender.length; i++) {
		const line = linesToRender[i]
		const isCursor = i === cursorIndex
		
		if (line.lineType === 'node') {
			const node = line.node
			const nodeGitStatus = gitStatus?.getStatus(node.path, node.type) || null
			const filterMatch = line.filterMatch || false
			let renderedLine = renderNodeLine(node, now, cols, nodeGitStatus, filterMatch, filterPattern)
			
			// Apply cursor underline (white underline, no background)
			if (isCursor) {
				renderedLine = chalk.underline(renderedLine)
			}
			
			writeLine(currentRow, renderedLine)
		}
		currentRow++
	}
	
	// Clear remaining lines (but leave room for filter input if active)
	const footerStart = rows - LAYOUT_CONFIG.footerRows - (filterMode ? 1 : 0)
	while (currentRow <= footerStart) {
		writeLine(currentRow, '')
		currentRow++
	}
	
	// Render filter input if active
	if (filterMode) {
		const filterLine = chalk.cyan.bold('/') + filterPattern + chalk.gray('_')
		writeLine(rows - LAYOUT_CONFIG.footerRows, filterLine)
	}
	
	// Render footer
	const footerLines = renderFooter(layout, gitStatus)
	footerLines.forEach((line, i) => {
		writeLine(rows - LAYOUT_CONFIG.footerRows + i + 1, line)
	})
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
		 * @param {object} interactive - Interactive state { cursorIndex, filterMode, filterPattern }
		 */
		render(layout, gitStatus = null, interactive = {}) {
			lastLayout = layout
			renderWithInteractive(layout, watchPath, gitStatus || gitStatusRef, interactive)
		},
		
		/**
		 * Get last rendered layout
		 */
		getLastLayout() {
			return lastLayout
		},
	}
}

