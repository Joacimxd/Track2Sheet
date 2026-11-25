import type * as Tone from 'tone'
import { useRef } from 'react'
import { useCanvas } from '../hooks/useCanvas'

interface Props {
  analyser: Tone.Analyser
  /** Gel colour of the stem. */
  color: string
  active: boolean
  playing: boolean
}

/** Horizontal level meter: the stem's light passing through its gel. Rests as a dim track. */
export function LevelMeter({ analyser, color, active, playing }: Props) {
  const level = useRef(0)
  const peak = useRef(0)
  const canvasRef = useCanvas((ctx, w, h, dt) => {
    ctx.clearRect(0, 0, w, h)
    const bins = analyser.getValue() as Float32Array
    let db = -Infinity
    for (let i = 0; i < bins.length; i++) db = Math.max(db, bins[i])
    const target = active && playing && Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 80) / 62)) : 0
    // Fast attack, slower release, like a real meter.
    const k = target > level.current ? Math.min(1, dt * 30) : Math.min(1, dt * 6)
    level.current += (target - level.current) * k
    peak.current = Math.max(level.current, peak.current - dt * 0.5)

    const y = (h - 4) / 2
    ctx.fillStyle = '#25272d'
    ctx.beginPath()
    ctx.roundRect(0, y, w, 4, 2)
    ctx.fill()
    if (level.current > 0.005) {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(0, y, Math.max(4, level.current * w), 4, 2)
      ctx.fill()
    }
    if (peak.current > 0.02) {
      ctx.fillStyle = color
      ctx.fillRect(Math.min(w - 2, peak.current * w), y - 2, 2, 8)
    }
  })
  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
}
