import './strings.js'
import { tr } from '../i18n.jsx'
/**
 * The two shapes every record form is made of.
 *
 * They were copied into each service, and had already drifted — the same text
 * row was 300px wide in one and 320px in the other, for no reason either could
 * have told you.
 */

/** A labelled row of the record grid: the label in the left column, whatever
 *  the field is in the right one. `tone` (a colour) lights the label — a field
 *  that applies to the record's kind. */
export function RackField({ label, tone, off, children }) {
  return (
    <>
      <span className={`rl-fl${tone ? ' fit' : ''}${off ? ' off' : ''}`} style={tone ? { '--c': tone } : undefined}>{label}</span>
      <div className="rl-fv">{children}</div>
    </>
  )
}

/** A field that holds SEVERAL plain strings — links, roots, other spellings —
 *  one line each, with a way to add another and an × to drop one. */
export function RackTextRows({ value = [], onChange, add, placeholder, link, width = 320 }) {
  return (
    <div className="rl-rows">
      {value.length === 0 && <span className="rl-hint">{tr("rk_none")}</span>}
      {value.map((v, i) => (
        <div key={i} className="rl-rrow">
          <input className="rl-in" style={{ width }} placeholder={placeholder} value={v}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          {link && /^https?:\/\//.test(v) && (
            <a href={v} target="_blank" rel="noreferrer" className="rl-hint">{tr("rk_open")}</a>
          )}
          <button type="button" className="rl-x" title={tr("rk_delete_row")}
            onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="rl-btn" onClick={() => onChange([...value, ''])}>{add}</button>
    </div>
  )
}
