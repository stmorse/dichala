import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  Conversation,
  MessageNode,
  Settings,
  SideChat,
} from './lib/types'
import { pathToLeaf } from './lib/tree'
import { splitTopLevelBlocks } from './lib/blocks'
import {
  buildSideChatMessages,
  buildSummaryMessages,
  cleanSummary,
  focusText,
} from './lib/sidechat'
import { streamChat, chatOnce, listModels } from './lib/ollama'
import {
  loadConversations,
  saveConversations,
  loadSettings,
  saveSettings,
} from './lib/storage'
import './App.css'

// Turn the first user message into a short sidebar title.
function deriveTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  return trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed
}

const SIDE_PANEL_GAP = 12

export default function App() {
  const [conversations, setConversations] = useState<Record<string, Conversation>>(
    () => loadConversations(),
  )
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [streaming, setStreaming] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Side-chat state.
  const [openSideChatIds, setOpenSideChatIds] = useState<string[]>([])
  const [sideChatStreamingId, setSideChatStreamingId] = useState<string | null>(
    null,
  )
  const [panelTops, setPanelTops] = useState<Record<string, number>>({})
  const [measureBump, setMeasureBump] = useState(0)

  // Two independent abort controllers so a main-thread stream and a side-chat
  // stream can run at the same time without cancelling each other.
  const mainAbortRef = useRef<AbortController | null>(null)
  const sideAbortRef = useRef<AbortController | null>(null)

  const messagesRef = useRef<HTMLDivElement>(null)
  const blockRefs = useRef(new Map<string, HTMLElement>())
  const panelRefs = useRef(new Map<string, HTMLElement>())

  // Persist to localStorage whenever these change.
  useEffect(() => saveConversations(conversations), [conversations])
  useEffect(() => saveSettings(settings), [settings])

  const current = currentId ? conversations[currentId] : null
  const messages = useMemo(
    () => (current ? pathToLeaf(current, current.activeLeafId) : []),
    [current],
  )
  const streamingNodeId = streaming ? current?.activeLeafId ?? null : null

  // Open panels that still exist in the current conversation.
  const openPanels = useMemo(() => {
    if (!current) return []
    return openSideChatIds
      .map((id) => current.sideChats?.[id])
      .filter((sc): sc is SideChat => Boolean(sc))
  }, [current, openSideChatIds])
  const hasOpenPanels = openPanels.length > 0

  // Sidebar list: real conversations (those with a first message), newest first.
  const conversationList = useMemo(
    () =>
      Object.values(conversations)
        .filter((c) => c.rootId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  )

  const registerBlock = useCallback((key: string, el: HTMLElement | null) => {
    if (el) blockRefs.current.set(key, el)
    else blockRefs.current.delete(key)
  }, [])

  const registerPanel = useCallback((id: string, el: HTMLElement | null) => {
    if (el) panelRefs.current.set(id, el)
    else panelRefs.current.delete(id)
  }, [])

  // Position each open panel next to its anchor block, stacking downward so
  // panels whose anchors are close together don't overlap.
  useLayoutEffect(() => {
    const container = messagesRef.current
    if (!container || !current) {
      setPanelTops({})
      return
    }
    const cRect = container.getBoundingClientRect()
    const entries = openPanels
      .map((sc) => {
        const el = blockRefs.current.get(`${sc.anchorNodeId}:${sc.blockIndex}`)
        if (!el) return null
        const eRect = el.getBoundingClientRect()
        return { id: sc.id, anchorTop: eRect.top - cRect.top + container.scrollTop }
      })
      .filter((e): e is { id: string; anchorTop: number } => e !== null)
      .sort((a, b) => a.anchorTop - b.anchorTop)

    const next: Record<string, number> = {}
    let prevBottom = -Infinity
    for (const e of entries) {
      const top = Math.max(e.anchorTop, prevBottom + SIDE_PANEL_GAP)
      next[e.id] = top
      const h = panelRefs.current.get(e.id)?.offsetHeight ?? 220
      prevBottom = top + h
    }
    setPanelTops(next)
  }, [openPanels, current, messages, measureBump])

  // Re-measure when the container resizes (viewport changes, etc.).
  useEffect(() => {
    const container = messagesRef.current
    if (!container) return
    const ro = new ResizeObserver(() => setMeasureBump((b) => b + 1))
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  function selectConversation(id: string | null) {
    setCurrentId(id)
    setOpenSideChatIds([])
  }

  async function handleSend(text: string) {
    if (!text.trim() || streaming) return

    // Resolve the conversation we're appending to, or start a fresh one.
    const base: Conversation = current ?? {
      id: crypto.randomUUID(),
      title: '',
      nodes: {},
      rootId: null,
      activeLeafId: null,
      sideChats: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const parentId = base.activeLeafId // null for the very first message
    const userNode: MessageNode = {
      id: crypto.randomUUID(),
      parentId,
      role: 'user',
      content: text.trim(),
      createdAt: Date.now(),
    }
    const assistantNode: MessageNode = {
      id: crypto.randomUUID(),
      parentId: userNode.id,
      role: 'assistant',
      content: '',
      createdAt: Date.now() + 1,
      model: settings.model,
    }

    const next: Conversation = {
      ...base,
      title: base.title || deriveTitle(text),
      nodes: {
        ...base.nodes,
        [userNode.id]: userNode,
        [assistantNode.id]: assistantNode,
      },
      rootId: base.rootId ?? userNode.id,
      activeLeafId: assistantNode.id,
      updatedAt: Date.now(),
    }

    setConversations((prev) => ({ ...prev, [next.id]: next }))
    setCurrentId(next.id)
    setStreaming(true)

    const history = pathToLeaf(next, userNode.id).map((n) => ({
      role: n.role,
      content: n.content,
    }))

    const controller = new AbortController()
    mainAbortRef.current = controller

    const appendToAssistant = (extra: string) =>
      setConversations((prev) => {
        const c = prev[next.id]
        if (!c) return prev
        const node = c.nodes[assistantNode.id]
        if (!node) return prev
        return {
          ...prev,
          [c.id]: {
            ...c,
            nodes: {
              ...c.nodes,
              [assistantNode.id]: { ...node, content: node.content + extra },
            },
            updatedAt: Date.now(),
          },
        }
      })

    try {
      await streamChat(
        settings.baseUrl,
        settings.model,
        history,
        appendToAssistant,
        controller.signal,
      )
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        appendToAssistant(`\n\n⚠️ ${(err as Error).message}`)
      }
    } finally {
      setStreaming(false)
      mainAbortRef.current = null
    }
  }

  function handleStop() {
    mainAbortRef.current?.abort()
  }

  function handleNewChat() {
    handleStop()
    selectConversation(null)
  }

  function handleDelete(id: string) {
    setConversations((prev) => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
    if (currentId === id) selectConversation(null)
  }

  // --- Side-chat handlers ---

  function handleCreateSideChat(nodeId: string, blockIndex: number) {
    if (!current) return
    // A block can host any number of side-chats; each + click makes a new one.
    const sc: SideChat = {
      id: crypto.randomUUID(),
      anchorNodeId: nodeId,
      blockIndex,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setConversations((prev) => {
      const c = prev[current.id]
      if (!c) return prev
      return {
        ...prev,
        [c.id]: { ...c, sideChats: { ...c.sideChats, [sc.id]: sc } },
      }
    })
    setOpenSideChatIds((ids) => [...ids, sc.id])
  }

  function handleOpenSideChat(id: string) {
    setOpenSideChatIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
  }

  function handleCloseSideChat(id: string) {
    if (sideChatStreamingId === id) sideAbortRef.current?.abort()
    setOpenSideChatIds((ids) => ids.filter((x) => x !== id))
  }

  function handleSideChatStop() {
    sideAbortRef.current?.abort()
  }

  async function handleSideChatSend(sideChatId: string, text: string) {
    if (!text.trim() || sideChatStreamingId || !current) return
    const conv = current
    const sc = conv.sideChats?.[sideChatId]
    if (!sc) return

    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: text.trim(),
      createdAt: Date.now(),
    }
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: '',
      createdAt: Date.now() + 1,
      model: settings.model,
    }
    const nextSc: SideChat = {
      ...sc,
      messages: [...sc.messages, userMsg, assistantMsg],
      updatedAt: Date.now(),
    }
    const nextConv: Conversation = {
      ...conv,
      sideChats: { ...conv.sideChats, [sideChatId]: nextSc },
    }

    setConversations((prev) => ({ ...prev, [conv.id]: nextConv }))
    setSideChatStreamingId(sideChatId)

    // Build history WITHOUT the empty assistant placeholder we just added.
    const historySc: SideChat = { ...sc, messages: [...sc.messages, userMsg] }
    const payload = buildSideChatMessages(nextConv, historySc)

    const controller = new AbortController()
    sideAbortRef.current = controller

    const appendToAssistant = (extra: string) =>
      setConversations((prev) => {
        const c = prev[conv.id]
        const s = c?.sideChats?.[sideChatId]
        if (!c || !s) return prev
        const msgs = s.messages.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: m.content + extra } : m,
        )
        return {
          ...prev,
          [c.id]: {
            ...c,
            sideChats: {
              ...c.sideChats,
              [sideChatId]: { ...s, messages: msgs, updatedAt: Date.now() },
            },
          },
        }
      })

    const isFirstMessage = sc.messages.length === 0

    try {
      await streamChat(
        settings.baseUrl,
        settings.model,
        payload,
        appendToAssistant,
        controller.signal,
      )
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        appendToAssistant(`\n\n⚠️ ${(err as Error).message}`)
      }
    } finally {
      setSideChatStreamingId(null)
      sideAbortRef.current = null
    }

    // After the first exchange, generate the 2-3 word label shown as the
    // panel title and the icon tooltip. Runs after the reply stream so it
    // doesn't compete with it for the model; failures just leave it blank.
    if (isFirstMessage && !sc.summary) {
      try {
        const raw = await chatOnce(
          settings.baseUrl,
          settings.model,
          buildSummaryMessages(focusText(nextConv, nextSc), userMsg.content),
        )
        const summary = cleanSummary(raw)
        if (summary) {
          setConversations((prev) => {
            const c = prev[conv.id]
            const s = c?.sideChats?.[sideChatId]
            if (!c || !s) return prev
            return {
              ...prev,
              [c.id]: {
                ...c,
                sideChats: { ...c.sideChats, [sideChatId]: { ...s, summary } },
              },
            }
          })
        }
      } catch {
        // Non-fatal: the side-chat just keeps a blank title.
      }
    }
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversationList}
        currentId={currentId}
        onSelect={selectConversation}
        onNewChat={handleNewChat}
        onDelete={handleDelete}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main className="main">
        {messages.length === 0 ? (
          <div className="empty">
            <h1>dichala</h1>
            <p>Start a conversation. Hover a paragraph to branch a side-chat.</p>
          </div>
        ) : (
          <div
            className={'messages' + (hasOpenPanels ? ' has-sidechat' : '')}
            ref={messagesRef}
          >
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                node={m}
                isStreaming={m.id === streamingNodeId}
                sideChats={current?.sideChats}
                onCreate={handleCreateSideChat}
                onOpen={handleOpenSideChat}
                registerBlock={registerBlock}
              />
            ))}
            <ScrollAnchor
              dep={
                messages.length + ':' + (messages.at(-1)?.content.length ?? 0)
              }
            />
            {openPanels.map((sc) => (
              <SideChatPanel
                key={sc.id}
                sideChat={sc}
                focus={current ? focusText(current, sc) : ''}
                streaming={sideChatStreamingId === sc.id}
                top={panelTops[sc.id] ?? 0}
                registerPanel={registerPanel}
                onSend={handleSideChatSend}
                onStop={handleSideChatStop}
                onClose={handleCloseSideChat}
              />
            ))}
          </div>
        )}

        <Composer streaming={streaming} onSend={handleSend} onStop={handleStop} />
      </main>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

