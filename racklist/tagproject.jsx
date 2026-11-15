import './strings.js'
import { useEffect, useState } from 'react'
import Select from 'lilak-ui/components/Select.jsx'
import { RackField } from './fields.jsx'
import { typeOf } from './types.jsx'
import { projectOfTag, projectOwnTag, saveProject, tagKey } from './tags.js'
import { tr } from 'lilak-ui/i18n.jsx'

// The record editor's tag box: chips, and the tags in use on offer.
const TagsEdit = typeOf({ type: 'tags' }).Edit
const MORE = { k: 'proj-more', type: 'tags' }
const NOCTX = {}

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
  const [sure, setSure] = useState(false)
  useEffect(() => { setF(blank()); setSure(false) }, [p, tag])   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const name = String(tag).slice(String(tag).lastIndexOf('/') + 1)
  const dirty = !!p && JSON.stringify(f) !== JSON.stringify(blank())
  const run = (fields, said) => saveProject(p, fields).then(() => { say?.(said); onChanged?.() })
    .catch((e) => say?.(tr('rk_proj_failed', e.message)))
  const fields = () => ({ description: f.description, start: f.start, end: f.end, match: f.match,
    tags: [own, ...f.more.map((t) => t.trim()).filter((t) => t && tagKey(t) !== tagKey(own))] })

  if (!p) {
    return (
      <RackField label={tr('rk_project')}>
        <button type="button" className="rl-btn"
          onClick={() => run({ name, tags: [tag], match: 'or' }, tr('rk_proj_made', name))}>{tr('rk_proj_make')}</button>
        <span className="rl-hint">{tr('rk_proj_make_hint', name)}</span>
      </RackField>
    )
  }
  return (
    <>
      <RackField label={tr('rk_project')}>
        <div className="rl-rrow">
          <span className="rl-proj">{p.name}</span>
          <button type="button" className="rl-btn" disabled={!dirty}
            onClick={() => run(fields(), tr('rk_proj_saved', p.name))}>{tr('rk_proj_save')}</button>
          {sure ? <>
            <span className="rl-warn">{tr('rk_proj_unmake_warn')}</span>
            <button type="button" className="rl-btn rl-danger" onClick={() => run(null, tr('rk_proj_unmade', p.name))}>{tr('rk_proj_unmake')}</button>
            <button type="button" className="rl-btn" onClick={() => setSure(false)}>{tr('rk_cancel')}</button>
          </> : <button type="button" className="rl-btn" onClick={() => setSure(true)}>{tr('rk_proj_unmake')}</button>}
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
