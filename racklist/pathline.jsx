import './strings.js'
import { useRef, useState } from 'react'
import { RackField } from './fields.jsx'
import { PORTAL_BASE } from './portal.js'
import { tr } from 'lilak-ui/i18n.jsx'

/** A record's "record address" (in full, "lilak record address"): server,
 *  /pp/<service>/<project>/, its list, its id. One line to hand an agent;
 *  MCP get_record / get_note take it whole as `path`. */
export const recordPath = (kind, id) =>
  `${location.origin}${PORTAL_BASE.replace(/\/$/, '')}/${kind ? `${kind}/` : ''}${id}`

/** The top line of every record's edit tab: that path, copied whole. */
export function PathLine({ kind, id }) {
  const [done, setDone] = useState(false)
  const box = useRef(null)
  if (!id) return null
  const line = recordPath(kind, id)
  const copy = async () => {
    // The clipboard API wants a secure page; a portal on http (kiki.local) falls back.
    try { await navigator.clipboard.writeText(line) } catch { box.current?.select(); document.execCommand('copy') }
    setDone(true); setTimeout(() => setDone(false), 1200)
  }
  return (
    <RackField label={<span title="Record address (lilak record address)">{tr("rk_record_address")}</span>}>
      <input ref={box} className="rl-agentline" readOnly value={line} title={line} onFocus={(e) => e.target.select()} />
      <button type="button" className="rl-btn" onClick={copy}>{tr(done ? "rk_copied" : "rk_copy")}</button>
    </RackField>
  )
}
