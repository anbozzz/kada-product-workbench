import { diffArrays, diffChars } from "diff"

export type DiffRow = {
  kind: "equal" | "removed" | "added"
  text: string
  oldLine?: number
  newLine?: number
  parts?: { text: string; changed: boolean }[]
}
export type DiffSection = { kind: "change" | "gap"; rows: DiffRow[]; heading: string }

// Bound expensive comparisons without silently claiming a partial result is exact.
export function buildRevisionDiff(before: string, after: string, maxEditLength = 4000) {
  const oldLines = before === "" ? [] : before.split(/\r?\n/)
  const newLines = after === "" ? [] : after.split(/\r?\n/)
  const changes = diffArrays(oldLines, newLines, { maxEditLength, timeout: 200 })
  if (!changes) return { sections: [] as DiffSection[], limited: true }
  const rows: DiffRow[] = []
  let oldLine = 1, newLine = 1
  for (const change of changes) {
    for (const text of change.value) {
      rows.push({ text, kind: change.added ? "added" : change.removed ? "removed" : "equal",
        oldLine: change.added ? undefined : oldLine++, newLine: change.removed ? undefined : newLine++ })
    }
  }
  // Pair replacement lines only within one edit run; never align across unchanged text.
  let inlineBudget = 50000
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind === "equal") { i++; continue }
    const start = i
    while (i < rows.length && rows[i].kind !== "equal") i++
    const removed = rows.slice(start, i).filter(row => row.kind === "removed")
    const added = rows.slice(start, i).filter(row => row.kind === "added")
    for (let j = 0; j < Math.min(removed.length, added.length); j++) {
      const size = removed[j].text.length + added[j].text.length
      if (size > 4000 || size > inlineBudget) continue
      inlineBudget -= size
      const parts = diffChars(removed[j].text, added[j].text, { maxEditLength: 1000, timeout: 10 })
      if (!parts) continue
      removed[j].parts = parts.filter(part => !part.added).map(part => ({ text: part.value, changed: part.removed }))
      added[j].parts = parts.filter(part => !part.removed).map(part => ({ text: part.value, changed: part.added }))
    }
  }
  const ranges: { start: number; end: number }[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind === "equal") continue
    const start = Math.max(0, i - 2), end = Math.min(rows.length, i + 3)
    const previous = ranges.at(-1)
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
    else ranges.push({ start, end })
  }
  // Titles are context only; the source comparison always includes every line.
  const headings = (lines: string[]) => {
    let title = "文档开头", fence = ""
    return lines.map(line => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (marker) {
        if (!fence) fence = marker[1]
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ""
      } else if (!fence) {
        const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/)
        if (heading) title = heading[1]
      }
      return title
    })
  }
  const oldHeadings = headings(oldLines), newHeadings = headings(newLines)
  const sections: DiffSection[] = []
  let cursor = 0
  for (const range of ranges) {
    if (cursor < range.start) sections.push({ kind: "gap", rows: rows.slice(cursor, range.start), heading: "" })
    const slice = rows.slice(range.start, range.end)
    const first = slice.find(row => row.kind !== "equal")!
    const heading = first.kind === "removed" ? oldHeadings[first.oldLine! - 1] : newHeadings[first.newLine! - 1]
    sections.push({ kind: "change", rows: slice, heading })
    cursor = range.end
  }
  if (ranges.length && cursor < rows.length) sections.push({ kind: "gap", rows: rows.slice(cursor), heading: "" })
  return { sections, limited: false }
}
