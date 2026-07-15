// Pure helpers for walking the message tree. No React, no side effects.

import type { Conversation, MessageNode } from './types'

// Walk from a leaf up to the root, following parentId, then reverse so the
// result is in reading order (root first, leaf last).
export function pathToLeaf(
  conv: Conversation,
  leafId: string | null,
): MessageNode[] {
  const path: MessageNode[] = []
  let current = leafId ? conv.nodes[leafId] : undefined
  while (current) {
    path.push(current)
    current = current.parentId ? conv.nodes[current.parentId] : undefined
  }
  return path.reverse()
}

// Direct children of a node (or of the root, when nodeId is null), oldest first.
export function childrenOf(
  conv: Conversation,
  nodeId: string | null,
): MessageNode[] {
  return Object.values(conv.nodes)
    .filter((n) => n.parentId === nodeId)
    .sort((a, b) => a.createdAt - b.createdAt)
}
