// Persistence layer. For now this is browser localStorage, which is the
// simplest thing that survives page reloads on a static site. When we outgrow
// it (larger histories, or cross-device sync) we swap this file for IndexedDB
// or a hosted database — the rest of the app only calls these functions.

import type { Conversation, Settings } from './types'

const CONVERSATIONS_KEY = 'dichala.conversations.v1'
const SETTINGS_KEY = 'dichala.settings.v1'

// In dev the browser talks to the Vite proxy at /ollama (no CORS headaches).
// In a deployed build there's no proxy, so we default to the local Ollama
// port; a bring-your-own-endpoint user can change this in Settings.
const DEFAULT_BASE_URL = import.meta.env.DEV ? '/ollama' : 'http://localhost:11434'

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: DEFAULT_BASE_URL,
  model: 'llama3.2:latest',
}

export function loadConversations(): Record<string, Conversation> {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Conversation>
    // Normalize older saved data that predates side-chats.
    for (const conv of Object.values(parsed)) {
      if (!conv.sideChats) conv.sideChats = {}
    }
    return parsed
  } catch {
    return {}
  }
}

export function saveConversations(convs: Record<string, Conversation>): void {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convs))
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
