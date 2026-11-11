import './strings.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RackTable, RackRow, RackTabs } from './table.jsx'
import { RackFrame } from './frame.jsx'
import { RackPaneStrip, RackPaneTools, paneLayout, paneStyles, useTabSpread, FULL } from './panes.jsx'
import { RackBar } from './bar.jsx'
import { RackMenu, RackRail, MenuRow, useRackMenu } from './menu.jsx'
import { PaneFind } from './panefind.jsx'
import { RackCalendar } from './calendar.jsx'
import { RackTrash, TRASH_COLS } from './trash.jsx'
import { occurrences, parseRule, withUntil, withCount } from './rrule.js'
import { RackEditClass } from './classedit.jsx'
import { FilterBar, FacetRows, useFacetFilter } from './filter.jsx'
import { RackListing } from './listing.jsx'
import { RackItemEditor, cloneOf } from './editor.jsx'
import { chainKey, flowFor } from './chain.js'
import { useMergeMode, RackMergeButtons, RackMerge, RackMoveTags } from './merge.jsx'
import { RackBulkEditor } from './bulk.jsx'
import { useRackList } from './list.js'
import { useRackKeys, useToggleKey } from './hooks.js'
import { typeOf, NoteEdit } from './types.jsx'
import { useFolders, RackFolder, RackFilePane, RackSettings, hasRoots } from './files.jsx'
import { asSorts, bumpSort, bySome, byKeys } from './sort.js'
import {
  defineRack, isFav, withFav, caseFree, itemColumns, classColumns, itemSorters, itemCells, itemSearch, itemTokens,
  classRows, wornBy, wears, isRef, fixedTabs, itemTabId, itemScope, labelOf, useRemoteDocs, valueOf,
  EMPTY_CELL as D,
} from './schema.js'
import { PORTAL_PROJECT, PORTAL_SERVICE, PROJECT_LINKED, brandStyle, isManager, portalUser, fetchDoc, putDoc, newId, takeOpenRequest, showInCalendar, calAsk, calFilterAsk, load, save, projectKey, serviceColor } from './portal.js'
import { tr } from 'lilak-ui/i18n.jsx'
import { tagKey, tagTree, tagWithin, tagRenames, useTagSources, sharedTagRows, useFavTags, renameTagEverywhere, renameTagHere, forgetTagSources, uniqueTags } from './tags.js'
import { RackTagged, RackTaggedTab, TAGGED_COLS, TAGGED_SORTERS, useTaggedRows } from './tagged.jsx'

/**
 * <RackService def={…} /> — a whole rack-list service from its declaration.
 *
 *   타이틀 바     [메뉴 ▾] (what the tab can do) · the tabs · the editors' buttons · ↻ — in its own colour
 *                 the tabs: every item · one tab per class · the tabs you opened
 *                 at its right end: the editors' buttons · ⚙ (the settings tab, a manager's) · ↻
 *   [표]          the items (or a class's records), with [나열] under it
 *   [편집창]      beside it: an item, a class record, a tag, a file, a folder
 *   발 줄         what was just done · how many · the search · 휴지통
 *
 * Nothing here knows what the records are about; `def` (see defineRack) does.
 *
 * The ways out, for what a declaration cannot say:
 *   slots.commands(api)          more buttons in the menu, under making
 *   slots.pick(api)              more buttons in the menu, under the selection
 *   slots.show(api)              more buttons in the menu, under what is shown
 *   slots.barTools(api)          a button of its own in the title bar, left of ↻
 *   slots.keep(item)             which items the service's own filter lets through
 *   slots.keepOn                 that filter holds something back (the menu says so, shut)
 *   slots.keepTools(api)         its controls in the open menu, where barTools gives way
 *   slots.tabs                   [{ id, label, render(api) }] — tabs of the service's own
 *   slots.settings(api)          more of the settings tab, under the kit's (a manager's)
 *                                (`lead: true` puts one before the items and opens on it)
 *   slots.views                  { view: (tab, api) => node } — tabs of its own opened on
 *                                demand: api.openTab({ id, kind: 'view', view, label, who? });
 *                                kept like any opened tab (who: the item it is for)
 *   slots.editors                { kind: (tab, api) => node } — editor panes of its own;
 *                                open one with api.openEdit({ id, kind, label, … })
 *   registerType(name, type)     a field type of its own (types.jsx)
 *   field.cell / field.edit      one field drawn differently
 *
 * A service whose records are not rackstore's says where they are:
 *   def.source = { load() => doc, save(body, doc) => { doc } | { conflict, doc } }
 *   def.item.create() => { id, label }   a new record made at once, then opened
 *   def.item.find(q) => Map(id → text)   what the server finds inside the records;
 *                                        fields and item.search see it as ctx.hits
 *   def.trash: false                     no trash (it is not rackstore's either)
 *
 * `api` is what those get: doc, commit(patch, said), reload(), openTab, openEdit,
 * setNote, the selection (picked, chosen), the current tab and the search (query). A field's
 * widget and cell get much the same through `ctx`.
 */
// The favourite star: soft at the points (round joins), filled when it is one (CSS).
const STAR = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <polygon points="12,3 14.7,8.8 21,9.5 16.3,13.9 17.6,20.2 12,17 6.4,20.2 7.7,13.9 3,9.5 9.3,8.8" />
  </svg>
)
/** The star a row wears: an item's, a tag's. Pressing it does not press the row. */
export const RackStar = ({ on, onToggle }) => (
  <button type="button" className={`rl-fav${on ? ' on' : ''}`} title={on ? tr('rk_fav_remove') : tr('rk_fav_add')}
    onClick={(e) => { e.stopPropagation(); onToggle() }}>{STAR}</button>
)

/** An item editor's own buttons: "show in calendar" (the calendar at the record's first
 *  day), then each note field's 노트 만들기 / 노트 열기. */
const itemButtons = (def, ctx, doc) => {
  const notes = def.item.fields.filter((fl) => fl.type === 'note')
  const show = def.calendar && ctx.showDate
  if (!show && !notes.length) return undefined
  return (f, setF) => {
    const d = show && f[def.calendar.start || 'start']
    return (
      <>
        {d && <button type="button" className="rl-btn" onClick={() => show(d)}>{tr("rk_show_in_calendar")}</button>}
        {notes.map((fl) => <NoteEdit key={fl.k} bare field={fl} value={f[fl.k]} rec={f} ctx={{ ...ctx, def, doc, field: fl }}
          onChange={(v) => setF((s) => ({ ...s, [fl.k]: v }))} />)}
      </>
    )
  }
}

const NONE = []                       // one empty list, so a hook sees the same one each render

// ?solo=<id>: the page is one item's editor and nothing else — what another
// service shows it as, in a pane of its own (project_manager's tags, its inbox).
// `class:<k>:<id>` is a class record's editor (an author_manager group).
const SOLO = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('solo') : null
// ?bare=1: the list without its bar and tab strip — one tab of it (#open=tab:…)
// shown inside another service's tab (a group's authors under a project).
// The menu's column, as wide as the calendar's head (rack.css .rl-mod-rail sets the
// width; this is the same sum on the window, for the columns the table gives up).
const menuWidth = () => (typeof window === 'undefined' ? 0 : 10 + Math.max(120, (window.innerWidth - 20) * 2 / 23))
const BARE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bare')
// A save anywhere on this page's service and project (a solo editor in another
// service's pane, the list itself) tells every open list of it to read again.
const savedHere = (key) => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(projectKey(key, 'saved')))

