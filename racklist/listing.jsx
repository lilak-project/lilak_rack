import { useState } from 'react'
import { fill } from './sort.js'

/**
 * [나열] — the drawer under a table that turns its records into text by a rule.
 *
 * The buttons do not produce text: they fill in a TEMPLATE, and the template
 * makes the text, so a shape nobody thought of is an edit rather than a feature
 * request. The tokens are the field names. It lists what you ticked, or the
 * whole tab when nothing is ticked.
 *
 *   presets   [[label, template, separator]] — ⏎ in a separator is a newline
 *   tokens    { name: (rec) => string }
 */
export function RackListing({ list, picked, tokens, presets = [], say, open, setOpen, unit = '개', extra }) {
  const first = presets[0] || ['', Object.keys(tokens).slice(0, 2).map((k) => `{${k}}`).join(' '), ', ']
  const [tpl, setTpl] = useState(first[1])
  const [sep, setSep] = useState(first[2] ?? ', ')
  // Derived, not stored: editing the rule changes the text under your hands.
  const out = list.map((r) => fill(tpl, r, tokens)).filter(Boolean).join(String(sep).replaceAll('⏎', '\n'))
  const none = list.length === 0

  async function copy() {
    if (!out) { say?.('나열할 것이 없습니다.'); return }
    try { await navigator.clipboard.writeText(out); say?.('복사했습니다.') }
    catch { say?.('복사 실패 — 직접 선택해 복사하세요.') }
  }

  return (
    <div className="rl-out">
      {/* Folded by default: the list is what you came for, the text it makes is
          what you leave with. */}
      <button type="button" className={`rl-outhead${open ? ' on' : ''}`} onClick={() => setOpen(!open)}
        aria-expanded={open}>
        <i className="rl-caret">{open ? '▾' : '▸'}</i>
        <span>나열</span>
        <span className="rl-hint">{picked ? `선택한 ${list.length}${unit}` : `${list.length}${unit}`}</span>
      </button>
      {open && (<>
        <div className="rl-outbar">
          {presets.map(([label, t, s]) => (
            <button key={label} type="button" className={`rl-btn${tpl === t ? ' on' : ''}`}
              disabled={none} onClick={() => { setTpl(t); setSep(s ?? ', ') }}>{label}</button>
          ))}
          {extra}
          <span className="rl-sp" />
          <button type="button" className="rl-btn" disabled={!out} onClick={copy}>copy</button>
        </div>
        <div className="rl-rule-line">
          <span className="rl-hint">나열 규칙</span>
          <input className="rl-in rl-mono" style={{ flex: 1, minWidth: 180 }} value={tpl}
            onChange={(e) => setTpl(e.target.value)} />
          <span className="rl-hint">사이</span>
          <input className="rl-in rl-mono" style={{ width: 66 }} value={sep}
            onChange={(e) => setSep(e.target.value)} title="구분기호" />
          <button type="button" className="rl-btn" title="줄바꿈 추가"
            onClick={() => setSep((v) => `${v}⏎`)}>+⏎</button>
        </div>
        <div className="rl-tokens">
          {Object.keys(tokens).map((k) => (
            <button key={k} type="button" className="rl-tok"
              onClick={() => setTpl((v) => `${v}{${k}}`)}>{`{${k}}`}</button>
          ))}
        </div>
        <textarea className="rl-outbox" value={out} readOnly
          placeholder={none ? '이 탭에 아무것도 없습니다.' : ''} />
      </>)}
    </div>
  )
}
