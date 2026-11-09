import '../strings.js'
import { useState } from 'react'
import { press } from './press.js'
import { tr } from 'lilak-ui/i18n.jsx'

/** 흐름 — the notes this one follows on from and leads to (flow.js): the list,
 *  a next note made in the same flow, and putting this one in a flow or out.
 *
 *  The list is a rack list in little: a gutter number (where in the flow this
 *  note stands), the day, the title. The order is the DAYS' — nothing names a
 *  next note — so moving one up or down trades days with its neighbour, and
 *  two notes written on the same day cannot be told apart that way.
 */
function Body({ flow }) {
  const [q, setQ] = useState('')
  if (!flow) return <p className="rl-hint nt-empty">{tr('nt_flow_nolist')}</p>
  const { members, here, own, others } = flow
  const s = q.trim().toLowerCase()
  // What was typed, against the title and the day both — "회의 11-03" finds it.
  const hits = !s ? [] : others.filter((x) => `${x.title} ${x.date}`.toLowerCase().includes(s)).slice(0, 20)
  return (<>
    <div className="nt-flow-do">
      <button type="button" className="rl-btn rl-go" {...press(flow.follow)}>{tr('nt_flow_follow')}</button>
      {own ? <button type="button" className="rl-btn" {...press(flow.out)}>{tr('nt_flow_out')}</button> : null}
    </div>
    {members.length ? (
      <ul className="nt-flow">
        {members.map((m, i) => {
          const up = members[i - 1], down = members[i + 1]
          return (
            <li key={m.id} className={m.id === here ? 'on' : ''}>
              <span className="rl-gut rl-num">{i + 1}</span>
              <button type="button" className="nt-out" disabled={m.id === here} {...press(() => flow.step(m.id, m.title))}>
                <span className="rl-hint nt-out-n">{m.date}</span>
                <span className="nt-out-text">{m.title}</span>
              </button>
              {/* Up and down trade days: the day is the order, so moving a note
                  IS writing it a different day, and the list says which. */}
              <span className="nt-flow-mv">
                <button type="button" className="rl-btn" disabled={!up || up.date === m.date}
                  title={tr(up && up.date === m.date ? 'nt_flow_sameday' : 'nt_flow_up')}
                  {...press(() => flow.move(m.id, -1))}>↑</button>
                <button type="button" className="rl-btn" disabled={!down || down.date === m.date}
                  title={tr(down && down.date === m.date ? 'nt_flow_sameday' : 'nt_flow_down')}
                  {...press(() => flow.move(m.id, 1))}>↓</button>
              </span>
            </li>
          )
        })}
      </ul>
    ) : <p className="rl-hint nt-empty">{tr('nt_flow_none')}</p>}
    {/* Which note to follow on from. A dropdown hid what was found behind a
        second press; the notes themselves stand here instead, and one press
        on the right one is the whole thing. */}
    {!own ? (<>
      <div className="nt-flow-put">
        <input className="rl-in" value={q} placeholder={tr('nt_flow_pick')}
          onChange={(e) => setQ(e.target.value)} />
      </div>
      {!s ? null : hits.length ? (
        <ul className="nt-flow nt-flow-hits">
          {hits.map((x) => (
            <li key={x.id}>
              <button type="button" className="nt-out" {...press(() => { flow.put(x); setQ('') })}>
                <span className="rl-hint nt-out-n">{x.date}</span>
                <span className="nt-out-text">{x.title}</span>
                {x.chain ? <span className="rl-hint nt-flow-in">{tr('nt_flow_in')}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="rl-hint nt-empty">{tr('nt_flow_nohit')}</p>}
    </>) : null}
  </>)
}

export default {
  id: 'flow',
  label: 'nt_tool_flow',
  modes: ['md', 'tex'],
  Body,
}
