import { useEffect, useMemo, useState } from 'react'
import { RackActions } from './actions.jsx'
import { RackField, RackTextRows } from './fields.jsx'
import { useRackKeys } from './hooks.js'

/**
 * The editor for ONE class — a tag, a journal, a group: a name that records
 * wear rather than a record of its own.
 *
 * Every rack-list service has the same three questions about one, and had
 * written them out separately: what is it called, what other names mean the
 * same thing, and what wears it. The answers are the same shape everywhere,
 * so the shape lives here; what the save DOES is not, because a tag is an
 * array in one service's document and text inside another's files.
 *
 *   onSave(gone, to, said)   `gone` is every name that disappears, including
 *                            this one; `to` is the name that survives; `said`
 *                            is the sentence to show for what happened.
 *   wearing(names)           the records wearing any of those names, as
 *                            { id, label } — recomputed as names are added.
 *   onOpen(id)               if given, each one is a link to it.
 *
 * Renaming onto a name that already exists IS merging: one path, so a service
 * cannot have them disagree.
 */
export function RackEditClass({
  name, noun = '태그', wears = '쓰는 것', unit = '개',
  exists = [], wearing, onSave, onOpen, onCancel,
  onDelete, deleteWarn, listMax = 12, children,
}) {
  const [to, setTo] = useState(name)
  const [absorb, setAbsorb] = useState([])
  useEffect(() => { setTo(name); setAbsorb([]) }, [name])

  const named = String(to || '').trim()
  // This one always goes: either it is renamed, or it is folded into another.
  const gone = useMemo(
    () => [name, ...absorb.filter((t) => t && t !== name)], [name, absorb])
  const users = useMemo(() => wearing(gone) || [], [wearing, gone])
  const merging = absorb.length > 0 || (!!named && named !== name && exists.includes(named))
  const nothing = !named || (named === name && !absorb.length)

  function save() {
    if (nothing) return
    onSave(gone, named, absorb.length
      ? `${noun} ${gone.length}개를 '${named}' 하나로 합쳤습니다`
      : merging ? `'${name}'을 '${named}'에 합쳤습니다`
        : `'${name}' → '${named}'`)
  }
  // ⌘S saves and stays; closing is ⌘X's job.
  useRackKeys({ onSave: save })

  const listId = `rl-cls-${noun}`
  return (
    <div className="rl-edit">
      <RackActions key={name} saveLabel={merging ? '합치기' : 'save'}
        onSave={save} saveDisabled={nothing} onCancel={onCancel}
        onRevert={() => { setTo(name); setAbsorb([]) }}
        onDelete={onDelete} deleteWarn={deleteWarn} />
      <div className="rl-rec">
        <RackField label={noun}>
          <input className="rl-in" style={{ width: 260 }} list={listId} value={to || ''}
            onChange={(e) => setTo(e.target.value)} />
          <datalist id={listId}>{exists.map((t) => <option key={t} value={t} />)}</datalist>
          {named !== name && exists.includes(named)
            && <span className="rl-hint">이미 있는 {noun}입니다 — 합쳐집니다.</span>}
        </RackField>
        <RackField label={`합칠 ${noun}`}>
          <RackTextRows value={absorb} add={`+ ${noun}`} placeholder={noun}
            onChange={(v) => setAbsorb(v.filter((t) => t !== named))} />
          <span className="rl-hint">
            {absorb.length
              ? `이 ${absorb.length}개가 '${named || name}'이 됩니다 — 합쳐서 ${users.length}${unit}`
              : `같은 뜻의 다른 ${noun}를 적으면 이 ${noun}로 합쳐집니다.`}
          </span>
        </RackField>
        <RackField label={wears}>
          <div className="rl-rows">
            {users.length === 0 && <span className="rl-hint">없음</span>}
            {users.slice(0, listMax).map((u) => (onOpen ? (
              <button key={u.id} type="button" className="rl-lnk"
                onClick={() => onOpen(u.id)}>{u.label}</button>
            ) : (
              <span key={u.id} className="rl-hint">{u.label}</span>
            )))}
            {users.length > listMax
              && <span className="rl-hint">… 모두 {users.length}{unit}</span>}
          </div>
        </RackField>
        {/* Whatever this one class has that the others do not. */}
        {children}
      </div>
    </div>
  )
}
