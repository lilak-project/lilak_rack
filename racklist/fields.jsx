/**
 * The two shapes every record form is made of.
 *
 * They were copied into each service, and had already drifted — the same text
 * row was 300px wide in one and 320px in the other, for no reason either could
 * have told you.
 */

/** A labelled row of the record grid: the label in the left column, whatever
 *  the field is in the right one. */
export function RackField({ label, children }) {
  return (<><span className="rl-fl">{label}</span><div className="rl-fv">{children}</div></>)
}

/** A field that holds SEVERAL plain strings — links, roots, other spellings —
 *  one line each, with a way to add another and an × to drop one. */
export function RackTextRows({ value = [], onChange, add, placeholder, link, width = 320 }) {
  return (
    <div className="rl-rows">
      {value.length === 0 && <span className="rl-hint">없음</span>}
      {value.map((v, i) => (
        <div key={i} className="rl-rrow">
          <input className="rl-in" style={{ width }} placeholder={placeholder} value={v}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          {link && /^https?:\/\//.test(v) && (
            <a href={v} target="_blank" rel="noreferrer" className="rl-hint">열기</a>
          )}
          <button type="button" className="rl-x" title="이 줄 지우기"
            onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="rl-btn" onClick={() => onChange([...value, ''])}>{add}</button>
    </div>
  )
}
