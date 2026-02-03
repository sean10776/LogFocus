# Change Log

All notable changes to the "LogFocus" extension will be documented in this file.

## [0.3.0] - 2026-02-03

### Added
- **Global Extension Toggle**: New status bar button with `Ctrl+Alt+L` shortcut to enable/disable the entire extension
- **Double-Click to Edit**: Click filter items to directly open edit mode
- **Smart Analysis Caching**: Filters now track analyzed URIs to prevent redundant rescans
- **Core Engine Tests**: 4 new tests validating priority matching and focus mode content logic

### Fixed
- **Focus Mode Highlighting**: Complete overhaul using unified `performCombinedAnalysis` engine
  - Resolved line offset bug causing highlights to shift by one line
  - Priority-based coloring now works identically in both normal and focus views
- **Performance**: Removed redundant line-mapping logic, drastically improving large file performance

### Changed
- **Simplified UI**: Removed redundant "Toggle Filtering Mode" button
- **Dynamic Icons**: Toggle highlight button now shows different icons based on state (lit/unlit)
- **Cleaner Architecture**: Removed project-level `filteringEnabled` in favor of global toggle

### Removed
- Project-level filtering toggle (replaced by global extension toggle)
- Deprecated `toggleFilteringMode` command and related code

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