export function RackService(props) {
  return SOLO ? <RackSolo {...props} id={SOLO} /> : <RackList {...props} />
}

/** One item's editor, alone, the same editor the list opens. Its cancel has no
 *  list to go back to; an item deleted here says so. */
function RackSolo({ def: declared, id }) {
  const def = useMemo(() => (declared.docKeys ? declared : defineRack(declared)), [declared])
  const [doc, setDoc] = useState(null)
  const [note, setNote] = useState('')
  const [gone, setGone] = useState(false)
  const remote = useRemoteDocs(def)
  const [folders, reloadFolders] = useFolders(def)
  useEffect(() => { fetchDoc().then(setDoc).catch((e) => setNote(String(e.message || e))) }, [])
  // One channel for this page, closed with it — not a new one left open per save.
  const told = useMemo(() => savedHere(def.key), [def.key])
  useEffect(() => () => told?.close(), [told])
  const commit = useCallback(async (patch, said) => {
    if (!doc) return false
    try {
      const r = await putDoc(doc.version, Object.fromEntries(def.docKeys.filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]])))
      if (r.conflict) { if (r.doc) setDoc(r.doc); setNote(tr("rk_changed_meanwhile")); return false }
      setDoc(r.doc)
      setNote(said || tr("rk_saved"))
      told?.postMessage({ version: r.doc.version, doc: r.doc })
      return true
    } catch (e) { setNote(String(e.message || e)); return false }
  }, [doc, def, told])
  const [, of, who] = /^class:([^:]+):(.+)$/.exec(id) || []
  const c = of && def.classes.find((x) => x.k === of && x.stored)
  const rec = c ? (doc?.[of] || []).find((r) => String(r.id) === who)
    : (doc?.[def.item.key] || []).find((r) => String(r?.[def.item.id || 'id']) === String(id))
  // A day here is shown on this service's own calendar, in the portal's panel:
  // the date labels, and one button for the record's first day.
  const showDate = def.calendar ? (d) => d && showInCalendar(id, d) : undefined
  // Framed in another service's pane, what this editor opens goes in that
  // page's editors: it has none of its own.
  const inPane = window.parent !== window
  const toPage = (m) => window.parent.postMessage(m, window.location.origin)
  const ctx = { remote, folders, reloadFolders, say: setNote, commit, isAdmin: isManager(), showDate,
    ...(inPane ? { openFrame: (rackFrame) => toPage({ rackFrame }), openRecord: (rackOpen) => toPage({ rackOpen }) } : {}) }
  return (
    <div className="rl rl-solo" style={brandStyle()}>
      {!doc ? <p className="rl-msg">{note || tr("rk_loading")}</p>
        : gone || !rec ? <p className="rl-msg">{tr("rk_open_target_missing")}</p>
          : <RackItemEditor key={id} def={def} doc={doc} rec={rec} ctx={ctx} onSave={commit} canDelete={isManager()}
            {...(c ? { fields: c.fields, listKey: c.k, noun: c.noun, cls: c } : {})}
            onCancel={() => {}} onDeleted={() => setGone(true)}
            actions={c ? undefined : itemButtons(def, ctx, doc)} />}
      {doc && note && <div className="rl-hint rl-solo-note">{note}</div>}
    </div>
  )
}

