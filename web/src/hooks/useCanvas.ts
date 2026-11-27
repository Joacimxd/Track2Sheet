import { useEffect, useRef } from 'react'

type DrawFn = (ctx: CanvasRenderingContext2D, width: number, height: number, dt: number) => void

export function useCanvas(draw: DrawFn) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  useEffect(() => {
    drawRef.current = draw
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let width = 0
    let height = 0
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (width > 0 && height > 0) drawRef.current(ctx, width, height, dt)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  return canvasRef
}
