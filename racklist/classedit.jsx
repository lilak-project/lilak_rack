import './strings.js'
import { useEffect, useMemo, useState } from 'react'
import { RackActions } from './actions.jsx'
import { RackField, RackTextRows } from './fields.jsx'
import { useRackKeys } from './hooks.js'
import { tr } from '../i18n.jsx'

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
  name, noun = tr("rk_tag"), wears = tr("rk_using_it"), unit = tr("rk_unit_items"),
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
      ? tr("rk_merged_into_one", noun, gone.length, named)
      : merging ? tr("rk_merged_into", name, named)
        : `'${name}' → '${named}'`)
  }
  // ⌘S saves and stays; closing is ⌘X's job.
  useRackKeys({ onSave: save })

  const listId = `rl-cls-${noun}`
  return (
    <div className="rl-edit">
      <RackActions key={name} saveLabel={merging ? tr("rk_merge") : 'save'}
        onSave={save} saveDisabled={nothing} onCancel={onCancel}
        onRevert={() => { setTo(name); setAbsorb([]) }}
        onDelete={onDelete} deleteWarn={deleteWarn} />
      <div className="rl-rec">
        <RackField label={noun}>
          <input className="rl-in" style={{ width: 260 }} list={listId} value={to || ''}
            onChange={(e) => setTo(e.target.value)} />
          <datalist id={listId}>{exists.map((t) => <option key={t} value={t} />)}</datalist>
          {named !== name && exists.includes(named)
            && <span className="rl-hint">{tr("rk_exists_will_merge", noun)}</span>}
        </RackField>
        <RackField label={tr("rk_to_merge", noun)}>
          <RackTextRows value={absorb} add={`+ ${noun}`} placeholder={noun}
            onChange={(v) => setAbsorb(v.filter((t) => t !== named))} />
          <span className="rl-hint">
            {absorb.length
              ? tr("rk_these_become", absorb.length, named || name, users.length, unit)
              : tr("rk_same_meaning_hint", noun, noun)}
          </span>
        </RackField>
        <RackField label={wears}>
          <div className="rl-rows">
            {users.length === 0 && <span className="rl-hint">{tr("rk_none")}</span>}
            {users.slice(0, listMax).map((u) => (onOpen ? (
              <button key={u.id} type="button" className="rl-lnk"
                onClick={() => onOpen(u.id)}>{u.label}</button>
            ) : (
              <span key={u.id} className="rl-hint">{u.label}</span>
            )))}
            {users.length > listMax
              && <span className="rl-hint">{tr("rk_all_n_unit", users.length, unit)}</span>}
          </div>
        </RackField>
        {/* Whatever this one class has that the others do not. */}
        {children}
      </div>
    </div>
  )
}
