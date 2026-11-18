import './strings.js'
import { useEffect, useState } from 'react'
import Select from 'lilak-ui/components/Select.jsx'
import { RackField } from './fields.jsx'
import { typeOf } from './types.jsx'
import { projectOfTag, projectOwnTag, saveProject, tagKey } from './tags.js'
import { isFlowTag } from './chain.js'
import { tr } from 'lilak-ui/i18n.jsx'

// The record editor's tag box: chips, and the tags in use on offer.
const TagsEdit = typeOf({ type: 'tags' }).Edit
const MORE = { k: 'proj-more', type: 'tags' }
const NOCTX = {}

/**
 * What a tag is, in its editor — any service's tags tab: an ordinary tag, a
 * project (a tag marked as one, kept in project_manager: below) or a flow
 * (흐름, chain.js: the tag itself begins with `>`). A tag becomes a flow and
 * back by a rename, which goes through the whole share set (`onRename`): a
 * flow's records and notes must all follow. A project is unmade first.
 */
export function RackTagKind({ tag, projects, onChanged, say, onRename }) {
  const p = projectOfTag(projects, tag)
  const kind = isFlowTag(tag) ? 'flow' : p ? 'project' : 'tag'
  const [ask, setAsk] = useState('')               // a change waiting for its second press
  useEffect(() => { setAsk('') }, [tag])
  const name = String(tag).slice(String(tag).lastIndexOf('/') + 1)
  const go = (to) => {
    setAsk('')
    if (to === 'project') {
      saveProject(null, { name, tags: [tag], match: 'or' }).then(() => { say?.(tr('rk_proj_made', name)); onChanged?.() })
        .catch((e) => say?.(tr('rk_proj_failed', e.message)))
    } else if (kind === 'project') {
      saveProject(p, null).then(() => { say?.(tr('rk_proj_unmade', p.name)); onChanged?.() })
        .catch((e) => say?.(tr('rk_proj_failed', e.message)))
    } else onRename?.(to === 'flow' ? `>${tag}` : String(tag).replace(/^>/, ''))
  }
  // Making a project asks nothing; the rest changes what many records are, so it asks once more.
  const press = (to) => (to === kind ? null : to === 'project' ? go(to) : setAsk(to))
  const warn = { tag: kind === 'project' ? tr('rk_proj_unmake_warn') : tr('rk_kind_from_flow_warn', String(tag).replace(/^>/, '')),
    flow: tr('rk_kind_to_flow_warn', `>${tag}`) }[ask]
  return (
    <>
      <RackField label={tr('rk_kind')}>
        <div className="rl-rrow">
          <div className="rl-seg" style={{ flex: '0 0 auto', width: 240 }}>
            {['tag', 'project', 'flow'].map((k) => (
              <button key={k} type="button" className={`rl-btn${kind === k ? ' on' : ''}`}
                // A project is a plain tag with a card; it becomes a flow only after it is unmade.
                disabled={(kind === 'project' && k === 'flow') || (kind === 'flow' && k === 'project')}
                title={(kind === 'project' && k === 'flow') || (kind === 'flow' && k === 'project') ? tr('rk_kind_unmake_first') : ''}
                onClick={() => press(k)}>{tr(`rk_kind_${k}`)}</button>
            ))}
          </div>
          {ask ? <>
            <span className="rl-warn">{warn}</span>
            <button type="button" className="rl-btn rl-danger" onClick={() => go(ask)}>{tr('rk_kind_go')}</button>
            <button type="button" className="rl-btn" onClick={() => setAsk('')}>{tr('rk_cancel')}</button>
          </> : <span className="rl-hint">{tr(`rk_kind_${kind}_hint`, name)}</span>}
        </div>
      </RackField>
      {kind === 'project' && <RackTagProject tag={tag} projects={projects} onChanged={onChanged} say={say} />}
    </>
  )
}

/**
 * A tag's project, in the tag's editor — any service's tags tab. A project is a
 * tag marked as one (`+name`, its own tag's last part): a description, a period,
 * and the other tags it gathers, all or any. It is kept in project_manager, as it
 * was; this is the one place to make, change or unmake one.
 */
export function RackTagProject({ tag, projects, onChanged, say }) {
  const p = projectOfTag(projects, tag)
  const own = p ? projectOwnTag(p) : tag
  const blank = () => ({
    description: p?.description || '', start: p?.start || '', end: p?.end || '', match: p?.match || 'or',
    more: (p?.tags || []).filter((t) => tagKey(t) !== tagKey(own)),
  })
  const [f, setF] = useState(blank)
  useEffect(() => { setF(blank()) }, [p, tag])   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const dirty = !!p && JSON.stringify(f) !== JSON.stringify(blank())
  const run = (fields, said) => saveProject(p, fields).then(() => { say?.(said); onChanged?.() })
    .catch((e) => say?.(tr('rk_proj_failed', e.message)))
  const fields = () => ({ description: f.description, start: f.start, end: f.end, match: f.match,
    tags: [own, ...f.more.map((t) => t.trim()).filter((t) => t && tagKey(t) !== tagKey(own))] })

  if (!p) return null
  return (
    <>
      <RackField label={tr('rk_project')}>
        <div className="rl-rrow">
          <span className="rl-proj">{p.name}</span>
          <button type="button" className="rl-btn" disabled={!dirty}
            onClick={() => run(fields(), tr('rk_proj_saved', p.name))}>{tr('rk_proj_save')}</button>
        </div>
      </RackField>
      <RackField label={tr('rk_proj_description')}>
        <textarea className="rl-in" rows={3} style={{ width: '100%' }} value={f.description} onChange={set('description')} />
      </RackField>
      <RackField label={tr('rk_proj_period')}>
        <div className="rl-rrow">
          <input type="date" className="rl-in" value={f.start} onChange={set('start')} />
          <span className="rl-hint">–</span>
          <input type="date" className="rl-in" value={f.end} onChange={set('end')} />
        </div>
      </RackField>
      <RackField label={tr('rk_proj_more')}>
        <TagsEdit value={f.more} onChange={set('more')} field={{ ...MORE, placeholder: tr('rk_tag') }} ctx={NOCTX} />
        <span className="rl-hint">{tr('rk_proj_more_hint')}</span>
      </RackField>
      <RackField label={tr('rk_proj_match')}>
        <Select className="rl-in" value={f.match} onChange={set('match')}>
          <option value="or">{tr('rk_proj_or')}</option>
          <option value="and">{tr('rk_proj_and')}</option>
        </Select>
      </RackField>
    </>
  )
}
