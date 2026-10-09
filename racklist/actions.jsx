import { useState } from 'react'

/**
 * The bar at the foot of an editor. Every record in every rack-list service is
 * left the same way, so the buttons, their words and their sides are one
 * component rather than a shape each editor redraws from memory.
 *
 *   [등록]                        while the record is a draft
 *   [save] [cancel] ……… [revert] [delete]              once it exists
 *
 * save SAVES. Leaving is ⌘X or the tab's own ×, because a button that closes
 * what you are working on is a button you stop pressing.
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
  draft, createLabel = '등록', onCreate, createDisabled, hint,
  saveLabel = 'save', onSave, saveDisabled,
  onCancel, onRevert, onDelete, deleteWarn = '되돌릴 수 없습니다.',
}) {
  const [sure, setSure] = useState(false)
  if (draft) {
    return (
      <div className="rl-acts">
        <button type="button" className="rl-btn rl-go" disabled={createDisabled}
          onClick={onCreate}>{createLabel}</button>
        {onCancel && <button type="button" className="rl-btn" onClick={onCancel}>cancel</button>}
        {hint && <span className="rl-hint">{hint}</span>}
      </div>
    )
  }
  return (
    <div className="rl-acts">
      <button type="button" className="rl-btn rl-go" disabled={saveDisabled}
        onClick={onSave}>{saveLabel}</button>
      {onCancel && <button type="button" className="rl-btn" onClick={onCancel}>cancel</button>}
      {hint && <span className="rl-hint">{hint}</span>}
      <span className="rl-sp" />
      {onRevert && <button type="button" className="rl-btn" onClick={onRevert}>revert</button>}
      {onDelete && (sure ? (
        <>
          <span className="rl-warn">{deleteWarn}</span>
          <button type="button" className="rl-btn rl-danger" onClick={onDelete}>정말 삭제</button>
          <button type="button" className="rl-btn" onClick={() => setSure(false)}>취소</button>
        </>
      ) : (
        <button type="button" className="rl-btn rl-danger" onClick={() => setSure(true)}>delete</button>
      ))}
    </div>
  )
}
