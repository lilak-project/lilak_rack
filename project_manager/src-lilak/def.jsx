/**
 * project manager — the declaration. A project is a tag (or several, matched
 * all or any) with a name, a period, a description and a folder. Its tags tab
 * lists EVERY service's tags (`shared`): a tag's editor renames or merges it
 * everywhere and shows what wears it in each service, opening here.
 */
import './strings.js'
import { tr } from 'lilak-ui/i18n.jsx'
import { linkProject, showFilteredInCalendar, tagKey } from 'racklist'

// A project's events: activity's calendar, filtered by it (`+name`, as its filter keeps one).
const CAL = 'academic_activities'
const showInCalendar = (name) => showFilteredInCalendar(CAL, linkProject(CAL), [`+${tagKey(name)}`])

// A project's folder is `NN__<name>`, the numbering the projects folder
// already has (05__STARK): found with or without its number, any case; a new
// one is numbered after the last.
const NUMBERED = /^(\d+)__(.+)$/
function folderOf(name, folders) {
  if (!name || !folders?.dirs) return name || ''
  const dirs = Object.keys(folders.dirs)
  const want = name.normalize('NFC').toLowerCase()
  const hit = dirs.find((d) => (NUMBERED.exec(d)?.[2] ?? d).toLowerCase() === want)
  if (hit) return hit
  const n = Math.max(0, ...dirs.map((d) => Number(NUMBERED.exec(d)?.[1]) || 0)) + 1
  return `${String(n).padStart(2, '0')}__${name}`
}

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
    columns: ['name', 'tags', 'match', 'start', 'end', 'folder'],
    fields: [
      { k: 'name', label: tr('pm_name'), type: 'text', col: 240, required: true, hint: tr('pm_name_hint') },
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
