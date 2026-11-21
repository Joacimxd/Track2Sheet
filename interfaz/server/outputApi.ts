// Vite middleware that exposes the pipeline's `output/` folder to the UI.
//
//   GET /api/songs            -> list of processed songs (stems + MIDI files)
//   GET /api/file?p=<rel>     -> raw file inside output/ (path-traversal safe)
//
// Expected layout (MIDI files may live next to the stems or in output/midi/<song>/):
//   output/stems/<song>/{guitar,drums,vocals,bass,piano,other}.wav
//   output/midi/<song>/{guitar,drums}.mid
import fs from 'node:fs'
import path from 'node:path'
import type { Connect, Plugin } from 'vite'

const AUDIO_EXT = new Set(['.wav', '.flac', '.mp3', '.ogg', '.m4a'])
const MIDI_EXT = new Set(['.mid', '.midi'])
const MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
}

type Stem = 'bass' | 'drums' | 'guitar' | 'other' | 'piano' | 'vocals'
type Instrument = 'guitar' | 'drums'

export interface ApiFile {
  name: string
  path: string
}

export interface ApiSong {
  id: string
  title: string
  stems: Partial<Record<Stem, ApiFile>>
  midi: Partial<Record<Instrument, ApiFile>>
}

export function classify(fileName: string): Stem | null {
  const n = fileName.toLowerCase()
  if (/guitar|guitarra/.test(n)) return 'guitar'
  if (/drum|bater[ií]a|percus/.test(n)) return 'drums'
  if (/bass|bajo/.test(n)) return 'bass'
  if (/piano|keys|teclado/.test(n)) return 'piano'
  if (/vocal|voice|voz|voces/.test(n)) return 'vocals'
  if (/other|otros/.test(n)) return 'other'
  return null
}

function prettyTitle(dir: string): string {
  return dir
    .replace(/\s*\[[^\]]+\]\s*$/, '')
    .replace(/_/g, ' ')
    .replace(/\s+-\s+/g, ' — ')
    .trim()
}

function listFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile())
  } catch {
    return []
  }
}

function scanSongs(root: string): ApiSong[] {
  const stemsDir = path.join(root, 'stems')
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync(stemsDir).filter((d) => fs.statSync(path.join(stemsDir, d)).isDirectory())
  } catch {
    return []
  }

  return dirs.map((dir) => {
    const song: ApiSong = { id: dir, title: prettyTitle(dir), stems: {}, midi: {} }
    const candidates = [path.join(stemsDir, dir), path.join(root, 'midi', dir)]
    for (const folder of candidates) {
      for (const f of listFiles(folder)) {
        const ext = path.extname(f).toLowerCase()
        const rel = path.relative(root, path.join(folder, f)).split(path.sep).join('/')
        const stem = classify(f)
        if (!stem) continue
        if (AUDIO_EXT.has(ext)) {
          song.stems[stem] ??= { name: f, path: rel }
        } else if (MIDI_EXT.has(ext) && (stem === 'guitar' || stem === 'drums')) {
          song.midi[stem] ??= { name: f, path: rel }
        }
      }
    }
    return song
  })
}

function middleware(root: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/songs') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ root, songs: scanSongs(root) }))
      return
    }
    if (url.pathname === '/api/file') {
      const rel = url.searchParams.get('p') ?? ''
      const abs = path.resolve(root, rel)
      if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) {
        res.statusCode = 404
        res.end('Not found')
        return
      }
      res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream')
      res.setHeader('Content-Length', fs.statSync(abs).size)
      fs.createReadStream(abs).pipe(res)
      return
    }
    next()
  }
}

export function outputApi(outputDir: string): Plugin {
  const root = path.resolve(outputDir)
  return {
    name: 'track2sheet-output-api',
    configureServer(server) {
      server.middlewares.use(middleware(root))
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(root))
    },
  }
}
