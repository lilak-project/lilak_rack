import './strings.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RackTable, RackRow, RackTabs } from './table.jsx'
import { RackPaneStrip } from './panes.jsx'
import { RackBar } from './bar.jsx'
import { RackCalendar } from './calendar.jsx'
import { RackTrash } from './trash.jsx'
import { occurrences, parseRule, withUntil, withCount } from './rrule.js'
import { RackEditClass } from './classedit.jsx'
import { FilterBar, FacetRows } from './filter.jsx'
import { RackListing } from './listing.jsx'
import { RackItemEditor, cloneOf } from './editor.jsx'
import { useMergeMode, RackMergeButtons, RackMerge } from './merge.jsx'
import { RackBulkEditor } from './bulk.jsx'
import { useRackList } from './list.js'
import { useRackKeys, useToggleKey } from './hooks.js'
import { typeOf } from './types.jsx'
import { useFolders, RackFolder, RackFilePane, RackSettings, hasRoots } from './files.jsx'
import { asSorts, bumpSort, bySome } from './sort.js'
import {
  defineRack, isFav, withFav, itemColumns, classColumns, itemSorters, itemCells, itemSearch, itemTokens,
  classRows, wornBy, wears, isRef, fixedTabs, itemTabId, itemScope, labelOf, useRemoteDocs, valueOf,
  EMPTY_CELL as D,
} from './schema.js'
import { PORTAL_PROJECT, brandStyle, isManager, portalUser, fetchDoc, putDoc, newId, takeOpenRequest, load, save, projectKey } from './portal.js'
import { tr } from '../i18n.jsx'

/**
 * <RackService def={…} /> — a whole rack-list service from its declaration.
 *
 *   타이틀 바     the service's name, how many, the project — in its own colour
 *   버튼 스페이스  + 새 항목, clear, the selection, 탭 닫기 · 편집 닫기, the filter, search
 *   탭 스페이스    every item · one tab per class · the tabs you opened · settings
 *   [표]          the items (or a class's records), with [나열] under it
 *   [편집창]      beside it: an item, a class record, a tag, a file, a folder
 *
 * Nothing here knows what the records are about; `def` (see defineRack) does.
 *
 * The ways out, for what a declaration cannot say:
 *   slots.commands(api)          more buttons on the command line
 *   slots.tabs                   [{ id, label, render(api) }] — tabs of the service's own
 *   slots.settings(api)          more of the settings tab, under the kit's (a manager's)
 *   slots.editors                { kind: (tab, api) => node } — editor panes of its own;
 *                                open one with api.openEdit({ id, kind, label, … })
 *   registerType(name, type)     a field type of its own (types.jsx)
 *   field.cell / field.edit      one field drawn differently
 *
 * `api` is what those get: doc, commit(patch, said), openTab, openEdit,
 * setNote, the selection (picked, chosen) and the current tab. A field's
 * widget and cell get much the same through `ctx`.
 */
// The favourite star: soft at the points (round joins), filled when it is one (CSS).
const STAR = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <polygon points="12,3 14.7,8.8 21,9.5 16.3,13.9 17.6,20.2 12,17 6.4,20.2 7.7,13.9 3,9.5 9.3,8.8" />
  </svg>
)

