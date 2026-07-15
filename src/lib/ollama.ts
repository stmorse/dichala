// Thin client for the Ollama chat API. Isolated here so that swapping in a
// different backend later (a hosted API, an OpenAI-compatible endpoint, etc.)
// means changing this one file, not the UI.

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// Streams a chat completion, invoking onToken for each chunk of text as it
// arrives. Resolves when the stream ends. Pass an AbortSignal to cancel.
export async function streamChat(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Ollama request failed (${res.status}). ${detail}`)
  }

  // Ollama streams newline-delimited JSON objects. We buffer partial lines
  // because a network chunk can split a JSON object across reads.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep the last, possibly-incomplete line
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const chunk = JSON.parse(trimmed) as { message?: { content?: string } }
      if (chunk.message?.content) onToken(chunk.message.content)
    }
  }
}

// Lists locally available model names from an Ollama server.
export async function listModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`)
  if (!res.ok) throw new Error(`Could not list models (${res.status})`)
  const data = (await res.json()) as { models?: { name: string }[] }
  return (data.models ?? []).map((m) => m.name)
}
