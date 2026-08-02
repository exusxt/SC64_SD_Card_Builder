#!/bin/sh
# Chromium's SUID sandbox cannot run from a path containing spaces, so the app
# installs to the space-free /opt/SC64-SD-Card-Builder. fpm does not preserve
# the setuid bit during packaging, and Ubuntu 24.04+ blocks the alternative
# user-namespace sandbox — without this fix the app aborts with SIGTRAP at
# launch ("SUID sandbox helper binary was found, but is not configured correctly"
# or "failed to execvp").
APP="/opt/SC64-SD-Card-Builder"
BIN="$APP/sc64-sd-card-builder"

# Register the CLI command (refresh the symlink on reinstall/upgrade).
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --install '/usr/bin/sc64-sd-card-builder' 'sc64-sd-card-builder' "$BIN" 100 \
        || ln -sf "$BIN" '/usr/bin/sc64-sd-card-builder'
else
    ln -sf "$BIN" '/usr/bin/sc64-sd-card-builder'
fi

# Make the SUID sandbox usable: root-owned with mode 4755.
if [ -f "$APP/chrome-sandbox" ]; then
    chown root:root "$APP/chrome-sandbox" 2>/dev/null || true
    chmod 4755 "$APP/chrome-sandbox" 2>/dev/null || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

exit 0
