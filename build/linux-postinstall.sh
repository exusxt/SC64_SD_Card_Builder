#!/bin/sh
# Fix Chromium SUID sandbox permissions. fpm does not preserve the setuid
# bit on chrome-sandbox when packing the deb/rpm, which makes the app abort
# with SIGTRAP ("SUID sandbox helper binary ... not configured correctly").
SANDBOX="/opt/SC64 SD Card Builder/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" 2>/dev/null || true
  chmod 4755 "$SANDBOX" 2>/dev/null || true
fi
exit 0
