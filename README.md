# SC64 SD Card Builder

Prepare an SD card for the SummerCart64 (N64FlashcartMenu). Cross-platform Electron app with 18 languages and 4 themes.

## Features

- Detect SD cards, verify FAT32, format large cards (>32 GB) as FAT32 (requires admin)
- Install the latest N64FlashcartMenu, boxart/metadata pack and emulators onto the card
- Copy your own ROMs while preserving folder structure (optional save folders, file-type filter)
- **Prepared-folder flow**: stage a build or copy an already-prepared folder (e.g. from a friend) to the card with an animated transfer view
- **Byte-for-byte verification** of every copied file (optional)
- Auto-updates via GitHub Releases (NSIS installs)
- 18 languages · 4 themes · custom frameless title bar

## Development

```bash
npm install
npm run dev          # run in development
npm run typecheck    # type check
npm run build        # build to out/
```

## Packaging

```bash
npm run dist:win     # NSIS installer + portable exe (x64 + arm64)
```

Outputs to `dist/`.

## Publishing updates

Auto-updates use GitHub Releases (`github.com/exusxt/SC64_SD_Card_Builder`).

**Windows-only, quick release (from this machine):** `npm run release` runs `scripts/release.mjs` — bumps the patch version, generates `release-notes.md` from `git log`, commits and tags (`v0.1.1`), pushes, then builds and uploads the Windows installers plus `latest.yml`. If git is not on PATH, it falls back to the GitHub Desktop git — override with the `SC64_GIT` env var if needed.

```bash
$env:GH_TOKEN="ghp_..."   # PowerShell: set a GitHub token with repo scope
npm run release
```

**All platforms (Linux/macOS/Windows):** pushing a `v*` tag triggers the GitHub Actions workflow (`.github/workflows/release.yml`). Each platform is built on its native runner and the artifacts are published to the same release automatically — no local mac/Linux machine needed:

```bash
git tag v0.1.1 && git push origin main --tags
```

Each runner creates the release (idempotent, auto-generated notes) and uploads its artifacts: NSIS + portable exe, dmg + zip, AppImage + deb, plus `latest.yml`/`latest-linux.yml`/`latest-mac.yml` for auto-updates.

**Notes**
- macOS builds are **unsigned** (no Apple Developer certificate). Users must right-click → Open the first time; Gatekeeper will otherwise block it. To sign/notarize, add `CSC_LINK`/`CSC_KEY_PASSWORD` and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` secrets to the workflow.
- Users on the **installed (NSIS)** Windows version are notified automatically and can restart to install. The **portable** exe does not support auto-update — download the new one from Releases instead. The updater only offers versions newer than the installed one.

To re-upload the current version without a bump, use `npm run publish` (Windows) or run the workflow manually.

## Icon

The app icon and title-bar logo are generated from `icon-assets/appstore.png`:

```bash
powershell -File scripts/make-icons.ps1   # regenerates build/icon.ico and the renderer logo
```

## License

MIT
