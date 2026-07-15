// Splits a markdown string into its top-level blocks (paragraphs, lists, code
// fences, headings, blockquotes, tables …) so each can be rendered and hovered
// individually. We parse to an mdast tree and slice the ORIGINAL source string
// by each top-level node's character offsets — this keeps multi-paragraph list
// items and fenced code intact, which a naive blank-line split would mangle.
//
// A block's index in the returned array is its stable anchor id: assistant
// messages are frozen once generated, so indices don't shift.

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'

// Minimal shape of the mdast nodes we read, to avoid a hard dependency on
// @types/mdast being installed.
interface Positioned {
  position?: { start: { offset?: number }; end: { offset?: number } }
}
interface ParsedRoot {
  children: Positioned[]
}

const processor = unified().use(remarkParse).use(remarkGfm)

export function splitTopLevelBlocks(markdown: string): string[] {
  if (!markdown.trim()) return []

  const tree = processor.parse(markdown) as unknown as ParsedRoot
  const blocks: string[] = []

  for (const node of tree.children) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) continue
    const text = markdown.slice(start, end).trim()
    if (text) blocks.push(text)
  }

  // Fallback: if parsing somehow yielded nothing, treat the whole thing as one
  // block so content is never dropped.
  return blocks.length > 0 ? blocks : [markdown.trim()]
}