export function RackService({ def: declared, slots = {} }) {
  const def = useMemo(() => (declared.docKeys ? declared : defineRack(declared)), [declared])
  const [doc, setDoc] = useState(null)
  const [outOpen, setOutOpen] = useState(false)
  const remote = useRemoteDocs(def)
  const [folders, reloadFolders] = useFolders(def)
  const folderField = useMemo(() => def.item.fields.find((f) => f.type === 'folder'), [def])
  const IS_ADMIN = useMemo(() => isManager(), [])
  const ME = useMemo(() => portalUser()?.email || '', [])
  const FIRST = itemTabId(def)

  const FIXED = useMemo(() => {
    const [all, ...classTabs] = fixedTabs(def)
    return [
      all,
      // A month of the items, when they have dates (def.calendar) — the items
      // again, so beside them.
      ...(def.calendar ? [{ id: 'calendar', kind: 'calendar', label: tr("rk_tab_calendar") }] : []),
      ...classTabs,
      ...(slots.tabs || []).map((t) => ({ id: t.id, kind: 'slot', label: t.label })),
      // What was deleted, and the way back — a manager's, as deleting is.
      ...(IS_ADMIN ? [{ id: 'trash', kind: 'trash', label: tr("rk_trash") }] : []),
      // Where the service may read the disk is a manager's to say.
      ...(IS_ADMIN && (hasRoots(def) || slots.settings) ? [{ id: 'settings', kind: 'settings', label: tr("rk_tab_settings") }] : []),
    ]
  }, [def, slots.tabs, slots.settings, IS_ADMIN])

  const extra = useMemo(() => ({ remote, folders }), [remote, folders])
  const itemSort = useMemo(() => itemSorters(def, doc, extra), [def, doc, extra])
  // A sorter may depend on the tab (a group's own core on that group's tab).
  const sortersFor = useCallback((t) => (t?.kind !== 'items' ? {}
    : def.item.tabbed ? itemSorters(def, doc, { ...extra, tab: t }) : itemSort), [def, doc, extra, itemSort])
  // Quick filters (def.item.quick: [{ id, label, title, drop: (rec) => hide it }]):
  // a button each beside the filter on the items tab, on or off, kept per project.
  const quickKey = projectKey(def.key, 'quick')
  const [quick, setQuick] = useState(() => load(quickKey, []))
  useEffect(() => { save(quickKey, quick) }, [quickKey, quick])
  const drops = useMemo(() => (def.item.quick || []).filter((q) => quick.includes(q.id)), [def, quick])
  const scopeOf = useCallback((t, sort) => {
    const s = itemScope(def, doc, t, sort, sortersFor(t), def.item.tie?.(t, { def, doc, ...extra, tab: t }))
    return t?.kind === 'items' && drops.length ? s.filter((r) => !drops.some((q) => q.drop(r))) : s
  }, [def, doc, extra, sortersFor, drops])
  const search = useMemo(() => itemSearch(def, doc, extra), [def, doc, extra])
  const tokens = useMemo(() => itemTokens(def, doc, extra), [def, doc, extra])
  const allClassCols = useMemo(() => def.classes.flatMap((c) => classColumns(def, c)), [def])
  const colSets = useMemo(() => ({ '': itemColumns(def), 'c:': allClassCols }), [def, allClassCols])
  const tone = useMemo(() => Object.fromEntries([...def.item.fields, ...def.classes.flatMap((c) => c.fields)]
    .filter((f) => f.tone).map((f) => [f.k, f.tone])), [def])

  // What an item is known by: `id`, or the key a service already had (an
  // asset's 자산번호). Lists hold these; the selection and the editors use them.
  const IDK = def.item.id || 'id'
  const idOf = useCallback((r) => r?.[IDK], [IDK])
  const L = useRackList({ idOf,
    key: def.key, fixed: FIXED, firstTab: FIRST, scopeOf, search,
    sorters: sortersFor, cols: colSets, clsSort: def.classSort || { k: 'count', dir: -1 },
  })
  const { tab, tabs, openTab, closeTab, rows, scope, filter, panes, split, findRef, drag } = L
  const { sort, setSort, clsSort, setClsSort, query, setQuery, note, setNote, err, setErr } = L
  const { picked, setPicked, hit, all: allPicked, some: somePicked, toggleAll, clear: clearPicked, chosen } = L
  // ⌘Enter: whatever the search has left on screen, take it all — or put it
  // all back — and say which.
  useToggleKey(() => {
    if (!rows.length) return
    toggleAll()
    setNote(allPicked ? tr("rk_deselect_n", rows.length, def.unit) : tr("rk_select_n", rows.length, def.unit))
  })

  const items = doc?.[def.item.key] || []
  const cls = tab?.kind === 'classes' ? def.classes.find((c) => c.k === tab.of) : null
  // Names worn through a plain field (tags) can be folded into one another.
  const clsField = cls ? wornBy(def, cls) : null
  const mergeable = !!cls && ((!cls.stored && !!clsField && !isRef(clsField) && !typeOf(clsField).keys)
    || (cls.stored && !!cls.merge))
  const merge = useMergeMode(mergeable)

  useEffect(() => {
    if (!PORTAL_PROJECT) { setErr(tr("rk_open_via_portal")); return }
    fetchDoc().then(setDoc).catch((e) => setErr(String(e.message || e)))
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  // Sent here from another service (#open=<id>): open that record once the
  // document is in.
  const [asked] = useState(() => takeOpenRequest())
  const [answered, setAnswered] = useState(false)
  // A tab for a class record that is gone goes with it; so does an editor for
  // a record that is gone.
  useEffect(() => {
    if (!doc) return
    L.keepTabs((t) => {
      if (t.of && (t.key || t.name)) {
        const c = def.classes.find((x) => x.k === t.of) || {}
        const f = wornBy(def, c)
        return (f && items.some((r) => wears(r, f, t.key || t.name)))
          || (doc[t.of] || []).some((r) => r[c.keyBy || 'name'] === (t.key || t.name))
      }
      if (t.ids) return true
      return false
    })
    panes.keep((t) => {
      if (!t.who) return true
      if (t.kind === 'item' || t.kind === 'file') return items.some((r) => idOf(r) === t.who)
      if (t.kind === 'class') {
        const c = def.classes.find((x) => x.k === t.of)
        return t.stored ? !!(c && (doc[t.of] || []).some((r) => (r.id ? r.id === t.who : r[c.keyBy] === t.who))) : true
      }
      return true
    })
  }, [doc])   // eslint-disable-line react-hooks/exhaustive-deps

  /** Whole-document save, version-guarded: 409 means someone else got there
   *  first. Take what won and keep the edit — the form still holds it, and the
   *  next save is built from the document that is now current. */
  const commit = useCallback(async (patch, said) => {
    if (!doc) return false
    try {
      const body = Object.fromEntries(def.docKeys.map((k) => [k, patch[k] ?? doc[k]]))
      const r = await putDoc(doc.version, body)
      if (r.conflict) {
        if (r.doc) setDoc(r.doc)
        setNote(tr("rk_changed_meanwhile"))
        return false
      }
      setDoc(r.doc)
      setNote(said || tr("rk_saved"))
      return true
    } catch (e) { setNote(String(e.message || e)); return false }
  }, [doc, def, setNote])

  const openEdit = useCallback((t) => panes.open(t), [panes])
  // ☆ / ★ in a row: the favorite tag on or off, saved at once — the star turns
  // as it is pressed, and back again only if the save does not go through.
  const [favNow, setFavNow] = useState({})
  const starred = (r) => (idOf(r) in favNow ? favNow[idOf(r)] : isFav(def, r))
  const toggleFav = (r) => {
    const id = idOf(r), on = !starred(r)
    setFavNow((m) => ({ ...m, [id]: on }))
    commit({ [def.item.key]: items.map((x) => (idOf(x) === id ? withFav(def, x, on) : x)) },
      tr(on ? 'rk_fav_on' : 'rk_fav_off', labelOf(def, r)))
      .finally(() => setFavNow((m) => { const { [id]: _, ...rest } = m; return rest }))
  }
  // `rec` when the caller already has the record — right after creating one,
  // the document this closure sees does not have it yet, and the tab would be
  // named "새 …" for a record that has a name.
  // `seed` fills a new one in (a day picked on the calendar); a draft already
  // open gives way to it.
  const openItem = useCallback((id, rec, seed) => {
    const r = rec || (doc?.[def.item.key] || []).find((x) => idOf(x) === id)
    if (!id && seed) panes.close('item:new')
    const open = () => openEdit({ id: `item:${id || 'new'}`, kind: 'item', who: id || null, seed,
      label: r ? labelOf(def, r) : tr("rk_new_x", def.item.noun) })
    if (!id && seed) setTimeout(open, 0); else open()
  }, [doc, def, openEdit, panes])   // eslint-disable-line react-hooks/exhaustive-deps
  const rowLabel = (c, rec) => (c.rowLabel ? c.rowLabel(rec) : rec?.name) || ''
  // A stored record is found by its id, or — one from before ids — by its key.
  const whoOf = (c, rec) => (rec ? rec.id || rec[c.keyBy] : null)
  const findStored = (c, who) => (doc?.[c.k] || []).find((r) => (r.id ? r.id === who : r[c.keyBy] === who))
  const openClass = useCallback((c, rec) => openEdit(c.stored
    ? { id: `class:${c.k}:${whoOf(c, rec) || 'new'}`, kind: 'class', of: c.k, stored: true, who: whoOf(c, rec),
      label: rec ? rowLabel(c, rec) : tr("rk_new_x", c.noun) }
    : { id: `class:${c.k}:${rec.name}`, kind: 'class', of: c.k, stored: false, who: rec.name, label: rec.name }),
  [openEdit])

  useRackKeys({
    onNew: () => (cls?.stored ? openClass(cls, null) : openItem(null)),
    onClose: () => { const cur = panes.current(panes.cols[0]); if (cur) panes.close(cur.id) },
  })

  /** Open a stored class record by what items call it — what a chip in the
   *  editor does, so a class without a tab of its own (tab: false) is still
   *  one press away. */
  const openClassByName = useCallback((of, name) => {
    const c = def.classes.find((x) => x.k === of)
    const rec = c?.stored && (doc?.[of] || []).find((r) => r[c.keyBy] === name || r.name === name)
    if (rec) openClass(c, rec)
  }, [def, doc, openClass])
  /** A record's folder, in a pane of its own — the ✓ in the table, 열기 in
   *  the editor. Named after the record it belongs to, when one does. */
  const openFolder = useCallback((name) => {
    const r = folderField && items.find((x) => valueOf(folderField, x) === name)
    openEdit({ id: `folder:${name}`, kind: 'folder', who: name, label: `📁 ${r ? labelOf(def, r) : name}` })
  }, [def, folderField, items, openEdit])
  /** A record's file, read in a pane. */
  const openFile = useCallback((rec, field) => openEdit({ id: `file:${idOf(rec)}:${field.k}`, kind: 'file',
    who: idOf(rec), field: field.k, label: `📄 ${labelOf(def, rec)}` }), [def, openEdit, idOf])
  useEffect(() => {
    if (!doc || !asked || answered) return
    setAnswered(true)
    if (items.some((r) => idOf(r) === asked)) openItem(asked)
    else setNote(tr("rk_open_target_missing"))
  }, [doc, asked, answered])   // eslint-disable-line react-hooks/exhaustive-deps
  // A day to show on the calendar (a date's label pressed in an editor). The
  // calendar must be in sight: a full-width editor gives the list its width
  // back, and where the two cannot stand side by side the editors close
  // (each saves what it holds as it goes).
  const [calAt, setCalAt] = useState(null)
  const showDate = useCallback((d) => {
    if (!d) return
    panes.setFull(false)
    if (L.vw < (panes.cols.length > 1 ? 1500 : 1180)) panes.closeAll()     // as useRackList's showList
    openTab({ id: 'calendar', kind: 'calendar', label: tr("rk_tab_calendar") })
    setCalAt({ d: String(d).slice(0, 10), n: Date.now() })
  }, [openTab, panes, L.vw])
  const ctx = useMemo(() => ({
    remote, folders, reloadFolders, openFolder, openFile, say: setNote, openItem,
    openClass: openClassByName, openTab, openEdit, commit, isAdmin: IS_ADMIN, tab,
    showDate: def.calendar ? showDate : undefined,
    // Another service's page as an editor tab: { id, label, src }.
    openFrame: (t) => openEdit({ ...t, kind: 'frame' }),
  }), [remote, folders, reloadFolders, openFolder, openFile, setNote, openItem, openClassByName,
    openTab, openEdit, commit, IS_ADMIN, tab, def.calendar, showDate])
  const api = { def, doc, commit, openTab, openEdit, closeEdit: (id) => panes.close(id), openItem, setNote,
    picked, setPicked, clearPicked, chosen, tab, rows, scope }

  // A column may belong to some tabs only (a group's core on that group's tab).
  const cols = useMemo(() => L.colsOf('').filter((c) => !c.when || c.when(tab)), [L.colsOf, tab])   // eslint-disable-line react-hooks/exhaustive-deps
  const clsCols = useMemo(() => (cls ? L.colsOf('c:', classColumns(def, cls)).filter((c) => !c.when || c.when(tab)) : []), [L.colsOf, cls, def, tab])   // eslint-disable-line react-hooks/exhaustive-deps
  const mergeCols = useMemo(() => [{ k: 'chk', w: 26, min: 26, fix: true }, ...clsCols], [clsCols])
  const classes = useMemo(() => {
    if (!cls) return []
    const q = query.trim().toLowerCase()
    const all = classRows(def, doc, cls, extra)
      // Every spelling the record holds is searched — an alias, a handle.
      .filter((r) => !q || Object.values(r).flat().some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
    const f = cls.fields.find((x) => x.k === clsSort.k)
    const c = { def, doc, ...extra }
    const get = clsSort.k === 'count' ? (r) => r.count
      : f?.get ? (r) => f.get(r, c) : (r) => r[clsSort.k]
    return all.sort(bySome(get, clsSort.dir))
  }, [cls, def, doc, query, clsSort, extra])

  const showEdit = L.showEdit && !!doc
  const showList = !showEdit || L.showList
  const order = asSorts(sort).length ? asSorts(sort) : asSorts(def.item.order)

  // Today, when the table is in date order: what is on now is lit, and a line
  // runs where today falls — between what has begun and what has not.
  const nowAt = useMemo(() => {
    const n = def.item.now
    if (!n || order[0]?.k !== n.start) return null
    const today = new Date().toLocaleDateString('sv-SE')      // YYYY-MM-DD, local
    const day = (r, k) => String(r?.[k] || '').slice(0, 10)
    const on = new Set()
    let line = -1, prev = null
    rows.forEach((r, i) => {
      const s = day(r, n.start)
      if (!s) return
      if (s <= today && today <= (day(r, n.end) || s)) on.add(idOf(r))
      const begun = s <= today
      if (prev !== null && prev !== begun && line < 0) line = i
      prev = begun
    })
    return { on, line }
  }, [def, order, rows])

  // ── a wearable class (tags): rename, merge or take it off every item ──────
  // A field may say how a record changes beyond the field itself (`fold`): a
  // main tag that was one of the names going.
  const foldNames = (field, gone, to) => items.map((r) => {
    if (field.fold) return field.fold(r, gone, to)
    const v = r[field.k]
    if (Array.isArray(v)) {
      if (!v.some((x) => gone.includes(x))) return r
      const next = []
      for (const x of v) { const y = gone.includes(x) ? to : x; if (y && !next.includes(y)) next.push(y) }
      return { ...r, [field.k]: next }
    }
    return gone.includes(v) ? { ...r, [field.k]: to || '' } : r
  })
  const wearing = (field, gone) => items.filter((r) => {
    const v = r[field.k]
    return Array.isArray(v) ? v.some((x) => gone.includes(x)) : gone.includes(v)
  })

  // ── the selection: edit it all at once, or put it in a list ──────────────
  const listClasses = def.classes.filter((c) => c.list)
  // The list whose tab this is, when it is one.
  const inList = tab?.of ? listClasses.find((c) => c.k === tab.of) : null
  const openMany = () => {
    const ids = items.filter((r) => picked.has(idOf(r))).map(idOf)
    if (!ids.length) return
    panes.close('many')
    setTimeout(() => openEdit({ id: 'many', kind: 'many', ids, label: tr("rk_n_at_once", ids.length, def.unit) }), 0)
  }
  const pickedKeys = () => {
    const idk = def.item.id || 'id'
    return items.filter((r) => picked.has(idOf(r))).map((r) => r[idk])
  }
  async function putInList(c, listId) {
    const add = pickedKeys()
    if (!add.length) return
    const ik = c.list.ids
    const now = new Date().toISOString()
    const recs = doc[c.k] || []
    let next, name
    if (listId === '+new') {
      // Named for the day it was made — and -2, -3 when that day has one.
      const used = new Set(recs.map((r) => r.name))
      name = now.slice(0, 10)
      for (let n = 2; used.has(name); n += 1) name = `${now.slice(0, 10)}-${n}`
      // A new list starts with its fields' defaults, as one made in its editor does.
      const blank = Object.fromEntries(c.fields.filter((f) => !f.get && f.store !== false && f.k !== ik)
        .map((f) => [f.k, f.default ?? typeOf(f).empty()]))
      next = [{ ...blank, id: newId(), name, [ik]: add, ...(c.list.owner ? { [c.list.owner]: ME } : {}), createdAt: now, updatedAt: now }, ...recs]
    } else {
      const l = recs.find((x) => x.id === listId)
      name = l?.name || ''
      next = recs.map((x) => (x.id === listId
        ? { ...x, [ik]: [...(x[ik] || []), ...add.filter((id) => !(x[ik] || []).includes(id))], updatedAt: now } : x))
    }
    if (await commit({ [c.k]: next }, tr("rk_put_in_list", add.length, def.unit, name, c.noun))) {
      clearPicked()
      // A list just made is opened: its items, beside what to do with them.
      if (listId === '+new') {
        const id = next[0].id
        openTab({ id: `${c.k}:${id}`, kind: 'items', of: c.k, key: id, name, label: name })
      }
    }
  }
  async function takeOutOfList(c, listId) {
    const out = new Set(pickedKeys())
    const ik = c.list.ids
    const next = (doc[c.k] || []).map((x) => (x.id === listId
      ? { ...x, [ik]: (x[ik] || []).filter((id) => !out.has(id)), updatedAt: new Date().toISOString() } : x))
    if (await commit({ [c.k]: next }, tr("rk_took_out_of", out.size, def.unit, c.noun))) clearPicked()
  }
  // My lists first: they are the ones I am filling.
  const listsFor = (c) => [...(doc?.[c.k] || [])].sort((a, b) => (
    (c.list.owner ? (b[c.list.owner] === ME) - (a[c.list.owner] === ME) : 0)
    || String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))))

  function editorFor(etab) {
    if (slots.editors?.[etab.kind]) return slots.editors[etab.kind](etab, api)
    if (etab.kind === 'folder') return <RackFolder key={etab.who} name={etab.who} say={setNote} />
    if (etab.kind === 'frame') return <iframe key={etab.src} className="rl-frame" src={etab.src} title={etab.label} />
    if (etab.kind === 'many') {
      return (
        <RackBulkEditor def={def} doc={doc} ids={etab.ids || []} ctx={ctx} onSave={commit}
          canDelete={IS_ADMIN} onCancel={() => panes.close(etab.id)}
          onDeleted={() => { panes.close(etab.id); clearPicked() }} />
      )
    }
    if (etab.kind === 'file') {
      const rec = items.find((r) => idOf(r) === etab.who)
      return <RackFilePane value={rec?.[etab.field]} say={setNote} />
    }
    if (etab.kind === 'item') {
      const rec = etab.who ? items.find((r) => idOf(r) === etab.who) : null
      return (
        <RackItemEditor key={etab.id} def={def} doc={doc} rec={rec} seed={etab.seed} ctx={ctx} onSave={commit}
          canDelete={IS_ADMIN} onCancel={() => panes.close(etab.id)}
          onClone={(seed) => openItem(null, null, seed)}
          onCreated={(r) => { panes.close(etab.id); openItem(idOf(r), r) }}
          onDeleted={(r) => {
            panes.close(etab.id)
            setPicked((s) => { if (!s.has(idOf(r))) return s; const n = new Set(s); n.delete(idOf(r)); return n })
          }} />
      )
    }
    if (etab.kind === 'merge') {
      const c = def.classes.find((x) => x.k === etab.of)
      const field = c && wornBy(def, c)
      if (!field) return null
      if (c.stored && c.merge) {
        // Records folded into one: the class says how (the items follow).
        const rowsNow = classRows(def, doc, c, extra)
        const live = rowsNow.filter((r) => (etab.names || []).includes(r.name)).map((r) => r.key)
        const users = items.filter((r) => live.some((k) => wears(r, field, k)))
        return (
          <RackMerge names={etab.names || []} noun={c.noun} exists={rowsNow.map((r) => r.name)}
            count={(t) => rowsNow.find((r) => r.name === t)?.count || 0}
            users={users.map((r) => labelOf(def, r))}
            onMerge={async (gone, to) => {
              if (await commit(c.merge(doc, gone, to),
                tr("rk_merged_into_one_n", c.noun, gone.length + 1, to, users.length, def.unit))) {
                panes.close(etab.id); merge.off()
              }
            }}
            onCancel={() => panes.close(etab.id)} />
        )
      }
      const exists = classRows(def, doc, c, extra).map((r) => r.name)
      const users = wearing(field, etab.names || [])
      return (
        <RackMerge names={etab.names || []} noun={field.label || c.noun} exists={exists}
          count={(t) => wearing(field, [t]).length}
          users={users.map((r) => labelOf(def, r))}
          moved={field.moved ? (to) => field.moved(users, etab.names || [], to) : []}
          movedWhy={field.movedWhy}
          onMerge={async (gone, to) => {
            if (await commit({ [def.item.key]: foldNames(field, gone, to) },
              tr("rk_merged_into_one_n", field.label || c.noun, gone.length + 1, to, users.length, def.unit))) {
              panes.close(etab.id); merge.off()
            }
          }}
          onCancel={() => panes.close(etab.id)} />
      )
    }
    if (etab.kind === 'class') {
      const c = def.classes.find((x) => x.k === etab.of)
      if (!c) return null
      if (c.stored) {
        const rec = etab.who ? findStored(c, etab.who) : null
        return (
          <RackItemEditor key={etab.id} def={def} doc={doc} rec={rec} fields={c.fields} listKey={c.k} noun={c.noun} cls={c}
            ctx={ctx} onSave={commit} onCancel={() => panes.close(etab.id)}
            actions={c.actions ? (f, setF) => c.actions(f, setF, { ...ctx, doc, rec }) : undefined}
            // A list is its maker's to delete, or a manager's.
            canDelete={IS_ADMIN || (!!c.list?.owner && !!rec && rec[c.list.owner] === ME)}
            onCreated={(r) => { panes.close(etab.id); openClass(c, r) }}
            onDeleted={() => panes.close(etab.id)} />
        )
      }
      const field = wornBy(def, c)
      const names = classRows(def, doc, c, extra).map((r) => r.name)
      return (
        <RackEditClass name={etab.who} noun={c.noun} wears={tr("rk_x_using", def.item.noun)} unit={def.unit}
          exists={names} wearing={(gone) => wearing(field, gone).map((r) => ({ id: idOf(r), label: labelOf(def, r) }))}
          onOpen={openItem}
          onSave={async (gone, to, said) => {
            if (await commit({ [def.item.key]: foldNames(field, gone, to) }, said)) panes.close(etab.id)
          }}
          onCancel={() => panes.close(etab.id)}
          onDelete={IS_ADMIN ? async () => {
            if (await commit({ [def.item.key]: foldNames(field, [etab.who], '') },
              tr("rk_removed_name", etab.who))) panes.close(etab.id)
          } : null} />
      )
    }
    return <p className="rl-msg">{tr("rk_cannot_draw_editor")}</p>
  }

  const slotTab = tab?.kind === 'slot' ? (slots.tabs || []).find((t) => t.id === tab.id) : null
  // A class row's cells are drawn by its fields' types, as an item's are —
  // and a field may draw its own (a count you press to get the papers).
  const classCells = (r, i) => {
    const c = { def, doc, ...ctx, rec: r }
    return {
      num: i + 1,
      ...Object.fromEntries(cls.fields.filter((f) => f.col).map((f) => {
        const fc = { ...c, field: f }
        return [f.k, f.cell ? f.cell(r, fc) : typeOf(f).cell(valueOf(f, r, fc), fc)]
      })),
      ...(cls.stored ? {} : { name: r.name || D }),
      count: r.count || D,
    }
  }

  return (
    <div className="rl" style={brandStyle()}>
      <section className="rl-mod">
        <RackBar title={def.title} count={doc ? `${items.length}${def.unit}` : ''} />

        <div className="rl-cmd">
          {cls?.stored ? (
            /* Mustard: it is only here while a class tab is, and the colour is
               what says so. */
            <button type="button" className="rl-btn rl-tabonly" onClick={() => openClass(cls, null)}>{tr("rk_add_new_x", cls.noun)}</button>
          ) : (
            <button type="button" className="rl-btn rl-go" onClick={() => openItem(null)}>{tr("rk_add_new_x", def.item.noun)}</button>
          )}
          {mergeable && (
            <RackMergeButtons merge={merge} noun={cls.stored ? cls.noun : (clsField.label || cls.noun)}
              onOpen={(names) => openEdit({ id: `merge:${cls.k}`, kind: 'merge', of: cls.k, names,
                label: tr("rk_merge_n_x", cls.stored ? cls.noun : (clsField.label || cls.noun), names.length) })} />
          )}
          {slots.commands?.(api)}
          <button type="button" className="rl-btn" disabled={!picked.size} onClick={clearPicked}>clear</button>
          {picked.size > 0 && <span className="rl-n">{tr("rk_select_x", picked.size)}</span>}
          {tab?.kind === 'items' && picked.size > 1 && (
            <button type="button" className="rl-btn" title={tr("rk_bulk_edit_hint")}
              onClick={openMany}>{tr("rk_bulk_edit_n", picked.size)}</button>
          )}
          {tab?.kind === 'items' && picked.size > 0 && listClasses.map((c) => (
            <select key={c.k} className="rl-btn rl-pick" value=""
              onChange={(e) => e.target.value && putInList(c, e.target.value)}>
              <option value="">{tr("rk_put_in_x", c.noun)}</option>
              <option value="+new">{tr("rk_add_new_x", c.noun)}</option>
              {listsFor(c).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || l.id.slice(0, 8)} ({(l[c.list.ids] || []).length}){c.list.owner && l[c.list.owner] && l[c.list.owner] !== ME ? ` · ${l[c.list.owner]}` : ''}
                </option>
              ))}
            </select>
          ))}
          {inList && (
            <button type="button" className="rl-btn rl-tabonly"
              onClick={() => { const l = findStored(inList, tab.key); if (l) openClass(inList, l) }}>{tr("rk_edit_x", inList.noun)}</button>
          )}
          {inList && picked.size > 0 && (
            <button type="button" className="rl-btn" title={tr("rk_remove_from_this_hint", inList.label)}
              onClick={() => takeOutOfList(inList, tab.key)}>{tr("rk_remove_from_x_n", inList.label, picked.size)}</button>
          )}
          <span className="rl-gap" />
          {L.opened > 0 && (
            <button type="button" className="rl-btn" title={tr("rk_close_tabs_hint")} onClick={L.closeOpened}>{tr("rk_close_tabs_n", L.opened)}</button>
          )}
          {panes.tabs.length > 0 && (
            <button type="button" className="rl-btn" title={tr("rk_close_editors_hint")} onClick={panes.closeAll}>{tr("rk_close_editors_n", panes.tabs.length)}</button>
          )}
          {tab?.kind === 'items' && <FilterBar f={filter} />}
          {tab?.kind === 'items' && (def.item.quick || []).map((q) => (
            <button key={q.id} type="button" className={`rl-btn${quick.includes(q.id) ? ' on' : ''}`} title={q.title}
              onClick={() => setQuick((xs) => (xs.includes(q.id) ? xs.filter((x) => x !== q.id) : [...xs, q.id]))}>{q.label}</button>
          ))}
          <span className="rl-sp" />
          <input ref={findRef} type="search" className="rl-find"
            value={filter.mode ? filter.find : query}
            placeholder={filter.mode ? tr("rk_find_value")
              : cls ? tr("rk_find_in_list") : (def.item.findHint || tr("rk_find_x", def.item.noun))}
            onChange={(e) => (filter.mode ? filter.setFind : setQuery)(e.target.value)} />
        </div>

        <div className="rl-body">
          {showList && (<div className="rl-pane" style={showEdit ? split.leftStyle : undefined}>
            <RackTabs tabs={tabs} active={L.active} fixed={FIXED} onPick={L.setActive} onClose={closeTab} />

            {err && <p className="rl-msg">{err}</p>}
            {!err && !doc && <p className="rl-msg">{tr("rk_loading")}</p>}

            {doc && tab?.kind === 'items' && (
              <>
                <RackTable cols={cols} onDrag={drag('')} facet={filter.tableFacet}
                  sort={order}
                  onSort={(k) => setSort((s2) => bumpSort(asSorts(s2).length ? s2 : def.item.order, k))}
                  head={filter.mode ? null : { all: allPicked, some: somePicked, onAll: toggleAll }}>
                  <FacetRows f={filter} labels={{ empty: tr("rk_column_empty") }} />
                  {!filter.mode && rows.map((r, i) => {
                    const rid = idOf(r)
                    const on = picked.has(rid)
                    const edited = panes.tabs.some((t) => (t.kind === 'item' && t.who === rid) || t.ids?.includes(rid))
                    const now = nowAt ? `${nowAt.on.has(rid) ? ' rl-now' : ''}${nowAt.line === i ? ' rl-nowline' : ''}` : ''
                    return (
                      <RackRow key={rid || i} cols={cols} tone={tone} mark={query.trim()}
                        className={`rl-hit${on ? ' on' : ''}${edited ? ' rl-edited' : ''}${now}`}
                        onClick={(e) => hit(i, e.shiftKey)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          // Right-clicking INSIDE a selection means the selection:
                          // the row is one of the many you picked.
                          if (picked.size > 1 && picked.has(rid)) openMany()
                          else openItem(rid)
                        }}
                        cell={{
                          chk: <input type="checkbox" checked={on} tabIndex={-1} readOnly
                            aria-label={tr("rk_select_x", labelOf(def, r))} />,
                          num: i + 1,
                          fav: (
                            <button type="button" className={`rl-fav${starred(r) ? ' on' : ''}`}
                              title={starred(r) ? tr('rk_fav_remove') : tr('rk_fav_add')}
                              onClick={(e) => { e.stopPropagation(); toggleFav(r) }}>{STAR}</button>
                          ),
                          ...itemCells(def, doc, r, ctx),
                        }} />
                    )
                  })}
                  {!filter.mode && rows.length === 0 && (
                    <p className="rl-msg">{items.length ? tr("rk_no_matching_x", def.item.noun) : tr("rk_no_x_yet", def.item.noun, def.item.noun)}</p>
                  )}
                </RackTable>
                {def.listing?.render && def.listing.render({
                  list: chosen.length ? chosen : scope, picked: chosen.length > 0, doc, tab,
                  say: setNote, open: outOpen, setOpen: setOutOpen,
                })}
                {def.listing && !def.listing.render && (
                  <RackListing list={chosen.length ? chosen : scope} picked={chosen.length > 0}
                    tokens={tokens} presets={def.listing.presets} unit={def.unit}
                    say={setNote} open={outOpen} setOpen={setOutOpen} />
                )}
              </>
            )}

            {doc && cls && (
              <RackTable cols={merge.mode ? mergeCols : clsCols} onDrag={drag('c:')} sort={clsSort}
                onSort={(k) => setClsSort((s2) => (s2.k === k ? { k, dir: -s2.dir } : { k, dir: 1 }))}
                head={merge.mode ? merge.head(classes.map((r) => r.name)) : null}>
                {classes.map((r, i) => {
                  const on = merge.mode && merge.has(r.name)
                  return (
                    <RackRow key={r.id || r.key || r.name} cols={merge.mode ? mergeCols : clsCols} tone={tone} mark={query.trim()}
                      className={`rl-hit${on ? ' on' : ''}`}
                      onClick={() => (merge.mode ? merge.toggle(r.name)
                        : openTab({ id: `${cls.k}:${r.key || r.name}`, kind: 'items', of: cls.k,
                          key: r.key || r.name, name: r.name, label: rowLabel(cls, r) || r.name }))}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        // A class of links names people who live in another
                        // service: there is nothing here to rename them in.
                        if (!isRef(clsField)) openClass(cls, r)
                      }}
                      cell={{
                        ...(merge.mode ? { chk: <input type="checkbox" checked={on} tabIndex={-1} readOnly
                          aria-label={tr("rk_select_x", r.name)} /> } : {}),
                        ...classCells(r, i),
                      }} />
                  )
                })}
                {classes.length === 0 && <p className="rl-msg">{tr("rk_none_yet")}</p>}
              </RackTable>
            )}

            {doc && tab?.kind === 'calendar' && (
              <RackCalendar def={def} doc={doc} ctx={ctx} picked={picked} at={calAt}
                // The search box narrows the calendar as it does the table.
                items={query.trim() ? items.filter((r) => search(r, query.trim().toLowerCase())) : items}
                query={query.trim()}
                onPick={(id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })}
                onOpen={(id) => openItem(id)}
                onNew={(seed) => openItem(null, null, seed)}
                onResize={(rec, patch) => commit({
                  [def.item.key]: items.map((x) => (x === rec ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x)),
                }, tr("rk_date_changed", labelOf(def, rec)))}
                // One occurrence of a repeating record (calendar.repeat), and which
                // of them a change is for — as Google Calendar asks it.
                onOccurrence={(how, rec, occ) => {
                  const cal = def.calendar, R = cal.repeat, S = cal.series, O = cal.seriesDate
                  const rp = rec[R] || {}
                  const key = def.item.key, now = new Date().toISOString(), all = doc[key] || []
                  const first = String(rec[cal.start]).slice(0, 10)
                  const days = Math.round((Date.parse(occ) - Date.parse(first)) / 864e5)
                  const made = (o) => { let r = { ...cloneOf(def, rec, days), ...o, id: newId(), createdAt: now, updatedAt: now }; if (def.item.fill) r = def.item.fill(r, doc); return r }
                  if (how === 'all') { openItem(idOf(rec), rec); return }
                  if (how === 'delete') {
                    commit({ [key]: all.map((x) => (x === rec ? { ...x, [R]: { ...rp, ex: [...new Set([...(rp.ex || []), occ])].sort() }, updatedAt: now } : x)) },
                      tr("rk_occurrence_deleted", labelOf(def, rec), occ))
                    return
                  }
                  if (how === 'one') {
                    // This day alone: a record of its own, tied to the series by the day it was.
                    const r = made({ [R]: null, [S]: { id: rec.id }, [O]: occ })
                    commit({ [key]: [r, ...all] }, tr("rk_occurrence_split", labelOf(def, rec), occ))
                      .then((ok) => { if (ok) openItem(idOf(r), r) })
                    return
                  }
                  // This day and after: the series ends the day before, and a new one
                  // starts here — with what was left of a COUNT, and the days left out
                  // and changed from here on.
                  const p = parseRule(rp.rule)
                  const before = new Date(Date.parse(occ) - 864e5).toISOString().slice(0, 10)
                  let oldRule = withUntil(rp.rule, before), newRule = rp.rule
                  if (p.count) {
                    const done = occurrences(first, rp.rule, first, before).length
                    oldRule = withCount(rp.rule, done)
                    newRule = withCount(rp.rule, Math.max(1, p.count - done))
                  }
                  const r = made({ [R]: { rule: newRule, ex: (rp.ex || []).filter((d) => d >= occ) } })
                  const next = all.map((x) => {
                    if (x === rec) return { ...x, [R]: { rule: oldRule, ex: (rp.ex || []).filter((d) => d < occ) }, updatedAt: now }
                    const s2 = x[S]?.id ?? x[S]
                    return s2 === rec.id && String(x[O] || '') >= occ ? { ...x, [S]: { id: r.id }, updatedAt: now } : x
                  })
                  commit({ [key]: [r, ...next] }, tr("rk_series_split", labelOf(def, rec), occ))
                    .then((ok) => { if (ok) openItem(idOf(r), r) })
                }}
                // Dropped on another day: a copy there, made as 등록 would.
                onCopy={(rec, days) => {
                  const now = new Date().toISOString()
                  let r = { ...cloneOf(def, rec, days), id: newId(), createdAt: now, updatedAt: now }
                  if (def.item.fill) r = def.item.fill(r, doc)
                  const patch = { [def.item.key]: [r, ...(doc[def.item.key] || [])] }
                  Object.assign(patch, def.item.onSave?.(r, null, { ...doc, ...patch }) || {})
                  return commit(patch, tr("rk_copied_x", labelOf(def, r)))
                }} />
            )}

            {doc && tab?.kind === 'trash' && <RackTrash def={def} setDoc={setDoc} say={setNote} />}

            {doc && tab?.kind === 'settings' && (
              <div className="rl-settings">
                {hasRoots(def) && (
                  <RackSettings def={def} doc={doc} folders={folders} onSave={commit} say={setNote}
                    onReload={reloadFolders} onOpenFolder={openFolder} />
                )}
                {slots.settings?.(api)}
              </div>
            )}

            {doc && slotTab && slotTab.render(api)}
          </div>)}

          {showList && showEdit && <div {...split.handleProps} />}
          {showEdit && panes.cols.map((c) => {
            const etab = panes.current(c)
            return (
              <div key={c} className="rl-pane rl-epane" onMouseDown={() => panes.setCol(c)}
                style={showList && panes.cols.length === 1 ? split.rightStyle : undefined}>
                <RackPaneStrip panes={panes} col={c} />
                {etab && editorFor(etab)}
              </div>
            )
          })}
        </div>

        <footer className="rl-foot">
          <span>{note || tr("rk_status_hint")}</span>
          <span className="rl-sp" />
          <span className="rl-mono">
            {cls ? (classes.length ? tr("rk_n_rows", classes.length) : '') : (tab?.kind === 'items' && rows.length ? tr("rk_n_rows", rows.length) : '')}
          </span>
        </footer>
      </section>
    </div>
  )
}
