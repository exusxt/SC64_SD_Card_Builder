import { sep } from 'node:path'

export function pathContains(parent: string, child: string): boolean {
  const norm = (p: string): string => {
    const n = p.replace(/\//g, sep).replace(/[\\/]+$/, '')
    return process.platform === 'win32' ? n.toLowerCase() : n
  }
  const pn = norm(parent)
  const cn = norm(child)
  return cn === pn || cn.startsWith(pn + sep)
}
