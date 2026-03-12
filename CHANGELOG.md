# Changelog

All notable changes to this project will be documented in this file.

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
