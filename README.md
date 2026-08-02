# SC64 SD Card Builder

Prepare an SD card for the SummerCart64 (N64FlashcartMenu). Cross-platform Electron app for Windows, macOS and Linux, with 18 languages and 4 themes.

## Supported platforms

| Platform | Architectures | Installers | Update channel |
|----------|---------------|------------|----------------|
| Windows | x64, arm64 | NSIS installer + portable `.exe` | `latest.yml` (installed) / in-app portable replace |
| macOS | x64, arm64 | `.dmg` + `.zip` | `latest-mac.yml` |
| Linux | x64, arm64 | AppImage, `.deb`, `.rpm`, `.pacman` | `latest-linux.yml` |

All artifacts are published to the [Releases page](https://github.com/exusxt/SC64_SD_Card_Builder/releases).

## Features

- Detect SD cards, verify FAT32, format large cards (>32 GB) as FAT32 (requires admin)
- **Pre-flight safety**: formatting requires typing the drive letter to confirm, and the destination must be confirmed when typed by hand; overlapping source/destination folders are rejected before anything is written
- Install the latest N64FlashcartMenu, boxart/metadata pack and emulators onto the card
- Copy your own ROMs while preserving folder structure (optional save folders, file-type filter)
- **Prepared-folder flow**: stage a build or copy an already-prepared folder (e.g. from a friend) to the card with an animated transfer view
- **Byte-for-byte verification** of every copied file (optional)
- Auto-updates via GitHub Releases
- 18 languages · 4 themes · custom frameless title bar

## Installing

Grab the matching artifact from the [Releases page](https://github.com/exusxt/SC64_SD_Card_Builder/releases):

- **Windows**: the NSIS installer (auto-updates) or the portable `.exe` (no install, self-updates by downloading the newer portable). Both are available for x64 and arm64.
- **macOS**: the `.dmg` (drag the app to Applications) or the `.zip`. See the macOS note below — builds are unsigned.
- **Linux**: the AppImage (most distros), or the `.deb` / `.rpm` / `.pacman` matching your package manager.

### Platform notes

- **macOS (unsigned):** there is no Apple Developer certificate. The first time you run the app (and after each manual update), right-click the app → **Open** instead of double-clicking; Gatekeeper will otherwise block it.
- **Windows:** builds are unsigned, so SmartScreen may show "Unknown publisher" — choose *More info → Run anyway*. This is a reputation issue, not malware; see the troubleshooting note below.
- **Linux:** the AppImage may need `libfuse2` on older distros (FUSE 2); modern distros with FUSE 3 work out of the box.

### Formatting

Formatting a physical drive requires elevated privileges, which the app requests on your behalf:

- **Windows:** the app relaunches itself as administrator (UAC prompt). USB/SD cards are detected and large cards (>32 GB) are formatted as FAT32.
- **macOS:** an administrator password prompt is shown. Internal disks are filtered out; only removable media is listed.
- **Linux:** `pkexec` asks for root. Detection uses `lsblk`; internal disks are hidden.

## Troubleshooting

- **Windows — SmartScreen "Unknown publisher":** builds are unsigned (no code-signing certificate), so SmartScreen may warn on first run. This is a reputation issue, not malware — choose *More info → Run anyway*.
- **Linux — app closes instantly with `SIGTRAP`** (e.g. Ubuntu 24.04+/25.04): Chromium's SUID sandbox cannot run from a path containing spaces, and these distros block the alternative user-namespace sandbox. Since v0.2.5 the `.deb`/`.rpm` install to the space-free `/opt/SC64-SD-Card-Builder` and set the sandbox's setuid bit at install time — just reinstall the package. If launching still aborts with "SUID sandbox helper binary … not configured correctly", repair the permissions:

  ```bash
  sudo chown root:root /opt/SC64-SD-Card-Builder/chrome-sandbox
  sudo chmod 4755 /opt/SC64-SD-Card-Builder/chrome-sandbox
  ```

  As a last resort you can also launch with `--no-sandbox` (disables the Chromium sandbox — not recommended).
- **Linux AppImage on Ubuntu 24.04+/25.04:** these distros restrict unprivileged user namespaces (AppArmor), which the AppImage relies on because its sandbox cannot be setuid. Prefer the `.deb` on these systems, or run the AppImage with `--no-sandbox`.
- **macOS — Gatekeeper blocks the app:** builds are unsigned; the first time (and after each manual update) right-click the app → **Open** instead of double-clicking.

## Development

```bash
npm install
npm run dev          # run in development
npm run typecheck    # type check
npm test             # run unit tests (Vitest)
npm run build        # build to out/
```

Tests live in `tests/` and cover the shared i18n helpers, the path-guard utility, renderer utils and the changelog classifier. A CI gate (`.github/workflows/ci.yml`) runs typecheck + tests on every push/PR; the release workflow runs them too before packaging.

## Building & packaging

Build each platform on its native OS (or use the release workflow below to build all platforms in CI). Outputs go to `dist/`.

```bash
npm run dist:win          # NSIS installer + portable exe (x64 + arm64)
npm run dist:win:x64      # Windows x64 only
npm run dist:win:arm64    # Windows arm64 only

npm run dist:mac          # dmg + zip (x64 + arm64)
npm run dist:mac:x64
npm run dist:mac:arm64

npm run dist:linux        # AppImage + deb + rpm + pacman (x64 + arm64)
npm run dist:linux:x64
npm run dist:linux:arm64
```

Linux packaging notes: `.deb` needs `dpkg-deb`/`fakeroot`, `.rpm` needs `rpmbuild`, `.pacman` needs `bsdtar` (e.g. `libarchive-tools`). Install what your distro doesn't ship, or let CI handle it.

## Publishing updates

Auto-updates use GitHub Releases (`github.com/exusxt/SC64_SD_Card_Builder`).

**All platforms (recommended):** push a `v*` tag and the GitHub Actions workflow (`.github/workflows/release.yml`) builds each platform on its native runner and publishes the artifacts to the release — no local mac/Linux machine needed:

```bash
git tag v0.2.1 && git push origin main --tags
```

Each runner creates/updates the release (notes come from the `## [vX.Y.Z]` section of `CHANGELOG.md`) and uploads its artifacts: NSIS + portable exe, dmg + zip, AppImage + deb/rpm/pacman, plus `latest.yml` / `latest-mac.yml` / `latest-linux.yml` for auto-updates. This is the single publisher — don't also publish locally to the same tag.

**From this machine (bump + tag only):** `npm run release` runs `scripts/release.mjs` — bumps the patch version (or pass one explicitly: `npm run release -- 0.2.1`), generates categorized release notes (Added/Changed/Fixed/Infra from your commit messages) into `CHANGELOG.md`, commits and tags (`v0.2.1`), then pushes — which triggers the CI release above. If git is not on PATH, it falls back to the GitHub Desktop git — override with the `SC64_GIT` env var if needed.

```bash
$env:GH_TOKEN="ghp_..."   # PowerShell: a GitHub token with repo scope
npm run release
```

For immediate Windows-only uploads (or to retry a failed upload without waiting for CI), use `npm run publish` — it builds and uploads the Windows installers plus `latest.yml`. To re-upload the current version without a bump, run the workflow manually from the Actions tab.

### Release notes

To make nice changelog entries, write commit messages with a type prefix (`feat:`, `fix:`, `chore:`, `refactor:`, `ci:`, …) or a leading verb (`Add …`, `Fix …`, `Remove …`). `scripts/release.mjs` groups them into Added/Changed/Fixed/Infra. The GitHub release body is the `## [vX.Y.Z]` section of `CHANGELOG.md` (the workflow falls back to auto-generated notes if that section is missing).

### Update notes

- **Windows installed (NSIS):** users are notified automatically and can restart to install; the portable `.exe` self-updates by downloading the newer portable instead.
- **macOS:** updates install from the `.zip`; because builds are unsigned, each update may need the right-click → Open step once.
- **Linux:** installed packages (deb/rpm/pacman/AppImage) update via `latest-linux.yml`.
- The updater only offers versions newer than the installed one.

## Icon

The app icon and title-bar logo are generated from `icon-assets/appstore.png`:

```bash
powershell -File scripts/make-icons.ps1   # regenerates build/icon.ico, build/icon.png and the renderer logo
```

## License

MIT
