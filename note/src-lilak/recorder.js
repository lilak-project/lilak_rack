import { useSyncExternalStore } from 'react'
import { PORTAL_BASE, authHeaders, load, projectKey } from 'racklist'
import { api } from './api.js'
import { tr } from 'lilak-ui/i18n.jsx'

/** The microphone, for the whole note service — not for one editor.
 *
 *  A recording belongs to the note it began in and goes on while other tabs,
 *  other notes, even other services in the portal are looked at (the portal
 *  keeps this page alive while it says it is busy, `lilak:busy`). It stops
 *  when that note's tab is closed, when the page goes (the service or the
 *  browser closed), after an hour away from the note's editor, or after three
 *  hours whatever.
 *
 *  What is said is cut where the speaker pauses and written down by whisper on
 *  the host (`/api/record/live`). Each piece goes in after the last one — found
 *  by its own text, not by the caret, which has gone wherever the user went —
 *  through the note's editor while it is open, and into the note on the server
 *  while it is not. The recording itself, when it is kept, goes up every few
 *  seconds (`/api/record/chunk`), so a closed browser loses seconds, not an hour.
 */
const KEEP = 'nt-rec-keep'
const LANG = 'nt-rec-lang'
export const LANGS = ['auto', 'ko', 'en', 'ja']
const read = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* a private window */ } }
export const keepFile = () => read(KEEP, '0') === '1'          // off unless asked for
export const setKeepFile = (on) => write(KEEP, on ? '1' : '0')

const RATE = 16000
// Loud enough to be speech, quiet enough to be a pause (RMS of a ~¼ s block).
const LOUD = 0.02, QUIET = 0.008
// A piece is cut at a pause once it is this long, and at this length anyway.
const SHORTEST = 2.5, LONGEST = 8
// A new paragraph (the user's rule), and only after a sentence has ENDED:
// a pause of 10 s; a pause of 2.5 s once it has 300 characters; 500 characters.
// Past 1000 characters a pause of a second will do, full stop or not — whisper
// sometimes writes none for minutes.
const ENDED = /[.?!。？！]$/
export const paragraphEnds = (said, gap, chars) => (chars >= 1000 && gap >= 1)
  || (ENDED.test(said.trim()) && (gap >= 10 || (gap >= 2.5 && chars >= 300) || chars >= 500))
// What whisper is told came before: a punctuated sentence in the language, not
// what was just said. It writes in the manner of what it is shown — given the
// last piece, one piece without full stops made every one after it the same
// (a paragraph of seventeen minutes), and one `으.` made more of them.
const SEED = { ko: '네, 알겠습니다. 다음으로 넘어가죠.', en: 'Okay. Let\'s move on to the next item.', ja: 'はい、わかりました。次に進みましょう。' }
/** What goes before the first words, so they start a paragraph of their own:
 *  nothing on an empty line under an empty one, a line break or two otherwise. */
export const leadFor = (line, above) => (line.trim() ? '\n\n' : above.trim() ? '\n' : '')
const AWAY_MAX = 3600, LONGEST_REC = 3 * 3600, CHUNK_EVERY = 5   // seconds
// Chrome and Firefox record webm; Safari records mp4.
const KIND = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
const extOf = (mime) => (mime.startsWith('audio/mp4') ? '.m4a' : '.webm')

const two = (n) => String(n).padStart(2, '0')
/** The time of day a paragraph was begun: `[14:05:12]`. */
export const stamp = (ms) => {
  const d = new Date(ms)
  return `[${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}]`
}

/** Where text goes after `anchor`: just after its last appearance, or -1 when
 *  there is no anchor yet (then the caret decides), or the end when it has
 *  been edited away. */
export function placeAt(doc, anchor) {
  if (!anchor) return -1
  const i = doc.lastIndexOf(anchor)
  return i < 0 ? doc.length : i + anchor.length
}

// ── the state every button reads ──────────────────────────────────────────
let S = { ready: null, state: 'idle', note: '', title: '', sec: 0, lang: read(LANG, 'auto') }
const subs = new Set()
let told = false
function set(p) {
  S = { ...S, ...p }
  subs.forEach((f) => f())
  // The portal keeps a busy page alive and marks its service (SidebarPortal).
  const on = S.state !== 'idle'
  if (on !== told && window.parent !== window) {
    told = on
    window.parent.postMessage({ type: 'lilak:busy', on }, window.location.origin)
  }
}
const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
export const useRecording = () => useSyncExternalStore(subscribe, () => S)
export const setLang = (v) => { write(LANG, v); set({ lang: v }) }

