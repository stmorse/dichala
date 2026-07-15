// Builds the message array sent to the model for a side-chat turn. Pure; no
// React, no side effects.
//
// The model sees: the whole main conversation up to and including the anchored
// assistant message, then a framing message pointing at the focused block, then
// the side-chat's own back-and-forth. We resolve context via the anchor node
// (not the conversation's active leaf) so a side-chat keeps working even after
// major-branch switching changes which path is active.

import type { Conversation, SideChat } from './types'
import type { ChatMessage } from './ollama'
import { pathToLeaf } from './tree'
import { splitTopLevelBlocks } from './blocks'

export function focusText(conv: Conversation, sc: SideChat): string {
  const anchor = conv.nodes[sc.anchorNodeId]
  if (!anchor) return ''
  const blocks = splitTopLevelBlocks(anchor.content)
  return blocks[sc.blockIndex] ?? ''
}

export function buildSideChatMessages(
  conv: Conversation,
  sc: SideChat,
): ChatMessage[] {
  const context: ChatMessage[] = pathToLeaf(conv, sc.anchorNodeId).map((n) => ({
    role: n.role,
    content: n.content,
  }))

  const focus = focusText(conv, sc)
  const framing: ChatMessage = {
    role: 'system',
    content:
      'The user has a focused follow-up question about one specific part of ' +
      'your previous response, quoted below. Answer concisely and stay on that ' +
      'part unless they broaden the topic.\n\n--- focused excerpt ---\n' +
      focus,
  }

  const turns: ChatMessage[] = sc.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  return [...context, framing, ...turns]
}
