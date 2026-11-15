/**
 * project manager — the declaration. A project is a tag (or several, matched
 * all or any) with a name, a period, a description and a folder. Its tags tab
 * lists EVERY service's tags (`shared`): a tag's editor renames or merges it
 * everywhere and shows what wears it in each service, opening here.
 */
import './strings.js'
import { tr } from 'lilak-ui/i18n.jsx'
import { linkProject, projectFolder, projectOwnTag, showFilteredInCalendar, tagKey, tagWithin } from 'racklist'

// A project's events: activity's calendar, filtered by it (`+name`, as its filter keeps one).
const CAL = 'academic_activities'
const showInCalendar = (name) => showFilteredInCalendar(CAL, linkProject(CAL), [`+${tagKey(name)}`])

// A sub-project is its own record whose own tag sits under its parent's
// (`AToM-X/ihm`): the tag path is the only link, as jobboard reads it
// (graph.js projectTree). Its own tag is the one that is its name or ends in
// `/name` — not the first: KO-25-20 wears ELARK before its own.
const ownTag = projectOwnTag
const pathOf = (r) => tagKey(ownTag(r) || r.name)
const upOf = (r) => { const p = pathOf(r), i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : '' }
// The parent by its record's name; a path with no record is named by its last part.
const parentName = (r, list) => {
  const up = upOf(r)
  if (!up) return ''
  return (list || []).find((x) => pathOf(x) === up)?.name || (ownTag(r).split('/').slice(-2, -1)[0] ?? up)
}
const kidsOf = (r, list) => {
  const p = pathOf(r)
  return (list || []).filter((x) => x !== r && x.id !== r.id && tagWithin(pathOf(x), p) && pathOf(x) !== p)
}

// A project's folder is `NN__<name>` (racklist projectFolder).
const folderOf = projectFolder

export default {
  name: 'project_manager', title: tr('pm_title'), unit: tr('pm_unit'), key: 'pm',
  item: {
    key: 'projects', noun: tr('pm_project'), allLabel: tr('pm_projects'), label: 'name',
    // A project's row opens its own tab: everything its tags gather, in every
    // service — all of them, or any (match).
    tagged: { tags: 'tags', match: 'match' },
    // A saved project's editor bar: its events on activity's calendar.
    actions: (f) => (f.id && f.name ? <button type="button" className="rl-btn"
      onClick={() => showInCalendar(f.name)}>{tr('pm_show_in_calendar')}</button> : null),
    // In text a project is one word (`+STARK`, as a tag is `#STARK`): its name
    // can hold no space, nor what ends a word there.
    check: (r) => (/[\s#+.,;:!?()[\]{}'"]/.test(r.name || '') ? tr('pm_name_one_word') : ''),
    // A sub-project comes under its parent, whatever column is pressed among equals;
    // the top ones keep the order they are written in.
    tie: (tab, ctx) => {
      const first = new Map()
      ;(ctx.doc?.projects || []).forEach((r, i) => { const t = pathOf(r).split('/')[0]; if (!first.has(t)) first.set(t, i) })
      const top = (r) => first.get(pathOf(r).split('/')[0]) ?? 0
      return (a, b) => top(a) - top(b) || pathOf(a).localeCompare(pathOf(b))
    },
    // Deleting a parent leaves its sub-projects' tags pointing at nothing.
    deleteWarn: (r, doc) => {
      const kids = kidsOf(r, doc?.projects)
      return kids.length ? tr('pm_delete_has_kids', kids.map((x) => x.name).join(', ')) : undefined
    },
    columns: ['name', 'tags', 'match', 'start', 'end', 'folder'],
    fields: [
      { k: 'name', label: tr('pm_name'), type: 'text', col: 240, required: true, hint: tr('pm_name_hint'),
        // By name is by tag path, so each sub-project sits under its parent.
        sort: (v, ctx, r) => pathOf(r || { name: v }),
        cell: (r, ctx) => {
          const d = upOf(r) ? upOf(r).split('/').length : 0
          const up = parentName(r, ctx?.doc?.projects)
          return <span style={{ paddingLeft: d * 14 }}>{d ? '└ ' : ''}{r.name}
            {up && <span className="rl-hint"> · {tr('pm_parent', up)}</span>}</span>
        } },
      { k: 'tags', label: tr('pm_tags'), type: 'tags', col: 220 },
      { k: 'match', label: tr('pm_match'), type: 'select', col: 70, default: 'or', hint: tr('pm_match_hint'),
        options: [['or', tr('pm_or')], ['and', tr('pm_and')]] },
      { k: 'start', label: tr('pm_start'), type: 'date', col: 96 },
      { k: 'end', label: tr('pm_end'), type: 'date', col: 96 },
      { k: 'description', label: tr('pm_description'), type: 'longtext' },
      // The project's folder, under settings.folderRoots — named after it.
      { k: 'folder', label: tr('pm_folder'), type: 'folder', col: 40, get: (r, ctx) => folderOf(r.name, ctx?.folders) },
    ],
  },
  classes: [
    // Every service's tags; picked in manage mode, they make a new project matching any of them, or all (bundle).
    { k: 'tags', label: tr('pm_tags'), field: 'tags', shared: true, bundle: { match: 'match' } },
  ],
}
