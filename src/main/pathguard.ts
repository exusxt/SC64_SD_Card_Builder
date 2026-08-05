// Source/destination overlap guard for the main process. Before a card build
// starts, the destination is checked against every ROM source folder so a card
// being prepared from a directory it is itself inside can't recurse into
// itself and copy its own partial output.

import { sep } from 'node:path'

/**
 * True when `child` equals `parent` or is nested anywhere beneath it (its own
 * subdirectory). Paths are normalized to the platform separator, trailing
 * slashes are stripped (so drive roots like "E:\" compare correctly) and
 * comparison is case-insensitive on Windows.
 */
export function pathContains(parent: string, child: string): boolean {
  const norm = (p: string): string => {
    const n = p.replace(/\//g, sep).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? n.toLowerCase() : n
  }
  const pn = norm(parent)
  const cn = norm(child)
  // The separator suffix is what stops "C:\foo" from matching "C:\foobar".
  return cn === pn || cn.startsWith(pn + sep)
}
