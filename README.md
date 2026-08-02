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

Auto-updates use GitHub Releases (`github.com/exusxt/SC64_SD_Card_Builder`). Releases are created as drafts:

```bash
$env:GH_TOKEN="ghp_..."   # PowerShell: set a GitHub token with repo scope
npm run publish           # builds and uploads, creates a draft release
```

Then publish the draft on GitHub. Users on the **installed (NSIS)** version are notified automatically and can restart to install. The **portable** exe does not support auto-update — download the new one from Releases instead.

Bump `version` in `package.json` before each release; the updater only offers versions newer than the installed one.

## Icon

The app icon and title-bar logo are generated from `icon-assets/appstore.png`:

```bash
powershell -File scripts/make-icons.ps1   # regenerates build/icon.ico and the renderer logo
```

## License

MIT
