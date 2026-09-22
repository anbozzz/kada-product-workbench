import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  base: '/studio-assets/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../web',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react-core', test: /node_modules\/(?:react|react-dom|scheduler)\// },
            { name: 'radix-ui', test: /node_modules\/(?:radix-ui|@radix-ui)\// },
            { name: 'drag-drop', test: /node_modules\/@dnd-kit\// },
            {
              name: 'canvas-tools',
              test: /node_modules\/(?:react-zoom-pan-pinch|react-resizable-panels)\//,
            },
            { name: 'icons', test: /node_modules\/lucide-react\// },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
