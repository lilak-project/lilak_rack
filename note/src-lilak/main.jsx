import React from 'react'
import { createRoot } from 'react-dom/client'
import App, { PrintView, SoloNote } from './App.jsx'
import { tr } from 'lilak-ui'

/** Something threw while drawing. Without this the page is simply BLANK —
 *  and inside another service's frame (`?solo=`) a blank frame looks like a
 *  note that would not open, with nothing to press and nothing said. The
 *  usual cause is a frame holding yesterday's build: it is opened once and
 *  never reloads, so the button that fixes it is the one offered here.
 */
class Caught extends React.Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) { console.error('note:', err) }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="rl-msg nt-broke">
        <p>{tr("nt_broke")}</p>
        <button type="button" className="rl-btn" onClick={() => window.location.reload()}>
          {tr("nt_broke_again")}
        </button>
        <p className="rl-hint rl-mono">{String(this.state.err?.message || this.state.err)}</p>
      </div>
    )
  }
}

// ?print=<ids> is a page of its own, opened in a tab rather than in the
// portal's frame: the browser's printer should be handed the notes, not the
// portal around them.
const q = new URLSearchParams(window.location.search)
const ids = q.get('print')
// ?solo=<id>: that note's editor alone, for another service to show in a tab.
const solo = q.get('solo')
// A sheet of paper is taller than the window: this page scrolls, unlike the
// RACK screen the kit's body rule was written for.
if (ids) document.body.classList.add('nt-paper')
createRoot(document.getElementById('root')).render(
  <Caught>
    {ids ? <PrintView ids={ids.split(',').filter(Boolean)} /> : solo ? <SoloNote id={solo} /> : <App />}
  </Caught>,
)
