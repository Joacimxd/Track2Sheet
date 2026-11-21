import type * as Tone from 'tone'
import { useRef } from 'react'
import { useCanvas } from '../hooks/useCanvas'

interface Props {
  /** One or more stem analysers (a group shows the loudest of them per band). */
  analysers: Tone.Analyser[]
  active: boolean
  playing: boolean
}

/** Mirrored spectrum bars; at rest it collapses to the dotted line of the mockup. */
export function WaveVisualizer({ analysers, active, playing }: Props) {
  const levels = useRef<number[]>([])
  const canvasRef = useCanvas((ctx, w, h, dt) => {
    ctx.clearRect(0, 0, w, h)
    const count = Math.max(12, Math.floor(w / 7))
    const bw = w / count
    const mid = h / 2
    const color = active ? '#38ff7a' : '#475569'
    const bins = analysers.map((a) => a.getValue() as Float32Array)
    const len = bins[0]?.length ?? 0
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = active ? 6 : 0
    for (let i = 0; i < count; i++) {
      const bin = Math.min(len - 1, Math.floor(Math.abs(i - count / 2) * (len / (count / 2)) * 0.8))
      let db = -Infinity
      for (const b of bins) db = Math.max(db, b[bin] ?? -Infinity)
      const target = active && playing && Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 95) / 70)) : 0
      const prev = levels.current[i] ?? 0
      const v = prev + (target - prev) * Math.min(1, dt * 18)
      levels.current[i] = v
      const bh = Math.max(2.5, v * h * 0.95)
      const x = i * bw + bw * 0.3
      ctx.beginPath()
      ctx.roundRect(x, mid - bh / 2, Math.max(2.5, bw * 0.4), bh, 1.5)
      ctx.fill()
    }
    ctx.shadowBlur = 0
  })
  return <canvas ref={canvasRef} className="h-full w-full" />
}