let asked = false
export function askReady() {
  if (asked) return
  asked = true
  // `ready: true` and nothing else: a server from before this answers the page.
  api('/record').then((r) => r.json()).then((j) => set({ ready: j?.ready === true })).catch(() => set({ ready: false }))
}

/** The service's notice line, as the last editor gave it. */
let say = () => {}
export const setSay = (fn) => { say = fn }

/** The editors open now, by note: the way in while the note is on screen. */
const editors = new Map()
let leftAt = 0
export function attach(id, edit) {
  editors.set(id, edit)
  return () => {
    if (editors.get(id) !== edit) return
    editors.delete(id)
    leftAt = Date.now()
  }
}

// Is the portal showing this page? It says so when it hides or shows it.
let shown = true
window.addEventListener('message', (e) => {
  if (e.origin === window.location.origin && e.data?.type === 'lilak:shown') shown = !!e.data.on
})
const noteTabOpen = (id) => {
  const tabs = load(projectKey('notes', 'panes'), null)?.tabs
  return !Array.isArray(tabs) || tabs.some((t) => t.kind === 'item' && t.who === id)
}

/** `text` into the note after `anchor`; the anchor to use next. */
async function put(note, anchor, text) {
  const edit = editors.get(note)
  if (edit) return edit.after(anchor, text)
  // The editor that just left saves what it had (Editor's unmount): after it.
  const wait = 2500 - (Date.now() - leftAt)
  if (wait > 0) await new Promise((ok) => setTimeout(ok, wait))
  const path = `/notes/${encodeURIComponent(note)}`
  for (let i = 0; i < 3; i += 1) {
    const n = await (await api(path)).json()
    const at = placeAt(n.body, anchor)
    const to = at < 0 ? n.body.length : at
    const body = n.body.slice(0, to) + text + n.body.slice(to)
    const r = await api(path, { method: 'PUT',
      body: JSON.stringify({ baseVersion: n.version, title: n.title, date: n.date, body, fields: n.fields }) })
    if (r.ok) return
    if (r.status !== 409) throw new Error(tr('nt_rec_failed', r.status))
  }
  throw new Error(tr('nt_rec_failed', 409))
}

// ── one recording ─────────────────────────────────────────────────────────
let rec = null

