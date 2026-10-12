// Config file loader — reads global + project configs and merges them

import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Read and parse a JSON config file. Returns {} on missing file,
 * logs a warning and returns {} on malformed JSON.
 */
function readConfigFile(filePath) {
	try {
		const raw = readFileSync(filePath, 'utf-8')
		return JSON.parse(raw)
	} catch (err) {
		if (err.code === 'ENOENT') return {}
		if (err instanceof SyntaxError) {
			process.stderr.write(`Warning: malformed JSON in ${filePath}, skipping\n`)
			return {}
		}
		return {}
	}
}

// Keys that are valid in config files (not path or quick — those are per-invocation)
const VALID_KEYS = new Set([
	'markdownPreview', 'history', 'ignore', 'interval',
	'breathe', 'ghostSteps', 'git', 'loopcheck',
])

/**
 * Load and merge config: global (~/.config/fstop/config.json) then project (.fstop.json).
 * Only keeps recognized keys. `ignore` arrays are concatenated (additive).
 * @param {string} projectRoot - Absolute path to the watched directory
 * @returns {object} Merged config (only explicitly-set keys)
 */
export function loadConfig(projectRoot) {
	const globalPath = join(homedir(), '.config', 'fstop', 'config.json')
	const projectPath = join(projectRoot, '.fstop.json')

	const globalCfg = readConfigFile(globalPath)
	const projectCfg = readConfigFile(projectPath)

	const merged = {}

	for (const cfg of [globalCfg, projectCfg]) {
		for (const [key, value] of Object.entries(cfg)) {
			if (!VALID_KEYS.has(key)) continue
			if (key === 'ignore') {
				// Additive: accumulate ignore patterns
				if (Array.isArray(value)) {
					merged.ignore = (merged.ignore || []).concat(value)
				}
			} else {
				merged[key] = value
			}
		}
	}

	return merged
}
