// Terminal utilities - size detection, cursor control, ANSI helpers

// ANSI escape codes
export const ANSI = {
	// Cursor control
	home: '\x1b[H',
	clearScreen: '\x1b[2J',
	clearLine: '\x1b[K',
	clearDown: '\x1b[J',
	hideCursor: '\x1b[?25l',
	showCursor: '\x1b[?25h',
	
	
	// Cursor positioning
	moveTo: (row, col) => `\x1b[${row};${col}H`,
	moveUp: (n = 1) => `\x1b[${n}A`,
	moveDown: (n = 1) => `\x1b[${n}B`,
	moveRight: (n = 1) => `\x1b[${n}C`,
	moveLeft: (n = 1) => `\x1b[${n}D`,
	saveCursor: '\x1b[s',
	restoreCursor: '\x1b[u',
	
	// Text styling
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	italic: '\x1b[3m',
	underline: '\x1b[4m',
	strikethrough: '\x1b[9m',
	
	// Colors
	fg: {
		black: '\x1b[30m',
		red: '\x1b[31m',
		green: '\x1b[32m',
		yellow: '\x1b[33m',
		blue: '\x1b[34m',
		magenta: '\x1b[35m',
		cyan: '\x1b[36m',
		white: '\x1b[37m',
		gray: '\x1b[90m',
		brightRed: '\x1b[91m',
		brightGreen: '\x1b[92m',
		brightYellow: '\x1b[93m',
		brightBlue: '\x1b[94m',
		brightMagenta: '\x1b[95m',
		brightCyan: '\x1b[96m',
		brightWhite: '\x1b[97m',
	},
	bg: {
		black: '\x1b[40m',
		red: '\x1b[41m',
		green: '\x1b[42m',
		yellow: '\x1b[43m',
		blue: '\x1b[44m',
		magenta: '\x1b[45m',
		cyan: '\x1b[46m',
		white: '\x1b[47m',
	},
}

// Get terminal dimensions
export function getTerminalSize() {
	return {
		rows: process.stdout.rows || 24,
		cols: process.stdout.columns || 80,
	}
}

// Listen for terminal resize events
export function onResize(callback) {
	process.stdout.on('resize', () => {
		callback(getTerminalSize())
	})
}

// Write to stdout without newline
export function write(text) {
	process.stdout.write(text)
}

// Write a line at a specific row (1-indexed)
export function writeLine(row, text) {
	write(ANSI.moveTo(row, 1) + ANSI.clearLine + text)
}

// Clear the entire screen and move cursor home
export function clearScreen() {
	write(ANSI.clearScreen + ANSI.home)
}

// Hide cursor for cleaner rendering
export function hideCursor() {
	write(ANSI.hideCursor)
}

// Show cursor
export function showCursor() {
	write(ANSI.showCursor)
}

// Apply styles to text
export function style(text, ...styles) {
	if (styles.length === 0) return text
	return styles.join('') + text + ANSI.reset
}

// Strikethrough text (for deleted items)
export function strikethrough(text) {
	return style(text, ANSI.strikethrough, ANSI.dim)
}

// Truncate text to fit width, adding ellipsis if needed
export function truncate(text, maxWidth) {
	if (text.length <= maxWidth) return text
	if (maxWidth <= 3) return text.slice(0, maxWidth)
	return text.slice(0, maxWidth - 1) + '…'
}

// Pad text to a specific width
export function padRight(text, width) {
	if (text.length >= width) return text
	return text + ' '.repeat(width - text.length)
}

// Strip ANSI codes for length calculation
export function stripAnsi(text) {
	return text.replace(/\x1b\[[0-9;]*m/g, '')
}

// Get visible length of text (excluding ANSI codes)
export function visibleLength(text) {
	return stripAnsi(text).length
}

// Setup terminal for full-screen app
export function setupTerminal() {
	hideCursor()
	clearScreen()
	
	// Handle graceful exit
	const cleanup = () => {
		showCursor()
		clearScreen()
		process.exit(0)
	}
	
	process.on('SIGINT', cleanup)
	process.on('SIGTERM', cleanup)
	
	// Return cleanup function for manual use
	return cleanup
}

// Box drawing characters for tree
export const BOX = {
	vertical: '│',
	horizontal: '─',
	corner: '└',
	tee: '├',
	space: ' ',
}

// Create a tree branch prefix
export function treeBranch(isLast, depth) {
	if (depth === 0) return ''
	const prefix = BOX.space.repeat((depth - 1) * 4)
	const branch = isLast ? BOX.corner : BOX.tee
	return prefix + branch + BOX.horizontal + BOX.horizontal + ' '
}

// Create vertical continuation lines for tree
export function treeVertical(depths) {
	let result = ''
	for (let i = 0; i < depths.length; i++) {
		if (depths[i]) {
			result += BOX.vertical + '   '
		} else {
			result += '    '
		}
	}
	return result
}