/** 16-bit PCM at 16 kHz, resampled when the browser would not hear at that rate. */
function pcmOf(blocks, rate) {
  const n = blocks.reduce((s, b) => s + b.length, 0)
  const all = new Float32Array(n)
  let at = 0
  for (const b of blocks) { all.set(b, at); at += b.length }
  const out = new Int16Array(Math.floor(n * RATE / rate))
  for (let i = 0; i < out.length; i += 1) {
    const v = Math.max(-1, Math.min(1, all[Math.min(n - 1, Math.round(i * rate / RATE))]))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

export async function start(note, title) {
  if (rec || !editors.get(note)) return
  let stream
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { say(tr('nt_rec_nomic')); return }
  const edit0 = editors.get(note)
  // The editor gone while the browser asked for the microphone: nothing to write into.
  if (!edit0 || rec) { stream.getTracks().forEach((t) => t.stop()); return }
  const lines0 = edit0.text().split('\n')
  const r = rec = { note, anchor: '', said: '', para: 0, lead: leadFor(lines0[edit0.at() - 1] || '', lines0[edit0.at() - 2] || ''), queue: Promise.resolve(), files: Promise.resolve(), seen: Date.now() }
  const lang = S.lang

  // At 16 kHz where the browser will; Firefox will not take a microphone into a
  // context at another rate than its own, so there it is resampled (pcmOf).
  let ctx = new AudioContext({ sampleRate: RATE })
  let src
  try { src = ctx.createMediaStreamSource(stream) } catch {
    ctx.close().catch(() => {})
    ctx = new AudioContext()
    src = ctx.createMediaStreamSource(stream)
  }
  // ponytail: ScriptProcessor is deprecated but in every browser; an
  // AudioWorklet (a module file of its own) if one ever drops it.
  const node = ctx.createScriptProcessor(4096, 1, 1)
  let blocks = [], len = 0, loud = false
  // The audio's own clock: when speech began in this piece, when the last ended.
  let heard = 0, first = 0, last = 0, ended = 0

  const piece = async (pcm, gap, at) => {
    const form = new FormData()
    form.append('f', new Blob([pcm.buffer], { type: 'application/octet-stream' }), 'piece.pcm')
    form.append('lang', lang)
    form.append('prompt', SEED[lang] || '')
    const res = await fetch(`${PORTAL_BASE}/api/record/live`, { method: 'POST', headers: authHeaders(), body: form })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.detail || tr('nt_rec_failed', res.status))
    if (!j.text) return
    const fresh = !r.said || paragraphEnds(r.said, gap, r.para)
    if (fresh) r.para = 0
    // Every paragraph opens with when it was said.
    // `at` is seconds of what was heard, counted from when the microphone began.
    const text = `${!r.said ? r.lead : fresh ? '\n\n' : ' '}${fresh ? `${stamp(began + at * 1000)} ` : ''}${j.text}`
    await put(note, r.anchor, text)
    r.said += ` ${j.text}`
    r.para += j.text.length
    // What was just written, as it stands in the note: where the next goes.
    r.anchor = (r.anchor + text).slice(-80)
  }
  r.cut = () => {
    if (!len) return
    const pcm = pcmOf(blocks, ctx.sampleRate)
    const speech = loud
    blocks = []; len = 0; loud = false
    // Silence is not sent: whisper makes words up for it.
    if (!speech) return
    const gap = ended ? first - ended : 0
    const at = first
    ended = last
    r.queue = r.queue.then(() => piece(pcm, gap, at)).catch((e) => say(String(e.message || e)))
  }
  node.onaudioprocess = (e) => {
    const x = new Float32Array(e.inputBuffer.getChannelData(0))
    let sum = 0
    for (const v of x) sum += v * v
    const rms = Math.sqrt(sum / x.length)
    blocks.push(x); len += x.length
    heard += x.length / ctx.sampleRate
    if (rms > LOUD) {
      if (!loud) first = heard
      loud = true
      last = heard
    }
    const t = len / ctx.sampleRate
    if ((t > SHORTEST && rms < QUIET) || t > LONGEST) r.cut()
  }
  const began = Date.now()
  src.connect(node)
  node.connect(ctx.destination)
  r.quit = () => {
    node.disconnect(); src.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    ctx.close().catch(() => {})
  }

  // The recording itself, if it is kept: named now, its line first, sent up as it goes.
  if (keepFile()) {
    const mimeType = KIND.find((k) => window.MediaRecorder?.isTypeSupported?.(k)) || ''
    const whole = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
    let name = ''
    try {
      const b = await api(`/record/begin?ext=${extOf(whole.mimeType)}`, { method: 'POST' })
      if (!b.ok) throw new Error(tr('nt_rec_failed', b.status))
      name = (await b.json()).name
    } catch (e) { r.quit(); rec = null; say(String(e.message || e)); return }
    const parts = []
    whole.ondataavailable = (e) => { if (e.data.size) parts.push(e.data) }
    const url = `${PORTAL_BASE}/api/record/chunk/${encodeURIComponent(name)}`
    r.send = (o) => {
      if (!parts.length) return
      const body = new Blob(parts.splice(0), { type: whole.mimeType })
      r.files = r.files.then(() => fetch(url, { method: 'POST', headers: authHeaders(), body, ...o }))
        .then((res) => { if (!res.ok) throw new Error(tr('nt_rec_failed', res.status)) })
        .catch((e) => say(String(e.message || e)))
    }
    r.stopFile = async () => {
      await new Promise((ok) => { whole.onstop = ok; whole.stop() })
      r.send()
      await r.files
      await api(`/record/finish/${encodeURIComponent(name)}`, { method: 'POST' }).catch(() => {})
    }
    whole.start(1000)
    r.anchor = `![[${name}]]\n`
    editors.get(note).after('', `${r.lead}${r.anchor}`)
    r.lead = ''
  }

  r.tick = setInterval(() => {
    const sec = S.sec + 1
    if (editors.has(note) && shown && document.visibilityState === 'visible') r.seen = Date.now()
    set({ sec })
    if (sec % CHUNK_EVERY === 0) r.send?.()
    if (!noteTabOpen(note)) stop(tr('nt_rec_stopped_closed'))
    else if (Date.now() - r.seen > AWAY_MAX * 1000) stop(tr('nt_rec_stopped_away'))
    else if (sec >= LONGEST_REC) stop(tr('nt_rec_stopped_long'))
  }, 1000)
  set({ state: 'rec', note, title, sec: 0 })
}

export async function stop(why) {
  const r = rec
  if (!r) return
  rec = null
  clearInterval(r.tick)
  set({ state: 'busy' })
  try {
    r.cut()
    const file = r.stopFile?.()
    r.quit()
    await r.queue
    await file
    say(why || tr('nt_rec_done'))
  } catch (e) { say(String(e.message || e)) } finally { set({ state: 'idle', note: '', title: '', sec: 0 }) }
}

// The page going (the service closed, the browser closed): the last seconds
// of the file go up with it; nothing else can be waited for.
window.addEventListener('pagehide', () => { rec?.send?.({ keepalive: true }) })
