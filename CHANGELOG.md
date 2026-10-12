# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Manual directory fold/unfold with Ctrl+Up (fold) and Ctrl+Down (unfold)
- Clickable `[▶]`/`[▼]` toggle indicators on every directory line (yellow folded, cyan open)
- Shift+click on directories to hide them entirely from the tree
- Escape clears manual folds, manual opens, and hidden dirs (in addition to filter)
- `manualOpens` Set to override auto-collapse for user-opened directories
- Mouse tracking enabled in all interactive modes (not just markdown preview)

### Fixed

- Mouse click prefix length calculation now uses correct `* 2 + 2` (was `* 4 + 4` after tree indent tightening)
