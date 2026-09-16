// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'

/**
 * "Star", then "Star 2", "Star 3", … — scans every node name in the
 * whole document (not just siblings), so a name stays sane even after
 * the node gets dragged to a different parent, matching how most design
 * tools dedupe inserted/duplicated objects.
 *
 * If `baseName` itself already ends in " <number>" (e.g. duplicating
 * "Star 2", or a node the user happened to name "Star 1" by hand), the
 * next name increments straight from that number ("Star 3") instead of
 * stripping back to the bare prefix and re-checking whether "Star" is
 * free — which it usually is, since this scheme's own bare form never
 * gets generated with a trailing number, so stripping-then-recheck was
 * handing back "Star" on the very first duplicate and only reaching
 * "Star 2" on the second. Safe for names with embedded numbers
 * elsewhere ("iPhone 13 Mockup") since the match requires the number to
 * be the very last token.
 */
export function uniqueNodeName(api: SceneAPI, baseName: string): string {
  const existing = new Set(
    api.getAllNodeIds().map((id) => api.getNode(id)?.name),
  )
  const numberedMatch = baseName.match(/^(.*) (\d+)$/)
  if (numberedMatch) {
    const prefix = numberedMatch[1]!
    let n = parseInt(numberedMatch[2]!, 10) + 1
    while (existing.has(`${prefix} ${n}`)) n += 1
    return `${prefix} ${n}`
  }
  if (!existing.has(baseName)) return baseName
  let n = 2
  while (existing.has(`${baseName} ${n}`)) n += 1
  return `${baseName} ${n}`
}
