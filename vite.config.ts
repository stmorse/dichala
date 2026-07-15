import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built site works when served from a GitHub Pages
  // subpath like https://<user>.github.io/dichala/ . We'll revisit at deploy time.
  base: './',
  plugins: [react()],
  server: {
    // Pin the port so the browser origin (and therefore localStorage) stays
    // stable across restarts. strictPort makes a conflict fail loudly instead
    // of silently drifting to :5174, which would look like "lost" chats.
    port: 5173,
    strictPort: true,
    proxy: {
      // During `npm run dev`, the browser calls /ollama/... on our own dev
      // server and Vite forwards it to the real Ollama. This sidesteps CORS
      // entirely for local development. In a deployed (static) build there is
      // no proxy, so the app calls the user's configured endpoint directly.
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
    },
  },
})
