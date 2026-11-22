import './strings.js'
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { tr } from 'lilak-ui/i18n.jsx'
import { RackService, isManager, load, save } from 'racklist'
import 'racklist/rack.css'
import def from './def.jsx'
import { ExportPane, ImportPane } from './transfer.jsx'
import { InventorySettings } from './settings.jsx'
import { ScanPane } from './scan.jsx'

// Hidden assets (a list's 숨김) are for managers only; a manager picks which to
// see — all, the hidden ones, or the rest — and it is remembered here.
const HIDDEN = [
  { k: 'all', label: () => tr("as_hf_all"), is: () => true },
  { k: 'hidden', label: () => tr("as_hf_hidden"), is: (a) => !!a.hidden },
  { k: 'shown', label: () => tr("as_hf_shown"), is: (a) => !a.hidden },
]
const MGR = isManager()

function Inventory() {
  const [hk, setHk] = useState(() => load('am2.hidden', 'all'))
  const pick = (k) => { setHk(k); save('am2.hidden', k) }
  const hf = HIDDEN.find((x) => x.k === hk) || HIDDEN[0]
  // The service is its declaration (def.jsx), files in and out (transfer.jsx)
  // the scanner (scan.jsx) and a manager's settings (settings.jsx).
  const slots = useMemo(() => ({
    commands: (api) => (
      <>
        {api.tab?.kind === 'items' && (
          <button type="button" className="rl-btn" onClick={() => api.openEdit({ id: 'export', kind: 'export',
            label: tr("as_export"), title: api.tab.label })}>{tr("as_export")}</button>
        )}
        <button type="button" className="rl-btn" onClick={() => api.openEdit({ id: 'scan', kind: 'scan',
          label: tr("as_scan") })}>{tr("as_scan")}</button>
        <button type="button" className="rl-btn" onClick={() => api.openEdit({ id: 'import', kind: 'import',
          label: tr("as_import") })}>{tr("as_import")}</button>
      </>
    ),
    editors: {
      export: (etab, api) => <ExportPane etab={etab} api={api} />,
      import: (etab, api) => <ImportPane etab={etab} api={api} />,
      scan: (etab, api) => <ScanPane etab={etab} api={api} />,
    },
    settings: (api) => <InventorySettings api={api} />,
    keep: (a) => (MGR ? hf.is(a) : !a.hidden),
    keepOn: MGR && hf.k !== 'all',
    // The menu open: the three side by side. Shut: one button that steps through them.
    keepTools: () => MGR && (
      <span className="rl-seg" data-keep title={tr("as_hf_title")}>
        {HIDDEN.map((x) => (
          <button key={x.k} type="button" className={`rl-btn${x === hf ? ' on' : ''}`} onClick={() => pick(x.k)}>{x.label()}</button>
        ))}
      </span>
    ),
    barTools: () => MGR && (
      <button type="button" className={`rl-btn${hf.k !== 'all' ? ' on' : ''}`} title={tr("as_hf_title")}
        onClick={() => pick(HIDDEN[(HIDDEN.indexOf(hf) + 1) % HIDDEN.length].k)}>{hf.label()}</button>
    ),
  }), [hf])   // eslint-disable-line react-hooks/exhaustive-deps
  return <RackService def={def} slots={slots} />
}

createRoot(document.getElementById('root')).render(<Inventory />)
