import './strings.js'
import { createRoot } from 'react-dom/client'
import { RackService } from 'racklist'
import 'racklist/rack.css'
import def from './def.jsx'
import { OpenWaiting } from './inbox.jsx'

// The whole service is its declaration (def.jsx; the inbox's buttons in inbox.jsx).
const slots = { commands: (api) => <OpenWaiting api={api} /> }
createRoot(document.getElementById('root')).render(<RackService def={def} slots={slots} />)
