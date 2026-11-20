import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { outputApi } from './server/outputApi.ts'

// Folder produced by the separation/transcription pipeline (defaults to ../output).
const outputDir = process.env.TRACK2SHEET_OUTPUT ?? path.resolve(import.meta.dirname, '../output')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), outputApi(outputDir)],
})
