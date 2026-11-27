import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { outputApi } from './server/outputApi.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), outputApi(path.resolve(import.meta.dirname, '../output'))],
})
