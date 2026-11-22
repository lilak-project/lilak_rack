import './strings.js'
import { tr } from 'lilak-ui/i18n.jsx'
import { RackField, isManager } from 'racklist'

/**
 * What a manager decides for everyone else, kept in the document's `settings`
 * under the names asset manager wrote (the data carries them over):
 *
 *   allowMove    off: someone else's 위치 적용 waits for a manager (승인 요청)
 *   allowCreate  off: no new assets — no +new, no clone, no XLSX registering
 *   allowPhoto   off: the photos are shown, not changed
 *   fieldVis     { field: false } — that field is not shown to others
 *
 * A manager always sees and may do everything. This is what the screen shows,
 * not a lock: the document reaches everyone's browser whole.
 */
export const HIDEABLE = ['accountHolder', 'applicationName', 'spec', 'memo', 'manufacturerProvider', 'acquisitionDate', 'acquisitionPriceKrw']
const SWITCHES = [['allowMove', 'as_set_move'], ['allowCreate', 'as_set_create'], ['allowPhoto', 'as_set_photo']]

export const settingsOf = (doc) => doc?.settings || {}
const on = (doc, k) => settingsOf(doc)[k] !== false
export const canMove = (doc) => isManager() || on(doc, 'allowMove')
export const canAdd = (doc) => isManager() || on(doc, 'allowCreate')
export const canPhoto = (doc) => isManager() || on(doc, 'allowPhoto')
/** Is this field shown to whoever is looking? */
export const shows = (doc, k) => isManager() || !HIDEABLE.includes(k) || settingsOf(doc).fieldVis?.[k] !== false

/** The settings tab's own part (slots.settings, a manager's). */
export function InventorySettings({ api }) {
  const { doc, def } = api
  const set = settingsOf(doc)
  const put = (patch, said) => api.commit({ settings: { ...set, ...patch } }, said)
  const label = (k) => def.item.fields.find((f) => f.k === k)?.label || k
  const Toggle = ({ value, onFlip }) => (
    <button type="button" className={`rl-btn${value ? ' on' : ''}`} aria-pressed={value} onClick={onFlip}>{value ? 'ON' : 'OFF'}</button>
  )
  return (
    <div className="rl-rec">
      {SWITCHES.map(([k, key]) => (
        <RackField key={k} label={tr(key)}>
          <Toggle value={set[k] !== false} onFlip={() => put({ [k]: set[k] === false }, tr(key))} />
          <span className="rl-hint">{tr(`${key}_hint`)}</span>
        </RackField>
      ))}
      <RackField label={tr("as_set_fields")}>
        <div className="rl-rows">
          <span className="rl-hint">{tr("as_set_fields_hint")}</span>
          {HIDEABLE.map((k) => {
            const v = set.fieldVis?.[k] !== false
            return (
              <div key={k} className="rl-rrow">
                <Toggle value={v} onFlip={() => put({ fieldVis: { ...(set.fieldVis || {}), [k]: !v } }, label(k))} />
                <span>{label(k)}</span>
              </div>
            )
          })}
        </div>
      </RackField>
    </div>
  )
}
