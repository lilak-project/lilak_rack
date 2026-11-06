import './strings.js'
import { createRoot } from 'react-dom/client'
import { RackService, filesTab } from 'racklist'
import 'racklist/rack.css'
import { tr } from 'lilak-ui/i18n.jsx'
import def from './def.jsx'

// The logs, and every file they carry (racklist/uploads.jsx).
createRoot(document.getElementById('root')).render(
  <RackService def={def} slots={{ tabs: [filesTab('files', { label: tr('lb_tab_files') })] }} />)
