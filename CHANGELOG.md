# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.1.16] - 2026-07-24

### Added
- `resolvedBuild` on `resolve_bug` / `batch_resolve_my_bugs` (maps to ZenTao 解决版本)
- Env `ZENTAO_DEFAULT_RESOLVED_BUILD` (default `trunk`) when tool args omit `resolvedBuild`
- API error body is included in HTTP failure messages (e.g. `resolvedBuild: 『解决版本』不能为空。`)

### Changed
- Resolve always sends `resolvedBuild` on `POST /bugs/{id}/resolve` so instances that require 解决版本 stop returning opaque 400
- Error hints call out missing 解决版本 and warn against substituting PUT/edit for resolve

### Fixed
- Resolve failures that only said `Request failed 400` with a misleading productId hint when the real cause was empty `resolvedBuild`

## [0.1.15]

### Added
- Structured `solutionModules` for `resolve_bug` and `batch_resolve_my_bugs`:
  - `rootCause` / `fixApproach` / `logicChange` / `impact`
  - Server formats modules into multi-line text with 【根因】【修复思路】【改动逻辑】【影响范围】
- Shared helper module `src/solution.js`

### Changed
- Plain-text `solution` remains supported for compatibility; when both are provided, non-empty `solutionModules` wins
- Tool schemas and docs now steer MCP clients toward structured solution modules

### Fixed
- `scripts/release-npm.sh` no longer treats npm upgrade notices as part of `npm whoami` username during publish ownership checks

## [0.1.9] - 2024-03-12

### Added
- Debug logging support via `ZENTAO_DEBUG` environment variable
- Security warning for HTTP connections
- JSDoc type annotations for better IDE support
- MIT License file
- Node.js version requirement in package.json (>=18.0.0)

### Changed
- Fixed version inconsistency between package.json and server initialization
- Locked dependency version for @modelcontextprotocol/sdk to ^1.27.1
- Changed license from UNLICENSED to MIT
- Extracted magic numbers and strings to constants
- Improved error messages with debug context

### Fixed
- Server version now correctly reads from package.json
- HTTP security warning now displays when using insecure connections

## [0.1.8] - Previous

### Fixed
- Bug fixes and improvements

## [0.1.7] - Previous

### Added
- Initial release with core functionality
