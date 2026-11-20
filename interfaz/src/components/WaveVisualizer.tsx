import type * as Tone from 'tone'
import { useRef } from 'react'
import { useCanvas } from '../hooks/useCanvas'

interface Props {
  analyser: Tone.Analyser
  active: boolean
  playing: boolean
}

/** Mirrored spectrum bars driven by the track's own analyser (flat when muted or stopped). */
export function WaveVisualizer({ analyser, active, playing }: Props) {
  const levels = useRef<number[]>([])
  const canvasRef = useCanvas((ctx, w, h, dt) => {
    ctx.clearRect(0, 0, w, h)
    const bins = analyser.getValue() as Float32Array
    const count = 28
    const bw = w / count
    const mid = h / 2
    const color = active ? '#38ff7a' : '#64748b'
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = active ? 8 : 0
    for (let i = 0; i < count; i++) {
      // Mirror around the centre: low frequencies in the middle.
      const bin = Math.abs(i - count / 2) * (bins.length / (count / 2)) * 0.8
      const db = bins[Math.min(bins.length - 1, Math.floor(bin))] ?? -Infinity
      const target = active && playing && Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 95) / 70)) : 0
      const prev = levels.current[i] ?? 0
      const v = prev + (target - prev) * Math.min(1, dt * 18)
      levels.current[i] = v
      const bh = Math.max(2, v * h * 0.95)
      ctx.fillRect(i * bw + bw * 0.25, mid - bh / 2, bw * 0.5, bh)
    }
    ctx.shadowBlur = 0
  })
  return <canvas ref={canvasRef} className="h-full w-full" />
}
