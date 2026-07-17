// The core data model. A conversation is a TREE of message nodes, not a list.
// Each node points to its parent; the "conversation you see" is the path from
// the root down to whichever leaf is currently active. Branching (added later)
// is simply: give a node more than one child and let the user switch which
// child path is active.

export type Role = 'user' | 'assistant' | 'system'

export interface MessageNode {
  id: string
  parentId: string | null // null means this is the root (first) message
  role: Role
  content: string
  createdAt: number
  model?: string // which model produced an assistant message
}

// A side-chat is a short clarifying conversation anchored to one block of one
// assistant message. It lives alongside the main tree (not inside conv.nodes)
// because several can be open at once, they must not disturb the main path, and
// they must not masquerade as major branches in the future tree-map.
export interface SideChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  model?: string
}

export interface SideChat {
  id: string
  anchorNodeId: string // which assistant message this hangs off
  blockIndex: number // which top-level block of that message is the focus
  summary?: string // LLM-generated 2-3 word label; blank until first exchange
  messages: SideChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface Conversation {
  id: string
  title: string
  nodes: Record<string, MessageNode> // all nodes, keyed by id
  rootId: string | null // the first message in the conversation
  activeLeafId: string | null // tip of the path currently displayed
  sideChats?: Record<string, SideChat> // optional so old saved data still parses
  createdAt: number
  updatedAt: number
}

export interface Settings {
  baseUrl: string // e.g. "/ollama" in dev, or "http://localhost:11434"
  model: string // e.g. "llama3.2:latest"
}
