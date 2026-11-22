import { createRoot } from 'react-dom/client'
import { RackService } from 'racklist'
import 'racklist/rack.css'
import def from './def.jsx'

// The whole service is its declaration (def.jsx).
createRoot(document.getElementById('root')).render(<RackService def={def} />)
