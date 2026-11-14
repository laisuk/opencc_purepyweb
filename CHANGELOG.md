# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

---

## \[1.0.1]

### Changed

- Update pyodide to v314.0.8

---

## \[1.0.0] - 2026-11-14

### Added

- Initial public release of **opencc_purepyweb**, powered by Opencc PurePy 1.5.2 and Pyodide 0.27.7.
- Browser-based Chinese text conversion with 24 OpenCC configurations.
- Custom dictionary management with 25 dictionary slots, Append/Override modes, and Apply/Reset functionality.
- Office and EPUB conversion supporting DOCX, XLSX, PPTX, and EPUB.
- Text file support with automatic CJK encoding detection and manual encoding selection.
- Unicode compatibility normalization, DeTofu, punctuation conversion, and GB mojibake repair.
- Dual CodeMirror editors with character counts, line numbers, and clipboard operations.
- Responsive interface with System, Light, and Dark themes.
- Explicit Pyodide initialization and conversion diagnostics.
- Smoke tests and large-text conversion testing.
- GitHub Pages deployment workflow.

### Notes

- All text and document conversions run locally in the browser using Python on WebAssembly.
- No server-side conversion backend or file uploads are required.
- Pyodide runtime assets and Python packages may require network access during initialization.