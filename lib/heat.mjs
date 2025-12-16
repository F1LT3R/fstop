// Heat scoring system - event weights, time decay, directory propagation

// Event type weights (higher = more important to show)
export const EVENT_WEIGHTS = {
	unlink: 100,      // delete file
	unlinkDir: 100,   // delete directory
	add: 80,          // create file
	addDir: 80,       // create directory
	change: 60,       // modify file
	rename: 40,       // rename (if detected)
	default: 30,      // fallback
}

// Heat decay configuration
export const HEAT_CONFIG = {
	// Half-life in milliseconds (heat halves every this many ms)
	halfLife: 10000,
	// Maximum heat value
	maxHeat: 100,
	// Minimum heat to be considered "hot"
	hotThreshold: 20,
	// Heat multiplier for directory aggregation
	dirChildSumWeight: 0.1,
	// Number of heat bar segments
	barSegments: 6,
}

/**
 * Calculate heat score for a single node based on event type and time
 * @param {string} eventType - Type of event (add, change, unlink, etc.)
 * @param {number} eventTime - Timestamp when event occurred
 * @param {number} now - Current timestamp (default: Date.now())
 * @returns {number} Heat score (0-100)
 */
export function calculateHeat(eventType, eventTime, now = Date.now()) {
	if (!eventTime) return 0
	
	const weight = EVENT_WEIGHTS[eventType] || EVENT_WEIGHTS.default
	const elapsed = now - eventTime
	
	// Exponential decay: heat = weight * 2^(-elapsed/halfLife)
	const decay = Math.pow(2, -elapsed / HEAT_CONFIG.halfLife)
	const heat = weight * decay
	
	return Math.min(heat, HEAT_CONFIG.maxHeat)
}

/**
 * Calculate aggregated heat for a directory based on its children
 * @param {number[]} childHeats - Array of child heat values
 * @param {number} ownHeat - Directory's own heat (from direct events)
 * @returns {number} Aggregated heat score
 */
export function calculateDirHeat(childHeats, ownHeat = 0) {
	if (childHeats.length === 0) return ownHeat
	
	const maxChildHeat = Math.max(...childHeats)
	const sumChildHeat = childHeats.reduce((a, b) => a + b, 0)
	
	// Dir heat = max of children + fraction of sum (rewards many hot files)
	const aggregatedHeat = maxChildHeat + (sumChildHeat * HEAT_CONFIG.dirChildSumWeight)
	
	// Take max of own heat and aggregated heat
	return Math.min(Math.max(aggregatedHeat, ownHeat), HEAT_CONFIG.maxHeat)
}

/**
 * Check if a heat value is considered "hot"
 * @param {number} heat - Heat value to check
 * @returns {boolean}
 */
export function isHot(heat) {
	return heat >= HEAT_CONFIG.hotThreshold
}

/**
 * Generate a heat bar visualization
 * @param {number} heat - Heat value (0-100)
 * @returns {string} Heat bar string like "████░░"
 */
export function heatBar(heat) {
	const segments = HEAT_CONFIG.barSegments
	const filled = Math.round((heat / HEAT_CONFIG.maxHeat) * segments)
	const empty = segments - filled
	
	return '█'.repeat(filled) + '░'.repeat(empty)
}

/**
 * Format time elapsed since event
 * @param {number} eventTime - Timestamp when event occurred
 * @param {number} now - Current timestamp
 * @returns {string} Formatted time like "2s", "1m", "5m"
 */
export function formatTimeAgo(eventTime, now = Date.now()) {
	if (!eventTime) return ''
	
	const elapsed = now - eventTime
	const seconds = Math.floor(elapsed / 1000)
	const minutes = Math.floor(seconds / 60)
	
	if (seconds < 60) return `${seconds}s`
	if (minutes < 60) return `${minutes}m`
	return `${Math.floor(minutes / 60)}h`
}

/**
 * Get color based on heat level
 * Returns ANSI color code name for use with terminal module
 * @param {number} heat - Heat value (0-100)
 * @returns {string} Color name: 'brightRed', 'red', 'yellow', 'gray'
 */
export function getHeatColor(heat) {
	if (heat >= 80) return 'brightRed'
	if (heat >= 60) return 'red'
	if (heat >= 40) return 'magenta'
	if (heat >= 20) return 'cyan'
	return 'blue'
}

/**
 * Compare two nodes by heat (for sorting)
 * Higher heat = higher priority (comes first)
 * @param {object} a - Node with heat property
 * @param {object} b - Node with heat property
 * @returns {number} Comparison result
 */
export function compareByHeat(a, b) {
	return b.heat - a.heat
}

/**
 * Compare by heat ascending (coldest first, for collapse candidates)
 * @param {object} a - Node with heat property
 * @param {object} b - Node with heat property
 * @returns {number} Comparison result
 */
export function compareByHeatAsc(a, b) {
	return a.heat - b.heat
}

