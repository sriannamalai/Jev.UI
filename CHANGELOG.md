# Changelog

## [0.2.0] - 2026-09-23

### Added

- Full-screen terminal workbench with a persistent header, status, and relevant keyboard shortcuts.
- A Ctrl+P Actions menu with explanations for unavailable actions.
- Responsive State, Questions, and Results panes: side-by-side at 120 columns and wider, with tabs in smaller terminals.
- Pane scrolling, page navigation, Home/End controls, and terminal resize handling.
- A multiline state editor with explicit Text and JSON modes and validation before saving.
- Step-by-step question editing with progress and a single final save; cancelling discards the complete draft, including unfinished new questions.
- Direct JSON editing for structured question instructions and yes/no criteria.

### Changed

- Confirmation prompts support arrow keys and Enter alongside displayed shortcuts, with safe defaults for deleting and quitting.
- Result displays and help fit the available terminal space and support scrolling.
- README instructions now explain question identifiers, natural-language instructions, choice names, and the complete terminal keymap.
- Workspace package versions and the reported core version are synchronized at 0.2.0.

### Fixed

- Terminal entry and exit use the alternate screen so the shell is restored when the TUI closes.
- Choice and score editing preserve significant whitespace, empty strings, multiline values, literal structured placeholders, and quoted choice keys.
- Structured choice and score values retain their identity when entries are renamed or reordered.
- Prompt cancellation and pending quit flows preserve existing work and release their busy state.

### Release notes

This is the first tagged GitHub release. It includes the existing local web workbench, one-shot
`jev ask` CLI, question-set storage, request exports, and probability/confidence views alongside
the new terminal interface. Node.js 24 or later is required. Install by building from source as
described in the README; no standalone binary or npm publication is included.

Question identifiers continue to use identifier syntax. Natural-language questions belong in
Instructions; choice option names can include spaces. Structured choice descriptions and score
levels still use the full-request JSON editor for content changes.

[0.2.0]: https://github.com/sriannamalai/Jev.UI/releases/tag/v0.2.0
