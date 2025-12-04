# Change Log

All notable changes to the "LogFocus" extension will be documented in this file.

## [0.2.0] - 2025-12-05

### Added
- Update interface refactoring with single responsibility principle
- Focus Mode decoration management separated from content generation
- Helper methods for Focus Mode decoration calculation
- Import/Export project functionality
- Output Channel for debugging with filter and cache statistics
- Cache statistics API

### Fixed
- Tree view count now updates correctly when switching between editors
- Focus Mode decorations now apply at the correct timing after content refresh
- Removed redundant tree view update calls throughout the codebase
- Project menu context showing correct commands
- Color scheme for better visibility
- Settings persistence to prevent state corruption
- Project refresh memory leaks
- Focus Mode filter count calculation

### Changed
- Improved architecture with clear separation of concerns (FocusProvider, Commands, Filter)
- Optimized Focus Mode decoration application performance
- Consolidated tree view updates into single refresh point
- Focus Mode processing for better performance
- Filter decoration logic simplification

## 0.1.0 - 2025-11-24
- Initial release
