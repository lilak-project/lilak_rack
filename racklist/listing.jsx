import './strings.js'
import { useState } from 'react'
import { fill } from './sort.js'
import { tr } from '../i18n.jsx'

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
export function RackListing({ list, picked, tokens, presets = [], say, open, setOpen, unit = tr("rk_unit_items"), extra }) {
  const first = presets[0] || ['', Object.keys(tokens).slice(0, 2).map((k) => `{${k}}`).join(' '), ', ']
  const [tpl, setTpl] = useState(first[1])
  const [sep, setSep] = useState(first[2] ?? ', ')
  // Derived, not stored: editing the rule changes the text under your hands.
  const out = list.map((r) => fill(tpl, r, tokens)).filter(Boolean).join(String(sep).replaceAll('⏎', '\n'))
  const none = list.length === 0

  async function copy() {
    if (!out) { say?.(tr("rk_nothing_to_list")); return }
    try { await navigator.clipboard.writeText(out); say?.(tr("rk_copied")) }
    catch { say?.(tr("rk_copy_failed")) }
  }

  return (
    <div className="rl-out">
      {/* Folded by default: the list is what you came for, the text it makes is
          what you leave with. */}
      <button type="button" className={`rl-outhead${open ? ' on' : ''}`} onClick={() => setOpen(!open)}
        aria-expanded={open}>
        <i className="rl-caret">{open ? '▾' : '▸'}</i>
        <span>{tr("rk_listing")}</span>
        <span className="rl-hint">{picked ? tr("rk_selected_n", list.length, unit) : `${list.length}${unit}`}</span>
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
          <span className="rl-hint">{tr("rk_listing_rule")}</span>
          <input className="rl-in rl-mono" style={{ flex: 1, minWidth: 180 }} value={tpl}
            onChange={(e) => setTpl(e.target.value)} />
          <span className="rl-hint">{tr("rk_between")}</span>
          <input className="rl-in rl-mono" style={{ width: 66 }} value={sep}
            onChange={(e) => setSep(e.target.value)} title={tr("rk_separator")} />
          <button type="button" className="rl-btn" title={tr("rk_add_newline")}
            onClick={() => setSep((v) => `${v}⏎`)}>+⏎</button>
        </div>
        <div className="rl-tokens">
          {Object.keys(tokens).map((k) => (
            <button key={k} type="button" className="rl-tok"
              onClick={() => setTpl((v) => `${v}{${k}}`)}>{`{${k}}`}</button>
          ))}
        </div>
        <textarea className="rl-outbox" value={out} readOnly
          placeholder={none ? tr("rk_tab_empty") : ''} />
      </>)}
    </div>
  )
}