function Sidebar(props: {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
  onDelete: (id: string) => void
  onOpenSettings: () => void
}) {
  return (
    <aside className="sidebar">
      <button className="new-chat" onClick={props.onNewChat}>
        + New chat
      </button>
      <nav className="conv-list">
        {props.conversations.map((c) => (
          <div
            key={c.id}
            className={'conv-item' + (c.id === props.currentId ? ' active' : '')}
            onClick={() => props.onSelect(c.id)}
          >
            <span className="conv-title">{c.title || 'Untitled'}</span>
            <button
              className="conv-delete"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation()
                props.onDelete(c.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </nav>
      <button className="settings-btn" onClick={props.onOpenSettings}>
        ⚙ Settings
      </button>
    </aside>
  )
}

function MessageBubble(props: {
  node: MessageNode
  isStreaming: boolean
  sideChats: Record<string, SideChat> | undefined
  onCreate: (nodeId: string, blockIndex: number) => void
  onOpen: (sideChatId: string) => void
  registerBlock: (key: string, el: HTMLElement | null) => void
}) {
  const { node, isStreaming, sideChats, onCreate, onOpen, registerBlock } = props

  // User messages: keep as plain text. Assistant messages: render markdown.
  // While streaming, render as one markdown block (no branch affordances yet);
  // once frozen, split into hover-able top-level blocks.
  let body
  if (node.role !== 'assistant') {
    body = <div className="content plain">{node.content}</div>
  } else if (isStreaming || !node.content) {
    body = (
      <div className="content">
        {node.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {node.content}
          </ReactMarkdown>
        ) : (
          <span className="cursor">▍</span>
        )}
      </div>
    )
  } else {
    const blocks = splitTopLevelBlocks(node.content)
    body = (
      <div className="content">
        {blocks.map((block, i) => {
          const blockChats = sideChats
            ? Object.values(sideChats)
                .filter((s) => s.anchorNodeId === node.id && s.blockIndex === i)
                .sort((a, b) => a.createdAt - b.createdAt)
            : []
          return (
            <MarkdownBlock
              key={i}
              nodeId={node.id}
              blockIndex={i}
              markdown={block}
              sideChats={blockChats}
              onCreate={onCreate}
              onOpen={onOpen}
              registerBlock={registerBlock}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className={'message ' + node.role}>
      <div className="role-label">{node.role}</div>
      {body}
    </div>
  )
}

function MarkdownBlock(props: {
  nodeId: string
  blockIndex: number
  markdown: string
  sideChats: SideChat[]
  onCreate: (nodeId: string, blockIndex: number) => void
  onOpen: (sideChatId: string) => void
  registerBlock: (key: string, el: HTMLElement | null) => void
}) {
  const { nodeId, blockIndex, markdown, sideChats, onCreate, onOpen, registerBlock } =
    props
  const key = `${nodeId}:${blockIndex}`
  return (
    <div
      className={'md-block' + (sideChats.length > 0 ? ' branched' : '')}
      ref={(el) => registerBlock(key, el)}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      {/* Vertical stack of side-chat icons; the + (new side-chat) is always
          at the bottom. Existing icons stay visible; + appears on hover. */}
      <div className="branch-stack">
        {sideChats.map((sc) => (
          <button
            key={sc.id}
            className="branch-icon"
            data-tip={sc.summary || 'side-chat'}
            onClick={() => onOpen(sc.id)}
          >
            ❈
          </button>
        ))}
        <button
          className="branch-plus"
          data-tip="new side-chat"
          onClick={() => onCreate(nodeId, blockIndex)}
        >
          +
        </button>
      </div>
    </div>
  )
}

function SideChatPanel(props: {
  sideChat: SideChat
  focus: string
  streaming: boolean
  top: number
  registerPanel: (id: string, el: HTMLElement | null) => void
  onSend: (sideChatId: string, text: string) => void
  onStop: () => void
  onClose: (id: string) => void
}) {
  const { sideChat, focus, streaming, top, registerPanel, onSend, onStop, onClose } =
    props
  return (
    <div
      className="side-chat-panel"
      style={{ top }}
      ref={(el) => registerPanel(sideChat.id, el)}
    >
      <div className="side-chat-header">
        {/* Title is the LLM-generated 2-3 word summary; blank until the first
            exchange. The focused excerpt is available as a tooltip. */}
        <span className="side-chat-focus" title={focus}>
          ❈ {sideChat.summary ?? ''}
        </span>
        <button
          className="side-chat-close"
          title="Close"
          onClick={() => onClose(sideChat.id)}
        >
          ×
        </button>
      </div>
      <div className="side-chat-messages">
        {sideChat.messages.length === 0 && (
          <p className="side-chat-hint">
            Ask a focused question about the highlighted part.
          </p>
        )}
        {sideChat.messages.map((m) => (
          <div key={m.id} className={'side-msg ' + m.role}>
            {m.role === 'assistant' ? (
              m.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {m.content}
                </ReactMarkdown>
              ) : (
                <span className="cursor">▍</span>
              )
            ) : (
              m.content
            )}
          </div>
        ))}
      </div>
      <Composer
        streaming={streaming}
        placeholder="Ask about this…"
        onSend={(text) => onSend(sideChat.id, text)}
        onStop={onStop}
      />
    </div>
  )
}

function Composer(props: {
  streaming: boolean
  placeholder?: string
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [text, setText] = useState('')

  function submit() {
    if (!text.trim()) return
    props.onSend(text)
    setText('')
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        placeholder={
          props.placeholder ??
          'Message llama…  (Enter to send, Shift+Enter for newline)'
        }
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      {props.streaming ? (
        <button className="stop" onClick={props.onStop}>
          Stop
        </button>
      ) : (
        <button className="send" onClick={submit} disabled={!text.trim()}>
          Send
        </button>
      )}
    </div>
  )
}

function SettingsModal(props: {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
}) {
  const [models, setModels] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function refreshModels() {
    setError(null)
    try {
      setModels(await listModels(props.settings.baseUrl))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label>
          Endpoint
          <input
            value={props.settings.baseUrl}
            onChange={(e) =>
              props.onChange({ ...props.settings, baseUrl: e.target.value })
            }
          />
        </label>
        <label>
          Model
          <input
            list="model-options"
            value={props.settings.model}
            onChange={(e) =>
              props.onChange({ ...props.settings, model: e.target.value })
            }
          />
          <datalist id="model-options">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <div className="modal-actions">
          <button onClick={refreshModels}>List models</button>
          <button className="primary" onClick={props.onClose}>
            Done
          </button>
        </div>
        {error && <p className="modal-error">{error}</p>}
      </div>
    </div>
  )
}

// Keeps the view scrolled to the newest content while the MAIN thread streams.
function ScrollAnchor({ dep }: { dep: unknown }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [dep])
  return <div ref={ref} />
}
