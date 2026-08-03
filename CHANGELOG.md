# Changelog

All notable changes to SC64 SD Card Builder.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.6.9] - 2026-08-03

### Added

- Themes - Gallery Glass is the default; glass variants listed first in the theme menu; README lists all 14 themes

### Infra

- README - v0.6.8, 14 themes, full OS artifact tables, upstream repo links

[Compare v0.6.8...v0.6.9](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.6.8...v0.6.9)

## [v0.6.8] - 2026-08-03

### Added

- Themes - Gallery Glass family (Black, Green, Blue, Red, Orange, Purple) with glassmorphism on all surfaces and a shuffle-background button

[Compare v0.6.7...v0.6.8](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.6.7...v0.6.8)

## [v0.6.7] - 2026-08-03

### Fixed

- Keep the title bar menus above the content so dropdowns are not clipped

[Compare v0.6.6...v0.6.7](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.6.6...v0.6.7)

## [v0.6.6] - 2026-08-03

### Added

- Themes - add Gallery (random bundled background) plus Royal, Candy and Paper app themes

[Compare v0.6.5...v0.6.6](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.6.5...v0.6.6)

## [v0.6.5] - 2026-08-03

### Added

- Preview - add 6 retro background themes and shrink bundled images to display resolution

### Infra

- Enable maximum installer compression

[Compare v0.6.4...v0.6.5](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.6.4...v0.6.5)

## [v0.6.4] - 2026-08-03

### Fixed

- Preview - truncate long filenames before the file size in the detail area

[Compare v0.6.3...v0.6.4](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.6.3...v0.6.4)

## [v0.6.3] - 2026-08-03

### Fixed

- Preview - render all text white so it stays readable over backgrounds

[Compare v0.6.2...v0.6.3](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.6.2...v0.6.3)

## [v0.6.2] - 2026-08-03

### Added

- Preview - show a random bundled background per selected ROM

[Compare v0.6.1...v0.6.2](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.6.1...v0.6.2)

## [v0.6.1] - 2026-08-03

### Fixed

- Preview - remove redundant row sizes and render the card's menu background

[Compare v0.6.0...v0.6.1](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.6.0...v0.6.1)

## [v0.6.0] - 2026-08-03

### Added

- Add faithful N64FlashCartMenu console preview with boxart and metadata

[Compare v0.5.3...v0.6.0](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.5.3...v0.6.0)

## [v0.5.3] - 2026-08-03

### Fixed

- Relaunch portable build from original exe so the elevated instance keeps its updater

[Compare v0.5.2...v0.5.3](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.5.2...v0.5.3)

## [v0.5.2] - 2026-08-03

### Fixed

- Run elevated Linux instance with --no-sandbox

[Compare v0.5.1...v0.5.2](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.5.1...v0.5.2)

## [v0.5.1] - 2026-08-03

### Fixed

- Make run-as-admin badge request elevation and restart

### Infra

- List supported languages in README

[Compare v0.5.0...v0.5.1](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.5.0...v0.5.1)

## [v0.5.0] - 2026-08-03

### Added

- 64DD IPL install

[Compare v0.4.1...v0.5.0](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.4.1...v0.5.0)

## [v0.4.1] - 2026-08-03

### Fixed

- No GNOME 'not closed properly' dialog after deb update (disable auto-relaunch)

[Compare v0.4.0...v0.4.1](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.4.0...v0.4.1)

## [v0.4.0] - 2026-08-03

### Added

- Inspect existing card (menu version, ROM/save counts, free space)

[Compare v0.3.1...v0.4.0](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.3.1...v0.4.0)

## [v0.3.1] - 2026-08-03

### Fixed

- No confirm-destination popup for a saved folder at startup

[Compare v0.3.0...v0.3.1](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.3.0...v0.3.1)

## [v0.3.0] - 2026-08-03

### Added

- Validate N64 ROMs before copying

[Compare v0.2.5...v0.3.0](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.2.5...v0.3.0)

## [v0.2.5] - 2026-08-02

### Fixed

- Install to space-free path so Chromium SUID sandbox works on Ubuntu 24.04+

### Infra

- Add troubleshooting section for sandbox and unsigned builds
- Set release title from tag name

[Compare v0.2.4...v0.2.5](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.2.4...v0.2.5)

## [v0.2.4] - 2026-08-02

### Fixed

- Set chrome-sandbox setuid on install so Linux app does not abort with SIGTRAP
- Keep window responsive while extracting and copying files

[Compare v0.2.3...v0.2.4](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.2.3...v0.2.4)

## [v0.2.3] - 2026-08-02

### Added

- Pre-flight safety for destination and formatting

### Fixed

- Publish releases from CI only to avoid asset races

[Compare v0.2.2...v0.2.3](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.2.2...v0.2.3)

## [v0.2.2] - 2026-08-02

### Added

- Show app version in the title bar

### Infra

- Add Vitest scaffold with CI gate
- Cover all supported platforms in README

[Compare v0.2.1...v0.2.2](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.2.1...v0.2.2)

## [v0.2.1] - 2026-08-02

### Added

- Add categorized changelog generation

### Fixed

- GH_TOKEN for multi-arch portable cleanup step

### Infra

- Source GitHub release notes from CHANGELOG.md
- Pin upload-artifact to node24 commit, silencing Node 20 deprecation
- Bump workflow actions to v5, build with Node 24

[Compare v0.1.6...v0.2.1](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.1.6...v0.2.1)

## [v0.1.6] - 2026-08-02

### Changed

- Drop HTML scraping from release lookups, use redirect-based update check
- Delete multi-arch portable from release after packaging

[Compare v0.1.5...v0.1.6](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.1.5...v0.1.6)

## [v0.1.5] - 2026-08-02

### Changed

- Use batch file for portable self-update, drop redundant multi-arch artifact

[Compare v0.1.4...v0.1.5](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.1.4...v0.1.5)

## [v0.1.4] - 2026-08-02

### Changed

- Stop using GitHub API for release checks

[Compare v0.1.3...v0.1.4](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.1.3...v0.1.4)

## [v0.1.3] - 2026-08-02

### Changed

- Use app logo in main window header

### Fixed

- Portable build self-update

[Compare v0.1.2...v0.1.3](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.1.2...v0.1.3)

## [v0.1.2] - 2026-08-02

### Added

- Rpm and pacman Linux packages
- Cross-platform CI releases

### Infra

- Install bsdtar for pacman target on CI

[Compare v0.1.1...v0.1.2](https://github.com/exusxt/SC64_SD_Card_Builder/compare/v0.1.1...v0.1.2)

## [v0.1.1] - 2026-08-02

### Added

- One-command release automation
- SC64 SD Card Builder application
- Initial commit

### Other

- Handle empty GitHub releases during update check
