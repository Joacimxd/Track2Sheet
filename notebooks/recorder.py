"""Microphone recorder widget for the Basic Pitch notebook.

Jupyter runs in Docker, which can't reach the Mac's microphone, so recording happens in the
browser: getUserMedia + MediaRecorder capture the take, the browser decodes it and resamples it to
mono at Basic Pitch's 22 050 Hz, encodes a 16-bit WAV and sends the bytes to Python
(`recorder.wav`). Browser voice processing (echo cancellation, noise suppression, auto gain) is
turned off because it mangles instruments.

The browser only allows the microphone on a secure origin: open Jupyter at http://127.0.0.1:<port>
or http://localhost:<port>.
"""

import anywidget
import traitlets

_ESM = r"""
function wavBytes(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

/** Decode whatever MediaRecorder produced (webm/opus, mp4/aac…) → mono Float32 at `sr`. */
async function toMono(blob, sr) {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * sr)), sr)
    const src = off.createBufferSource()
    src.buffer = decoded
    src.connect(off.destination)
    src.start()
    return (await off.startRendering()).getChannelData(0)
  } finally {
    ctx.close()
  }
}

const pad = (n) => String(n).padStart(2, '0')
const stamp = () => {
  const d = new Date()
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
const clock = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`

export default {
  render({ model, el }) {
    el.innerHTML = `
      <div class="t2s-rec">
        <div class="t2s-row">
          <button class="t2s-btn" type="button">● Record</button>
          <select class="t2s-dev" title="Audio input"></select>
          <span class="t2s-time">0:00</span>
        </div>
        <div class="t2s-meter" title="Input level"><div class="t2s-fill"></div></div>
        <div class="t2s-status">Press Record and allow the microphone.</div>
        <audio class="t2s-play" controls hidden></audio>
      </div>`
    const $ = (s) => el.querySelector(s)
    const btn = $('.t2s-btn'), dev = $('.t2s-dev'), time = $('.t2s-time')
    const fill = $('.t2s-fill'), status = $('.t2s-status'), player = $('.t2s-play')
    let stream = null, rec = null, ctx = null, chunks = [], raf = 0, timer = 0, t0 = 0, peak = 0, url = null

    const setDevices = (devices) => {
      const current = dev.value
      dev.replaceChildren()
      const def = document.createElement('option')
      def.value = ''
      def.textContent = 'Default microphone'
      dev.append(def)
      devices.forEach((d, i) => {
        const o = document.createElement('option')
        o.value = d.deviceId
        o.textContent = d.label || `Input ${i + 1}`
        dev.append(o)
      })
      dev.value = current
    }
    const listDevices = async () => {
      try {
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'))
      } catch { setDevices([]) }
    }
    listDevices()

    const release = () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      ctx?.close()
      stream = ctx = null
      fill.style.width = '0%'
      fill.classList.remove('t2s-clip')
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        status.textContent = 'The browser blocks the microphone here: open Jupyter at http://127.0.0.1 or http://localhost.'
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: dev.value ? { exact: dev.value } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })
      } catch (e) {
        status.textContent = `No microphone access: ${e.message}`
        return
      }
      listDevices() // labels are only visible after permission is granted

      // Live input meter (red when clipping).
      ctx = new AudioContext()
      const an = ctx.createAnalyser()
      an.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(an)
      const buf = new Float32Array(an.fftSize)
      peak = 0
      const meter = () => {
        an.getFloatTimeDomainData(buf)
        let p = 0
        for (const x of buf) p = Math.max(p, Math.abs(x))
        peak = Math.max(peak, p)
        fill.style.width = `${Math.min(100, p * 100)}%`
        fill.classList.toggle('t2s-clip', p > 0.98)
        raf = requestAnimationFrame(meter)
      }
      meter()

      chunks = []
      rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = finish
      rec.start()
      t0 = performance.now()
      timer = setInterval(() => {
        const s = (performance.now() - t0) / 1000
        time.textContent = clock(s)
        if (s >= model.get('max_seconds')) stop()
      }, 200)
      btn.textContent = '■ Stop'
      btn.classList.add('t2s-on')
      dev.disabled = true
      status.textContent = 'Recording… play, then press Stop.'
    }

    const stop = () => { if (rec?.state === 'recording') rec.stop() }

    const finish = async () => {
      const blob = new Blob(chunks, { type: rec.mimeType })
      const takePeak = peak
      release()
      btn.textContent = '● Record'
      btn.classList.remove('t2s-on')
      btn.disabled = true
      dev.disabled = false
      status.textContent = 'Processing…'
      try {
        const sr = model.get('sample_rate')
        const mono = await toMono(blob, sr)
        const wav = wavBytes(mono, sr)
        model.set('wav', new DataView(wav))
        model.set('taken_at', stamp())
        model.set('duration', mono.length / sr)
        model.save_changes()
        if (url) URL.revokeObjectURL(url)
        url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
        player.src = url
        player.hidden = false
        const warn = takePeak > 0.98 ? ' ⚠ It clipped: lower the input gain.' : takePeak < 0.05 ? ' ⚠ Very quiet: raise the input gain or get closer.' : ''
        status.textContent = `Take ready: ${(mono.length / sr).toFixed(1)} s.${warn} Run the next cell.`
      } catch (e) {
        status.textContent = `Could not process the recording: ${e.message}`
      }
      btn.disabled = false
    }

    btn.onclick = () => (rec?.state === 'recording' ? stop() : start())
    return () => {
      if (rec?.state === 'recording') { rec.onstop = null; rec.stop() }
      release()
      if (url) URL.revokeObjectURL(url)
    }
  },
}
"""

_CSS = """
.t2s-rec { display: flex; flex-direction: column; gap: 8px; max-width: 520px; padding: 4px 0;
  font-family: var(--jp-ui-font-family, sans-serif); color: var(--jp-ui-font-color1, inherit); }
.t2s-row { display: flex; align-items: center; gap: 8px; }
.t2s-btn { height: 32px; padding: 0 14px; border: 1px solid var(--jp-border-color1, #888); border-radius: 6px;
  background: var(--jp-layout-color2, #eee); color: inherit; font-weight: 600; cursor: pointer; }
.t2s-btn.t2s-on { background: #e0503a; border-color: #e0503a; color: #fff; }
.t2s-btn:disabled { opacity: 0.6; cursor: wait; }
.t2s-dev { height: 32px; min-width: 0; flex: 1; border-radius: 6px; }
.t2s-time { font-variant-numeric: tabular-nums; min-width: 3.5em; text-align: right; }
.t2s-meter { height: 6px; border-radius: 3px; background: var(--jp-layout-color3, #ccc); overflow: hidden; }
.t2s-fill { height: 100%; width: 0%; background: #4fb286; transition: width 60ms linear; }
.t2s-fill.t2s-clip { background: #e0503a; }
.t2s-status { font-size: 13px; color: var(--jp-ui-font-color2, #666); }
.t2s-play { width: 100%; }
"""


class Recorder(anywidget.AnyWidget):
    """Record a take in the browser. After Stop, `wav` holds a mono 16-bit WAV at `sample_rate`."""

    _esm = _ESM
    _css = _CSS
    wav = traitlets.Bytes(b"").tag(sync=True)
    taken_at = traitlets.Unicode("").tag(sync=True)
    duration = traitlets.Float(0.0).tag(sync=True)
    sample_rate = traitlets.Int(22050).tag(sync=True)  # Basic Pitch's model rate
    max_seconds = traitlets.Int(300).tag(sync=True)