function RackList({ def: declared, slots = {} }) {
  const def = useMemo(() => (declared.docKeys ? declared : defineRack(declared)), [declared])
  const [doc, setDoc] = useState(null)
  const [outOpen, setOutOpen] = useState(false)
  const remote = useRemoteDocs(def)
  const [folders, reloadFolders] = useFolders(def)
  const folderField = useMemo(() => def.item.fields.find((f) => f.type === 'folder'), [def])
  const IS_ADMIN = useMemo(() => isManager(), [])
  const ME = useMemo(() => portalUser()?.email || '', [])
  const FIRST = (slots.tabs || []).find((t) => t.lead)?.id || itemTabId(def)

  const FIXED = useMemo(() => {
    const [all, ...classTabs] = fixedTabs(def)
    return [
      all,
      // A month of the items, when they have dates (def.calendar) — the items
    const slot = (t) => ({ id: t.id, kind: 'slot', label: t.label })
      // again, so beside them.
      ...(slots.tabs || []).filter((t) => t.lead).map(slot),
      ...(def.calendar ? [{ id: 'calendar', kind: 'calendar', label: tr("rk_tab_calendar") }] : []),
      ...classTabs,
      ...(slots.tabs || []).filter((t) => !t.lead).map(slot),
      // What was deleted, and the way back — a manager's, as deleting is.
      // Where the service may read the disk is a manager's to say.
      ...(IS_ADMIN && (hasRoots(def) || slots.settings) ? [{ id: 'settings', kind: 'settings', label: tr("rk_tab_settings") }] : []),
    ]
  }, [def, slots.tabs, slots.settings, IS_ADMIN])

  // What the server found INSIDE the records for the search (def.item.find:
  // note's bodies), id → the line it matched; fields and item.search see it.
  const [hits, setHits] = useState(null)
  const extra = useMemo(() => ({ remote, folders, hits }), [remote, folders, hits])
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
    if (t?.kind !== 'items') return s
    // Embedded (`bare`) there is no title bar to change `keep` from, so it does not apply.
    return s.filter((r) => !drops.some((q) => q.drop(r)) && (BARE || !slots.keep || slots.keep(r)))
  }, [def, doc, extra, sortersFor, drops, slots.keep])
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
  const menuState = useRackMenu(BARE ? undefined : projectKey(def.key, 'menu'))
  const L = useRackList({ idOf, spare: !BARE && menuState.open ? menuWidth() : 0,
    key: BARE ? `${def.key}.bare` : def.key, fixed: FIXED, firstTab: FIRST, scopeOf, search,
    sorters: sortersFor, cols: colSets, clsSort: def.classSort || { k: 'count', dir: -1 },
  })
  const { tab, tabs, openTab, closeTab, rows, scope, filter, panes, split, findRef, drag } = L
  const { sort, setSort, clsSort, setClsSort, query, setQuery, note, setNote, err, setErr } = L
  const { picked, setPicked, hit, all: allPicked, some: somePicked, toggleAll, clear: clearPicked, chosen } = L
  useEffect(() => {
    if (!def.item.find) return undefined
    const q = query.trim()
    if (q.length < 2) { setHits(null); return undefined }
    const t = setTimeout(() => def.item.find(q).then(setHits).catch(() => setHits(null)), 250)
    return () => clearTimeout(t)
  }, [query, def])
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

  // The document comes from rackstore's /api/data — or from the service's own
  // `def.source` (note: a file per note, behind its own API).
  const loadDoc = def.source?.load || fetchDoc
  const reload = useCallback(() => loadDoc().then(setDoc).catch((e) => setErr(String(e.message || e))), [loadDoc])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!PORTAL_PROJECT) { setErr(tr("rk_open_via_portal")); return }
    reload()
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const said = useMemo(() => savedHere(def.key), [def.key])
  useEffect(() => {
    if (!said) return undefined
    // The saver sends the document it got back; a message from before that
    // (a version alone) means read again.
    said.onmessage = (e) => { if (e.data?.doc) setDoc(e.data.doc); else loadDoc().then(setDoc).catch(() => {}) }
    return () => said.close()
  }, [said])
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
      if (t.kind === 'tagged') return !t.item || items.some((r) => idOf(r) === t.item)
      if (t.kind === 'view') return !!slots.views?.[t.view] && (!t.who || items.some((r) => idOf(r) === t.who))
      if (t.ids || t.src) return true
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
  const commit = useCallback(async (patch, saidAs) => {
    if (!doc) return false
    try {
      // Only the keys this edit touched: the store keeps the rest as they are
      // (merge), and a paper's save no longer carries 2,000 authors with it.
      // A source of the service's own (note) still gets the whole document.
      const touched = Object.fromEntries(def.docKeys.filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]]))
      const body = def.source?.save ? Object.fromEntries(def.docKeys.map((k) => [k, patch[k] ?? doc[k]])) : touched
      const r = def.source?.save ? await def.source.save(body, doc) : await putDoc(doc.version, body)
      if (r.conflict) {
        if (r.doc) setDoc(r.doc)
        setNote(tr("rk_changed_meanwhile"))
        return false
      }
      setDoc(r.doc)
      setNote(saidAs || tr("rk_saved"))
      said?.postMessage({ version: r.doc.version, doc: r.doc })
      // A number on this service's icon may have changed: the portal asks again.
      if (window.top !== window) window.top.postMessage({ type: 'lilak:saved' }, window.location.origin)
      return true
    } catch (e) { setNote(String(e.message || e)); return false }
  }, [doc, def, setNote, said])

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
  // occ: the sitting of a record that repeats it is opened on (its flow steps from there).
  const openItem = useCallback((id, rec, seed, occ) => {
    const r = rec || (doc?.[def.item.key] || []).find((x) => idOf(x) === id)
    // Bare inside another service's tab: a record opens in THAT page's editors
    // (its openRecord), not in a second row of panes in here.
    if (BARE && id && window.parent !== window) {
      window.parent.postMessage({ rackOpen: { svc: PORTAL_SERVICE.name, proj: PORTAL_PROJECT, id,
        label: r ? labelOf(def, r) : id } }, window.location.origin)
      return
    }
    // A record the service makes itself (note: a file, made by its API) opens
    // made, its name first — not as a blank form.
    if (!id && !seed && def.item.create) {
      def.item.create().then(async (made) => {
        if (!made) return
        setDoc(await loadDoc())
        openEdit({ id: `item:${made.id}`, kind: 'item', who: made.id, label: made.label || made.id, fresh: true })
      }).catch((e) => setNote(String(e.message || e)))
      return
    }
    if (!id && seed) panes.close('item:new')
    const open = () => openEdit({ id: `item:${id || 'new'}`, kind: 'item', who: id || null, seed, ...(occ ? { occ } : {}),
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
    onClose: () => { const cur = panes.showing && panes.current(panes.cols[0]); if (cur) panes.leave(cur.id) },
  })

  /** A record of ANOTHER service, in a pane here: that service's page for it
   *  alone (?solo=), its tab in that service's colour. The one way every
   *  service opens another's records (a note's to-do on the calendar, what
   *  wears a shared tag, an approved candidate). */
  const openRecord = useCallback(({ svc, proj, id, label }) => serviceColor(svc).then((color) =>
    openEdit({ id: `rec:${svc}:${id}`, kind: 'frame', label, color,
      src: `/pp/${svc}/${proj}/?solo=${encodeURIComponent(id)}` })), [openEdit])
  /** A solo editor framed here walked to another record of its own service (a
   *  note's flow, stepped inside the frame): the TAB follows it. Without this
   *  the tab still holds the src it was opened with, and the next draw of the
   *  frame — a refresh, or coming back to this tab — goes back to the record
   *  that was open the day the tab was made.
   *
   *  The tab is found by what it is SHOWING, not by its name: a frame is
   *  opened as `rec:<svc>:<id>` here and as `note:<id>` by a field, and only
   *  the src is sure. */
  const stepFrame = useCallback(({ was, id, label, src }) => {
    const showing = `solo=${encodeURIComponent(was)}`
    const t = panes.tabs.find((x) => x.kind === 'frame' && String(x.src || '').includes(showing))
    if (t) panes.step(t.id, { ...t, id: t.id.split(was).join(id), label: label || t.label, src })
  }, [panes])
  useEffect(() => {                                     // …and what a bare list or a solo editor framed here asks for
    const take = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.rackOpen) openRecord(e.data.rackOpen)
      if (e.data?.rackFrame) openEdit({ ...e.data.rackFrame, kind: 'frame' })
      if (e.data?.rackStep) stepFrame(e.data.rackStep)
    }
    window.addEventListener('message', take)
    return () => window.removeEventListener('message', take)
  }, [openRecord, openEdit, stepFrame])

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
    const keys = calFilterAsk(asked)                       // `calf:<keys>`: the calendar, filtered
    const [, of, who] = /^tab:([^:]+):(.+)$/.exec(asked) || []   // `tab:<class>:<id>`: that class row's items
    if (of) {
      const c = def.classes.find((x) => x.k === of)
      const r = c && classRows(def, doc, c, extra).find((x) => String(x.id ?? x.key) === who)
      if (r) openTab({ id: `${c.k}:${r.key || r.name}`, kind: 'items', of: c.k, key: r.key || r.name, name: r.name, label: rowLabel(c, r) || r.name })
      else setNote(tr("rk_open_target_missing"))
      return
    }
    if (keys) { showDate(new Date().toLocaleDateString('sv'), keys); return }
    const [day, id] = calAsk(asked) || ['', asked]      // `cal:<day>:<id>`: on the calendar, at that day
    if (items.some((r) => idOf(r) === id)) openItem(id)
    else setNote(tr("rk_open_target_missing"))
    if (day) showDate(day)
  }, [doc, asked, answered])   // eslint-disable-line react-hooks/exhaustive-deps
  // A day to show on the calendar (a date's label pressed in an editor). The
  // calendar must be in sight: a full-width editor gives the list its width
  // back, and where the two cannot stand side by side the editors close
  // (each saves what it holds as it goes).
  const [calAt, setCalAt] = useState(null)
  const showDate = useCallback((d, tags) => {
    if (!d) return
    panes.setFull(false)
    if (L.vw < 1180 || panes.cols.length > 1) panes.closeAll()     // as useRackList's showList
    openTab({ id: 'calendar', kind: 'calendar', label: tr("rk_tab_calendar") })
    setCalAt({ d: String(d).slice(0, 10), n: Date.now(), ...(tags ? { tags } : {}) })
  }, [openTab, panes, L.vw])
  const ctx = useMemo(() => ({
    remote, folders, hits, reloadFolders, openFolder, openFile, say: setNote, openItem,
    openClass: openClassByName, openTab, openEdit, commit, isAdmin: IS_ADMIN, tab,
    showDate: def.calendar ? showDate : undefined,
    // Another service's page as an editor tab: { id, label, src }.
    openFrame: (t) => openEdit({ ...t, kind: 'frame' }),
    openRecord,
  }), [remote, folders, hits, reloadFolders, openFolder, openFile, setNote, openItem, openClassByName,
    openTab, openEdit, openRecord, commit, IS_ADMIN, tab, def.calendar, showDate])
  const api = { def, doc, commit, reload, openTab, openEdit, closeEdit: (id) => panes.close(id), openItem, setNote,
    picked, setPicked, clearPicked, chosen, tab, rows, scope, query,
    // Where the editors stand (cols, full, dock) and where the border between
    // the list and them is. An editor of a service's own may open something
    // beside itself and has to know what room there is — note's tools widen
    // the pane by their own width rather than squeezing the text.
    panes, split,
    // A tab of the service's own draws its own table; hand it the columns
    // machinery the kit's tables use so its columns drag and are remembered
    // too. Its own width prefix keeps it apart from the records' table.
    colsOf: L.colsOf, drag: L.drag, vw: L.vw }

  // A column may belong to some tabs only (a group's core on that group's tab).
  const cols = useMemo(() => L.colsOf('').filter((c) => !c.when || c.when(tab)), [L.colsOf, tab])   // eslint-disable-line react-hooks/exhaustive-deps
  const [tagAgain, setTagAgain] = useState(0)
  // The other services' tags are for the tags tab (its columns, its rows, a
  // merge's names); an editor's suggestions ask on their own (useSharedTags).
  // Asked when that tab is open, not five requests on every opening of a page.
  const tagSources = useTagSources(tagAgain, !!cls)
  const { isFavTag, toggleFavTag } = useFavTags()
  // A tags tab: after this service's count, a column per other service that
  // shares tags (and per record kind here that wears them too: an author
  // group), each saying how many wear the tag there.
  const perCols = useMemo(() => {
    if (!cls || cls.stored || !caseFree(clsField)) return []
    const own = PORTAL_SERVICE.name
    return [
      ...def.classes.filter((c) => c.stored && (doc?.[c.k] || []).some((r) => Array.isArray(r?.tags) && r.tags.length))
        .map((c) => ({ k: `cls:${c.k}`, w: 80, min: 46, label: c.label, num: true })),
      ...tagSources.filter((s) => s.svc !== own).map((s) => ({ k: `svc:${s.svc}`, w: 96, min: 46, label: s.label, num: true })),
    ]
  }, [cls, clsField, def, doc, tagSources])
  const clsCols = useMemo(() => (cls ? L.colsOf('c:', [...classColumns(def, cls), ...perCols]).filter((c) => !c.when || c.when(tab)) : []), [L.colsOf, cls, def, tab, perCols])   // eslint-disable-line react-hooks/exhaustive-deps
  const mergeCols = useMemo(() => [{ k: 'chk', w: 26, min: 26, fix: true }, ...clsCols], [clsCols])
  // A tags tab lists the tags worn here — by its items, or by its other
  // records (an author group) — each with where else it is worn (tags.js),
  // and the ones this account starred on top. A class that says `shared`
  // lists every service's tags (project_manager).
  const classes = useMemo(() => {
    if (!cls) return []
    const q = query.trim().toLowerCase()
    let all = classRows(def, doc, cls, extra)
    if (!cls.stored && caseFree(clsField)) {
      const here = new Map(all.map((r) => [r.key, r]))
      const own = PORTAL_SERVICE.name
      // What this service wears now: its items' tags, and its other records'
      // (an author group's) — the same as its /api/tags says.
      const worn = Object.fromEntries(all.map((r) => [r.name, r.count]))
      const besides = new Map()           // tag → { 'cls:groups': 1 }, the records here that are not items
      for (const c of def.classes.filter((x) => x.stored)) {
        const n = new Map()
        for (const r of doc?.[c.k] || []) for (const t of Array.isArray(r?.tags) ? r.tags : []) {
          worn[t] = (worn[t] || 0) + 1
          n.set(tagKey(t), (n.get(tagKey(t)) || 0) + 1)
        }
        for (const [k, v] of n) besides.set(k, { ...(besides.get(k) || {}), [`cls:${c.k}`]: v })
      }
      all = sharedTagRows(tagSources, { svc: own, tags: worn })
        .filter((t) => cls.shared || here.has(t.key) || besides.has(t.key))
        .map((t) => ({ ...(here.get(t.key) || { key: t.key, name: t.name, count: 0 }),
          per: { ...besides.get(t.key), ...Object.fromEntries(t.by.filter((b) => b.svc !== own).map((b) => [`svc:${b.svc}`, b.n])) } }))
    }
    // Every spelling the record holds is searched — an alias, a handle.
    all = all.filter((r) => !q || Object.values(r).flat().some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
    const f = cls.fields.find((x) => x.k === clsSort.k)
    const c = { def, doc, ...extra }
    const get = clsSort.k === 'count' ? (r) => r.count
      : clsSort.k.includes(':') ? (r) => r.per?.[clsSort.k] ?? null
        : f?.get ? (r) => f.get(r, c) : (r) => r[clsSort.k]
    // The one sort is shared by the class tabs: one this tab has no column for
    // (the tags tab's name, in the inbox) leaves it in the order it is kept.
    if (clsSort.k === 'count' || clsCols.some((x) => x.k === clsSort.k)) all.sort(bySome(get, clsSort.dir))
    return !cls.stored && caseFree(clsField) ? [...all.filter((r) => isFavTag(r.name)), ...all.filter((r) => !isFavTag(r.name))] : all
  }, [cls, clsCols, clsField, def, doc, query, clsSort, extra, tagSources, isFavTag])
  // A class tab (the tags) filters as the items tab does: by its columns' values.
  const clsSorters = useMemo(() => {
    if (!cls) return {}
    const c = { def, doc, ...extra }
    return Object.fromEntries(clsCols.map(({ k }) => {
      const f = cls.fields.find((x) => x.k === k)
      const get = k === 'count' ? (r) => r.count : k.includes(':') ? (r) => r.per?.[k] ?? null
        : f?.get ? (r) => f.get(r, c) : (r) => (Array.isArray(r[k]) ? r[k].join(', ') : r[k])
      // Filtering a tags tab by a parent keeps what is inside it.
      if (k === 'name' && !cls.stored && caseFree(clsField)) get.many = (r) => [r.name]
      return [k, get]
    }))
  }, [cls, clsCols, clsField, def, doc, extra])
  const clsFilter = useFacetFilter(classes, clsSorters)
  const clsShown = clsFilter.on ? classes.filter(clsFilter.passes) : classes
  // A tags tab is an outline: `agent/rack` under `agent`, which opens and shuts.
  // Looking for something opens everything, or the match would stay hidden.
  const [tagOpen, setTagOpen] = useState(() => new Set(load(projectKey(def.key, 'tagopen'), [])))
  useEffect(() => { save(projectKey(def.key, 'tagopen'), [...tagOpen]) }, [def.key, tagOpen])
  const tagFold = useCallback((k) => setTagOpen((s) => {
    const n = new Set(s)
    if (!n.delete(k)) n.add(k)
    return n
  }), [])
  const outline = !!cls && !cls.stored && caseFree(clsField)
  const clsLooking = !!query.trim() || clsFilter.on
  const clsRowsNow = useMemo(() => (!outline ? clsShown : tagTree(clsShown, (k) => clsLooking || tagOpen.has(k),
    (a, b) => (isFavTag(b.name) - isFavTag(a.name)) || byKeys(clsSort, clsSorters)(a, b))),
  [outline, clsShown, clsLooking, tagOpen, isFavTag, clsSort, clsSorters])
  const clsNested = outline && clsRowsNow.some((r) => r.kids)
  // A tagged tab (a shared tag's, or a project's — which reads its tags now,
  // so editing them changes what it shows): its rows, sorted and filtered here.
  const tgRec = tab?.kind === 'tagged' && tab.item ? items.find((x) => idOf(x) === tab.item) : null
  const tg = def.item.tagged || {}
  const tgRows = useTaggedRows(tab?.kind !== 'tagged' ? NONE : tgRec ? (tgRec[tg.tags || 'tags'] || NONE) : (tab.names || NONE),
    tgRec ? (tgRec[tg.match || 'match'] || 'or') : 'or', PORTAL_SERVICE.name, tgRec ? labelOf(def, tgRec) : '')
  const [tgSort, setTgSort] = useState([{ k: 'date', dir: -1 }])
  const tgFilter = useFacetFilter(tgRows || NONE, TAGGED_SORTERS)
  const tgShown = useMemo(() => {
    if (!tgRows) return null
    const q = query.trim().toLowerCase()
    return tgRows.filter((r) => (!tgFilter.on || tgFilter.passes(r))
      && (!q || [r.svc, r.kind, r.date, r.what, r.sub].some((v) => String(v || '').toLowerCase().includes(q))))
      .sort(byKeys(tgSort, TAGGED_SORTERS))
  }, [tgRows, tgFilter.on, tgFilter.passes, query, tgSort])
  // A filter is the tab's own: another tab starts without it.
  useEffect(() => { clsFilter.clear(); tgFilter.clear() }, [tab?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  const fNow = tab?.kind === 'items' ? filter : tab?.kind === 'tagged' ? tgFilter : cls && !merge.mode ? clsFilter : null

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
  // A tag is the same tag in any case: every spelling of one goes with it.
  const goneHas = (field, gone) => (caseFree(field)
    ? ((s) => new Set(gone.map(tagKey)).has(tagKey(s))) : (x) => gone.includes(x))
  const foldNames = (field, gone, to) => items.map((r) => {
    if (field.fold) return field.fold(r, gone, to)
    const v = r[field.k], has = goneHas(field, gone)
    if (Array.isArray(v)) {
      if (!v.some(has)) return r
      const next = []
      for (const x of v) { const y = has(x) ? to : x; if (y && !next.includes(y)) next.push(y) }
      return { ...r, [field.k]: next }
    }
    return has(v) ? { ...r, [field.k]: to || '' } : r
  })
  const wearing = (field, gone) => items.filter((r) => {
    const v = r[field.k], has = goneHas(field, gone)
    return Array.isArray(v) ? v.some(has) : has(v)
  })
  // Every tag in use, wherever this tab reaches.
  const tagNames = (c) => uniqueTags([...classRows(def, doc, c, extra).map((r) => r.name),
    ...tagSources.filter((s) => c.shared || s.svc === PORTAL_SERVICE.name).flatMap((s) => Object.keys(s.tags || {}))])
  /** Several renames in turn, through the same door a rename from elsewhere
   *  comes in by: each service's own /api/tags/rename, this one's included. */
  const renameTags = async (c, moves) => {
    const bad = []
    forgetTagSources()
    for (const { from, to } of moves) {
      const here = await renameTagHere([from], to)
      if (here) bad.push(`${PORTAL_SERVICE.name} (${here})`)
      if (c.shared && PROJECT_LINKED) {
        const res = await renameTagEverywhere([from], to, { skip: PORTAL_SERVICE.name, wearing: true })
        bad.push(...res.filter((r) => r.error).map((r) => `${r.label} (${r.error})`))
      }
    }
    forgetTagSources()
    setTagAgain((n) => n + 1)
    await reload()
    setNote(bad.length ? tr('rk_rename_failed_in', bad.join(' · ')) : tr('rk_moved_n', moves.length))
    return !bad.length
  }

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
    if (etab.kind === 'frame') return <RackFrame key={etab.src} src={etab.src} label={etab.label} />
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
          canDelete={IS_ADMIN} onCancel={() => panes.close(etab.id)} guard={(fn) => panes.guard(etab.id, fn)}
          onClone={(seed) => openItem(null, null, seed)} occ={etab.occ}
          onStep={(id, occ) => {
            const r = items.find((x) => idOf(x) === id)
            if (r) panes.step(etab.id, { id: `item:${id}`, kind: 'item', who: id, occ, label: labelOf(def, r) })
          }}
          actions={def.item.actions ? (f, setF) => def.item.actions(f, setF, ctx) : itemButtons(def, ctx, doc)}
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
            // A shared tag is merged in every other service too.
            if (c.shared && PROJECT_LINKED) {
              const res = await renameTagEverywhere(gone, to, { skip: PORTAL_SERVICE.name })
              const bad = res.filter((r) => r.error).map((r) => `${r.label} (${r.error})`)
              if (bad.length) setNote(tr('rk_rename_failed_in', bad.join(' · ')))
              setTagAgain((n) => n + 1)
            }
            if (await commit({ [def.item.key]: foldNames(field, gone, to) },
              tr("rk_merged_into_one_n", field.label || c.noun, gone.length + 1, to, users.length, def.unit))) {
              panes.close(etab.id); merge.off()
            }
          }}
          onCancel={() => panes.close(etab.id)} />
      )
    }
    if (etab.kind === 'move') {
      const c = def.classes.find((x) => x.k === etab.of)
      if (!c) return null
      return (
        <RackMoveTags names={etab.names || []} all={tagNames(c)}
          scope={tr(c.shared && PROJECT_LINKED ? 'rk_move_everywhere' : 'rk_move_here')}
          onMove={async (moves) => { if (await renameTags(c, moves)) { panes.close(etab.id); merge.off() } }}
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
            ctx={ctx} onSave={commit} onCancel={() => panes.close(etab.id)} guard={(fn) => panes.guard(etab.id, fn)}
            actions={c.actions ? (f, setF) => c.actions(f, setF, { ...ctx, doc, rec, close: (then) => {
              // `then`: the editor to show instead, if it is open too.
              panes.close(etab.id)
              const t = panes.tabs.find((x) => x.id === then)
              if (t) panes.open(t)
            } }) : undefined}
            // A list is its maker's to delete, or a manager's.
            canDelete={IS_ADMIN || (!!c.list?.owner && !!rec && rec[c.list.owner] === ME)}
            onCreated={(r) => { panes.close(etab.id); openClass(c, r) }}
            onDeleted={() => panes.close(etab.id)} />
        )
      }
      const field = wornBy(def, c)
      const names = classRows(def, doc, c, extra).map((r) => r.name)
      // A tag with others inside it: they follow a rename, and it is not deleted.
      const hasKids = (g) => caseFree(field) && tagNames(c).some((n) => tagKey(n) !== tagKey(g) && tagWithin(n, g))
      return (
        <RackEditClass name={etab.who} noun={c.noun} wears={tr("rk_x_using", def.item.noun)} unit={def.unit}
          exists={names} wearing={(gone) => (caseFree(field) ? items.filter((r) => gone.some((g) => wears(r, field, g))) : wearing(field, gone))
            .map((r) => ({ id: idOf(r), label: labelOf(def, r) }))}
          onOpen={openItem}
          onSave={async (gone, to, said) => {
            if (gone.some(hasKids)) {
              if (gone.some((g) => tagKey(g) !== tagKey(to) && tagWithin(to, g))) { setNote(tr('rk_move_inside')); return }
              if (await renameTags(c, tagRenames(tagNames(c), gone, to))) panes.close(etab.id)
              return
            }
            // A shared tag is renamed (or merged) in every other service too.
            if (c.shared && PROJECT_LINKED) {
              const res = await renameTagEverywhere(gone, to, { skip: PORTAL_SERVICE.name })
              const bad = res.filter((r) => r.error).map((r) => `${r.label} (${r.error})`)
              if (bad.length) setNote(tr('rk_rename_failed_in', bad.join(' · ')))
              setTagAgain((n) => n + 1)
            }
            if (await commit({ [def.item.key]: foldNames(field, gone, to) }, said)) panes.close(etab.id)
          }}
          onCancel={() => panes.close(etab.id)}
          onDelete={IS_ADMIN && !hasKids(etab.who) ? async () => {
            // A shared tag goes from every other service too (an empty new name).
            if (c.shared && PROJECT_LINKED) {
              const res = await renameTagEverywhere([etab.who], '', { skip: PORTAL_SERVICE.name })
              const bad = res.filter((r) => r.error).map((r) => `${r.label} (${r.error})`)
              if (bad.length) setNote(tr('rk_rename_failed_in', bad.join(' · ')))
              setTagAgain((n) => n + 1)
            }
            if (await commit({ [def.item.key]: foldNames(field, [etab.who], '') },
              tr("rk_removed_name", etab.who)) || c.shared) panes.close(etab.id)
          } : null}>
          {/* A shared tag: what wears it in the other services, each opening in a pane here. */}
          {c.shared && <RackTagged names={[etab.who]} skip={PORTAL_SERVICE.name} onOpen={openRecord} />}
        </RackEditClass>
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
      ...Object.fromEntries(perCols.map((p) => [p.k, r.per?.[p.k] || D])),
      fav: <RackStar on={isFavTag(r.name)} onToggle={() => toggleFavTag(r.name)} />,
    }
  }

  const beforeSettings = useRef(null)
  const setMenu = menuState.setOpen
  const frameRef = useRef(null)
  // A frame tab (another service's list) has that page's own ⋯ and find: this
  // bar's open its menu and search its list, by message.
  const toFrame = (msg) => frameRef.current?.contentWindow?.postMessage(msg, window.location.origin)
  const [frameFind, setFrameFind] = useState('')
  useEffect(() => { if (BARE) setMenu(false); setFrameFind('') }, [L.active])
  // …and closes it as this page's own would: Esc.
  useEffect(() => {
    if (tab?.kind !== 'frame') return undefined
    const off = (e) => { if (e.key === 'Escape') toFrame({ rackMenu: 'close' }) }
    document.addEventListener('keydown', off)
    return () => document.removeEventListener('keydown', off)
  }, [tab?.kind])
  useEffect(() => {
    if (!BARE) return undefined
    const take = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.rackMenu) setMenu((m) => (e.data.rackMenu === 'close' ? false : !m))
      if (typeof e.data?.rackFind === 'string') setQuery(e.data.rackFind)
    }
    window.addEventListener('message', take)
    return () => window.removeEventListener('message', take)
  }, [])

  const barBox = useRef(null)
  const barTabs = tabs.filter((t) => t.id !== 'settings')
  const spread = useTabSpread(barBox, barTabs.length, L.active, !BARE)
  // Settings is still a tab, drawn on the bar or in the menu instead of among the
  // lists. An editor filling the page would hide it, so that steps aside. Pressed
  // again, back to where you were, editor and all.
  const hasSettings = FIXED.some((t) => t.id === 'settings')
  const toggleSettings = () => {
    if (L.active === 'settings') {
      L.setActive(beforeSettings.current?.tab || FIRST)
      if (beforeSettings.current?.hid) panes.setHidden(false)
    } else {
      beforeSettings.current = { tab: L.active, hid: !showList }
      L.setActive('settings')
      if (!showList) panes.setHidden(true)
    }
  }
  // Where the tab being shown stands in the strip, for the two buttons that
  // walk it (−1 when the list has no tab of its own to be on).
  const tabAt = tabs.findIndex((t) => t.id === tab?.id)
  // A frame tab's menu is the page inside it, so this column stays out of the way;
  // the calendar has a column of its own, and its menu is shut and faint there.
  const noMenu = tab?.kind === 'calendar'
  const railOpen = menuState.open && tab?.kind !== 'frame' && !noMenu

  // What this tab can do, in the column the menu opens: a section per kind of
  // thing — making, the selection, merging, what is shown. +new stands on the
  // title bar, right of the menu, until the column opens and takes it; a bare
  // page has no bar, so always in its menu.
  const newButton = (
    <button type="button" className="rl-btn rl-new" title={tr("rk_add_new_x", cls?.stored ? cls.noun : def.item.noun)}
      onClick={() => (cls?.stored ? openClass(cls, null) : openItem(null))}>+new</button>
  )
  const menuRows = (
    <>
      <MenuRow title={tr("rk_menu_make")}>
        {newButton}
        {slots.commands?.(api)}
      </MenuRow>
      {/* Faint with nothing picked, not gone: what is below them stays put as rows are picked. */}
      <MenuRow title={tr("rk_menu_pick")}>
        {tab?.kind === 'items' && (
          <button type="button" className="rl-btn" title={tr("rk_bulk_edit_hint")} disabled={picked.size < 2}
            onClick={openMany}>{tr("rk_bulk_edit_n", picked.size)}</button>
        )}
        {/* The other reading of "open what I picked": not one form over all of
            them (above) but each in a tab of its own, to go through one by one.
            ponytail: no ceiling — 40 picked rows is 40 editors, and the tab
            strip is what says so. Put one in if anyone ever does it twice. */}
        {tab?.kind === 'items' && (
          <button type="button" className="rl-btn" title={tr("rk_open_each_hint")} disabled={!picked.size}
            onClick={() => chosen.forEach((r) => openItem(idOf(r), r))}>{tr("rk_open_each_n", picked.size)}</button>
        )}
        {tab?.kind === 'items' && listClasses.map((c) => (
          <select key={c.k} className="rl-btn rl-pick" value="" disabled={!picked.size}
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
        {inList && (
          <button type="button" className="rl-btn" disabled={!picked.size} title={tr("rk_remove_from_this_hint", inList.label)}
            onClick={() => takeOutOfList(inList, tab.key)}>{tr("rk_remove_from_x_n", inList.label, picked.size)}</button>
        )}
        {slots.pick?.(api)}
      </MenuRow>
      <MenuRow title={tr("rk_menu_merge")}>
        {mergeable && (
          <RackMergeButtons merge={merge} noun={cls.stored ? cls.noun : (clsField.label || cls.noun)}
            onOpen={(names) => openEdit({ id: `merge:${cls.k}`, kind: 'merge', of: cls.k, names,
              label: tr("rk_merge_n_x", cls.stored ? cls.noun : (clsField.label || cls.noun), names.length) })} />
        )}
        {mergeable && merge.mode && outline && (
          <button type="button" className="rl-btn" disabled={!merge.size}
            onClick={() => openEdit({ id: `move:${cls.k}`, kind: 'move', of: cls.k, names: merge.names, label: tr('rk_move_n_x', merge.size) })}>
            {tr('rk_move_n', merge.size)}</button>
        )}
        {/* `bundle`: the names picked, as a new item wearing them (a project of
            tags) — matching any of them, or (`bundle.match`, the item's field
            for it) all of them. */}
        {mergeable && merge.mode && cls.bundle && ['or', 'and'].map((m) => (
          <button key={m} type="button" className={`rl-btn${m === 'or' ? ' rl-go' : ''}`} disabled={!merge.size}
            onClick={() => {
              openItem(null, null, { [clsField.k]: merge.names,
                ...(cls.bundle.match ? { [cls.bundle.match]: m } : {}),
                ...(def.item.label === 'name' || !def.item.label ? { name: merge.names.join('_') } : {}) })
              merge.off()
            }}>
            {tr(m === 'or' ? 'rk_bundle_any_n' : 'rk_bundle_all_n', def.item.noun, merge.size)}</button>
        ))}
      </MenuRow>
      <MenuRow title={tr("rk_menu_show")}>
        {fNow && <span data-keep className="rl-menu-keep"><FilterBar f={fNow} /></span>}
        {tab?.kind === 'items' && (def.item.quick || []).map((q) => (
          <button key={q.id} type="button" data-keep className={`rl-btn${quick.includes(q.id) ? ' on' : ''}`} title={q.title}
            onClick={() => setQuick((xs) => (xs.includes(q.id) ? xs.filter((x) => x !== q.id) : [...xs, q.id]))}>{q.label}</button>
        ))}
        {!BARE && slots.keepTools?.(api)}
        {slots.show?.(api)}
      </MenuRow>
      {BARE ? (
        <MenuRow>
          {panes.tabs.length > 0 && (
            <button type="button" className="rl-btn" title={tr("rk_close_editors_hint")} onClick={() => panes.leaveAll()}>{tr("rk_close_editors_n", panes.tabs.length)}</button>
          )}
        </MenuRow>
      ) : (
        <>
          {/* What the title bar has while this column is shut. */}
          <MenuRow title={tr("rk_menu_tabs")}>
            {/* Along the strip without aiming at it: the tabs are small, and
                the one you want is usually the one beside the one you are on. */}
            <span className="rl-pair">
              <button type="button" data-keep className="rl-btn" title={tr("rk_tab_prev")}
                disabled={tabAt <= 0} onClick={() => L.setActive(tabs[tabAt - 1].id)}>‹</button>
              <button type="button" data-keep className="rl-btn" title={tr("rk_tab_next")}
                disabled={tabAt < 0 || tabAt >= tabs.length - 1} onClick={() => L.setActive(tabs[tabAt + 1].id)}>›</button>
            </span>
            <button type="button" data-spread className={`rl-btn${spread.all ? ' on' : ''}`} disabled={!spread.all && !spread.over}
              aria-expanded={spread.all} onClick={() => spread.setAll((a) => !a)}>{tr(spread.all ? "rk_tabs_one_row" : "rk_tabs_all")}</button>
            <button type="button" className="rl-btn" disabled={!L.opened} title={tr("rk_close_tabs_hint")} onClick={L.closeOpened}>{tr("rk_close_tabs")}</button>
            {panes.count > 0 && panes.hidden && (
              <button type="button" className="rl-btn on" title={tr("rk_show_editors", panes.count)} onClick={() => panes.setHidden(false)}>{tr("rk_hidden_editors", panes.count)}</button>
            )}
          </MenuRow>
          <MenuRow title={tr("rk_menu_service")}>
            <button type="button" className="rl-btn" title={tr("rk_reload_service")} onClick={() => window.location.reload()}>{tr("rk_reload")}</button>
            {hasSettings && (
              <button type="button" className={`rl-btn${L.active === 'settings' ? ' on' : ''}`} aria-pressed={L.active === 'settings'}
                onClick={toggleSettings}>{tr("rk_tab_settings")}</button>
            )}
          </MenuRow>
        </>
      )}
    </>
  )
  const menuButton = (
    <RackMenu m={railOpen ? menuState : { ...menuState, open: false }} label={tr("rk_menu")} count={tab?.kind === 'frame' ? 0 : picked.size}
      lit={!!(fNow?.mode || fNow?.on || quick.length || slots.keepOn)} off={noMenu}
      onToggle={tab?.kind === 'frame' ? () => toFrame({ rackMenu: 'toggle' }) : undefined}
      beside={tab?.kind !== 'frame' && newButton}>{menuRows}</RackMenu>
  )
  const findField = tab?.kind === 'frame' ? (
    <input type="search" className="rl-find" value={frameFind} placeholder={tr("rk_find_in_list")}
      onChange={(e) => { setFrameFind(e.target.value); toFrame({ rackFind: e.target.value }) }} />
  ) : (
    <input ref={findRef} type="search" className="rl-find"
      value={fNow?.mode ? fNow.find : query}
      placeholder={fNow?.mode ? tr("rk_find_value")
        : cls ? tr("rk_find_in_list") : (def.item.findHint || tr("rk_find_x", def.item.noun))}
      onChange={(e) => (fNow?.mode ? fNow.setFind : setQuery)(e.target.value)} />
  )

  // ⌘F while looking at an editor (the last press or focus was in it) finds in
  // THAT pane (panefind.jsx); anywhere else it is the list's search, at the foot.
  const [pfind, setPfind] = useState(null)        // { col, n }
  useEffect(() => {
    let at = null
    const mark = (e) => { at = e.target?.closest?.('.rl-epane') || null }
    const key = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f' || !at?.isConnected) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const col = at.dataset.col
      setPfind((f) => ({ col, n: (f?.n || 0) + 1 }))
    }
    window.addEventListener('mousedown', mark, true)
    window.addEventListener('focusin', mark, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', mark, true)
      window.removeEventListener('focusin', mark, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [])

  /** What a tab is called NOW: a record's own label, read from the list each
   *  time rather than kept from when the tab opened (RackPaneStrip). A record
   *  the list has not got — one not loaded, or a frame, a file, a folder —
   *  keeps the label it was opened with. */
  const tabName = useCallback((t) => {
    if (t.kind === 'item' && t.who) {
      const r = (doc?.[def.item.key] || []).find((x) => idOf(x) === t.who)
      if (r) return labelOf(def, r)
    }
    if (t.kind === 'class' && t.stored && t.who) {
      const c = (def.classes || []).find((x) => x.k === t.of)
      const r = c && findStored(c, t.who)
      if (r) return rowLabel(c, r)
    }
    return ''
  }, [doc, def, idOf])   // eslint-disable-line react-hooks/exhaustive-deps

  // The editors: docked left of the list, right of it, or FULL (panes.jsx).
  const lay = paneLayout(panes, showList, showEdit)
  const ps = paneStyles(lay, split)
  const editorPane = (c, style) => {
    const etab = panes.current(c)
    return (
      <div key={c} className="rl-pane rl-epane" data-col={c} onMouseDown={() => { if (c !== FULL) panes.setCol(c) }} style={showEdit ? style : { display: 'none' }}>
        <RackPaneStrip panes={panes} col={c} name={tabName} />
        {pfind?.col === String(c) && <PaneFind again={pfind.n} onClose={() => setPfind(null)} />}
        {etab && editorFor(etab)}
      </div>
    )
  }

  return (
    <div className="rl" style={brandStyle()}>
      <section className={`rl-mod${BARE ? '' : ' rl-mod-rail'}`}>
        {!BARE && <RackBar box={barBox} spread={spread} menu={menuButton} open={railOpen} tabCount={barTabs.length}
          onCloseTabs={L.closeOpened} canCloseTabs={L.opened > 0} beforeReload={slots.barTools?.(api)}
          tools={panes.count > 0 && panes.hidden && <RackPaneTools panes={panes} />}
          last={<>
            {hasSettings && (
              <button type="button" className={`rl-reload${L.active === 'settings' ? ' on' : ''}`} title={tr("rk_tab_settings")}
                aria-pressed={L.active === 'settings'} onClick={toggleSettings}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
                  <circle cx="8" cy="8" r="4.3" strokeWidth="1.3" /><circle cx="8" cy="8" r="1.5" strokeWidth="1.3" />
                  <path strokeWidth="1.7" d="M8 .8v2.9M8 12.3v2.9M.8 8h2.9M12.3 8h2.9M2.9 2.9 5 5M11 11l2.1 2.1M2.9 13.1 5 11M11 5l2.1-2.1" />
                </svg>
              </button>
            )}
          </>}
          tabs={<RackTabs tabs={barTabs} active={L.active} fixed={FIXED} onPick={L.setActive} onClose={closeTab} />} />}
        {BARE ? <RackMenu m={menuState} bare>{menuRows}</RackMenu> : <RackRail open={railOpen}>{menuRows}</RackRail>}

        <div className="rl-body">
          {doc && lay.left.map((c) => editorPane(c, ps.left))}
          {ps.before && <div {...ps.before} />}
          {showList && (<div className="rl-pane" style={ps.list}>

            {err && <p className="rl-msg">{err}</p>}
            {!err && !doc && <p className="rl-msg">{tr("rk_loading")}</p>}

            {doc && tab?.kind === 'items' && (
              <>
                <RackTable cols={cols} onDrag={drag('')} facet={filter.tableFacet} lit={filter.lit}
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
                        // `item.tagged`: a row opens what wears its tags (a project's
                        // own tab); the checkbox still picks it.
                        onClick={(e) => (def.item.tagged && !e.target.closest('.rl-chk') && !e.shiftKey
                          ? openTab({ id: `item-tagged:${rid}`, kind: 'tagged', item: rid, label: `+${labelOf(def, r)}` })
                          : hit(i, e.shiftKey))}
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
                facet={merge.mode ? null : clsFilter.tableFacet} lit={merge.mode ? null : clsFilter.lit}
                head={merge.mode ? merge.head(clsShown.map((r) => r.name)) : null}>
                <FacetRows f={clsFilter} labels={{ empty: tr("rk_column_empty") }} />
                {!clsFilter.mode && clsRowsNow.map((r, i) => {
                  const on = merge.mode && merge.has(r.name)
                  return (
                    <RackRow key={r.id || r.key || r.name} cols={merge.mode ? mergeCols : clsCols} tone={tone} mark={query.trim()}
                      className={`rl-hit${on ? ' on' : ''}`}
                      // A class nothing wears (`count: false`: an inbox) has no list of
                      // items to open; its row is opened by the right click alone.
                      onClick={() => (merge.mode ? merge.toggle(r.name)
                        : cls.count === false ? undefined
                          // A shared tag: everything wearing it, in every service.
                          : cls.shared ? openTab({ id: `tagged:${r.key || r.name}`, kind: 'tagged', names: [r.name], label: `#${r.name}` })
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
                        ...(clsNested ? { name: (
                          <span className="rl-tree" style={{ paddingLeft: r.depth * 14 }}>
                            {r.kids > 0 ? (
                              <button type="button" className="rl-fold" title={tr('rk_fold')} aria-expanded={r.open}
                                onClick={(e) => { e.stopPropagation(); tagFold(r.key) }}>
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={r.open ? 'M4 7h16l-8 12z' : 'M7 4l12 8-12 8z'} /></svg>
                              </button>
                            ) : <span className="rl-fold" />}
                            {r.name}
                          </span>
                        ) } : {}),
                      }} />
                  )
                })}
                {!clsFilter.mode && clsShown.length === 0 && <p className="rl-msg">{tr(classes.length ? "rk_none" : "rk_none_yet")}</p>}
              </RackTable>
            )}

            {doc && tab?.kind === 'calendar' && (
              <RackCalendar def={def} doc={doc} ctx={ctx} picked={picked} at={calAt}
                // The records an editor is showing now: their bars outlined.
                editing={new Set(panes.showing ? panes.cols.map((c) => panes.current(c)).filter((t) => t?.kind === 'item' && t.who).map((t) => t.who) : [])}
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
                  if (how === 'all') { openItem(idOf(rec), rec, undefined, occ); return }
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
                  // The rest of the series stays in the flow the first part is in.
                  const ck = chainKey(def), { flow } = flowFor(def, all, rec)
                  const r = made({ [R]: { rule: newRule, ex: (rp.ex || []).filter((d) => d >= occ) }, ...(ck ? { [ck]: flow } : {}) })
                  const next = all.map((x) => {
                    if (x === rec) return { ...x, [R]: { rule: oldRule, ex: (rp.ex || []).filter((d) => d < occ) }, ...(ck ? { [ck]: flow } : {}), updatedAt: now }
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
                  // The copy goes in its source's flow — the source too, if it was in none.
                  const all = doc[def.item.key] || [], ck = chainKey(def), { flow, mark } = flowFor(def, all, rec)
                  if (ck) r[ck] = flow
                  const patch = { [def.item.key]: [r, ...(mark ? all.map((x) => (x === rec ? { ...x, [ck]: flow, updatedAt: now } : x)) : all)] }
                  Object.assign(patch, def.item.onSave?.(r, null, { ...doc, ...patch }) || {})
                  return commit(patch, tr("rk_copied_x", labelOf(def, r)))
                }} />
            )}

            {tab?.kind === 'frame' && <RackFrame key={tab.src} src={tab.src} label={tab.label} hold={frameRef} />}
            {doc && tab?.kind === 'trash' && <RackTrash def={def} reload={reload} say={setNote} cols={L.colsOf('x:', TRASH_COLS)} onDrag={drag('x:')} />}
            {doc && tab?.kind === 'tagged' && (
              <RackTaggedTab rows={tgShown} cols={L.colsOf('t:', TAGGED_COLS)} onDrag={drag('t:')} onOpen={openRecord}
                // A group's authors: that service's own list of it, as a tab here.
                onList={({ svc, proj, tab: at, label }) => serviceColor(svc).then((color) => openTab({ id: `frame:${svc}:${at}`,
                  kind: 'frame', label, color, src: `/pp/${svc}/${proj}/?bare=1#open=${encodeURIComponent(`tab:${at}`)}` }))}
                sort={tgSort} onSort={(k) => setTgSort((s2) => bumpSort(s2, k))} filter={tgFilter} mark={query.trim()} />
            )}

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
            {doc && tab?.kind === 'view' && slots.views?.[tab.view]?.(tab, api)}
          </div>)}

          {ps.after && <div {...ps.after} />}
          {doc && lay.right.map((c) => editorPane(c, ps.right))}
        </div>

        <footer className="rl-foot">
          <span>{note || tr("rk_status_hint")}</span>
          <span className="rl-sp" />
          {/* What this project does and does not reach of the other services. */}
          {!PROJECT_LINKED && <span className="rl-hint" title={tr("rk_not_linked_hint", PORTAL_SERVICE.links?.[PORTAL_SERVICE.name])}>{tr("rk_not_linked")}</span>}
          {tagSources.some((s) => s.denied) && <span className="rl-hint rl-warn" title={tr("rk_tags_denied_hint")}>{tr("rk_tags_denied", tagSources.filter((s) => s.denied).map((s) => s.label).join(', '))}</span>}
          <span className="rl-mono">
            {cls ? (classes.length ? tr("rk_n_rows", classes.length) : '') : (tab?.kind === 'items' && rows.length ? tr("rk_n_rows", rows.length) : '')}
          </span>
          {/* What was deleted, and the way back — a manager's, as deleting is.
              A tab of its own when opened, not one always in the strip. */}
          {/* The search, at the foot beside the bin: ⌘F finds it here. */}
          {!BARE && findField}
          {IS_ADMIN && def.trash !== false && (
            <button type="button" className={`rl-btn rl-foot-btn${tab?.kind === 'trash' ? ' on' : ''}`} title={tr("rk_trash_hint")}
              onClick={() => openTab({ id: 'trash', kind: 'trash', label: tr("rk_trash") })}>{tr("rk_trash")}</button>
          )}
        </footer>
      </section>
    </div>
  )
}
