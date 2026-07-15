# dichala

A branching-chat LLM UI. The familiar single-column chat of claude.ai / ChatGPT,
plus the ability to **branch** the conversation at any point to explore an idea
in parallel without disturbing the main thread.

## Data model

A conversation is a **tree** of message nodes (`src/lib/types.ts`). Each node
knows its `parentId`; the thread you see is the path from the root to the active
leaf (`src/lib/tree.ts`). Branching is just: give a node more than one child.

## Running locally

You need [Ollama](https://ollama.com) running with a model pulled:

```bash
ollama pull llama3.2:latest   # or set another model in the app's Settings
```

Then:

```bash
npm install
npm run dev        # http://localhost:5173
```

During dev, the app calls `/ollama/...`, which Vite proxies to
`http://localhost:11434` (see `vite.config.ts`). This avoids any CORS setup.

## Project layout

| Path                | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `src/lib/types.ts`  | The tree data model (nodes + conversations)        |
| `src/lib/tree.ts`   | Pure helpers to walk the tree                       |
| `src/lib/ollama.ts` | Streaming chat client (swap this to change backend) |
| `src/lib/storage.ts`| Persistence (localStorage for now)                  |
| `src/App.tsx`       | UI: sidebar, message view, composer, settings       |

## Build

```bash
npm run build      # type-checks and outputs a static site to dist/
```

The output is fully static, which is what will eventually be deployed to GitHub
Pages. In a deployed build there is no proxy, so the model endpoint is whatever
you set in **Settings** (bring-your-own endpoint / key).
