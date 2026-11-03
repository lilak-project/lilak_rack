import './strings.js'
import { useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'

/**
 * The bar at the foot of an editor. Every record in every rack-list service is
 * left the same way, so the buttons, their words and their sides are one
 * component rather than a shape each editor redraws from memory.
 *
 *   [등록]                        while the record is a draft
 *   [close] [그 editor의 것들] ……… [delete]                   saves as you type
 *   [save] [cancel] [그 editor의 것들] ……… [revert] [delete]   saves when told
 *
 * An editor that saves as you type passes `onClose`, not `onSave`: there is
 * nothing to press, and closing keeps what is there. The one whose saving is a
 * decision (one form over many records, a rename that travels) passes `onSave`
 * and `onCancel`: save SAVES and stays, cancel leaves and keeps nothing. So the
 * word on the button always says what happens to what you typed.
 *
 * Leaving is on the left, undoing and destroying on the right: four buttons in
 * a row read as one kind of thing, and two of them are not.
 *
 * Deleting asks in place — window.confirm never appears inside the portal's
 * frame, so a dialog would delete with no question asked at all. The question
 * is this component's own state; give it a `key` that changes with the record
 * so a half-asked question does not follow you to the next one.
 */
export function RackActions({
  draft, createLabel = tr("rk_create"), onCreate, createDisabled, hint,
  saveLabel = 'save', onSave, saveDisabled,
  // Changed and about to save on its own: the close button's border runs
  // round it — a word saying so would push the bar about each time.
  pending, onClose, closeDisabled,
  // Leaving is on the left — except where `extra` is a row this editor is
  // chiefly driven from (note's mode and its tools), and close then reads as
  // dropped in the middle of it. Opt in, because the place of a button is a
  // thing every editor should agree about by default.
  closeLast,
  onCancel, onRevert, revertTitle, onDelete, deleteWarn = tr("rk_cannot_undo"), onClone,
  // Anything this one editor can do that the others cannot — a preview, a
  // paste, a re-scan. It rides with save and cancel, which are also about
  // this record, and never with revert and delete.
  extra,
}) {
  const [sure, setSure] = useState(false)
  const close = () => (
    <button type="button" className={`rl-btn${pending ? ' rl-pending' : ''}`} disabled={closeDisabled}
      title={pending ? tr("rk_saving_soon") : tr("rk_close_saves")} onClick={onClose}>close</button>
  )
  if (draft) {
    return (
      <div className="rl-acts">
        <button type="button" className="rl-btn rl-go" disabled={createDisabled}
          onClick={onCreate}>{createLabel}</button>
        {onCancel && <button type="button" className="rl-btn" onClick={onCancel}>cancel</button>}
        {extra}
        {hint && <span className="rl-hint">{hint}</span>}
      </div>
    )
  }
  return (
    <div className="rl-acts">
      {onSave && (
        <button type="button" className="rl-btn rl-go" disabled={saveDisabled} onClick={onSave}>{saveLabel}</button>
      )}
      {onClose && !closeLast ? close() : null}
      {!onClose && onCancel ? <button type="button" className="rl-btn" onClick={onCancel}>cancel</button> : null}
      {onClone && <button type="button" className="rl-btn" title={tr("rk_clone_hint")} onClick={onClone}>clone</button>}
      {extra}
      {onClose && closeLast ? close() : null}
      {hint && <span className="rl-hint">{hint}</span>}
      <span className="rl-sp" />
      {onRevert && (
        <button type="button" className="rl-btn" title={revertTitle} onClick={onRevert}>revert</button>
      )}
      {onDelete && (sure ? (
        <>
          <span className="rl-warn">{deleteWarn}</span>
          <button type="button" className="rl-btn rl-danger" onClick={onDelete}>{tr("rk_really_delete")}</button>
          <button type="button" className="rl-btn" onClick={() => setSure(false)}>{tr("rk_cancel")}</button>
        </>
      ) : (
        <button type="button" className="rl-btn rl-danger" onClick={() => setSure(true)}>delete</button>
      ))}
    </div>
  )
}
