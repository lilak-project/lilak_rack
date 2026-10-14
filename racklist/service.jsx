import { useCallback, useEffect, useMemo, useState } from 'react'
import { RackTable, RackRow, RackTabs } from './table.jsx'
import { RackPaneStrip } from './panes.jsx'
import { RackEditClass } from './classedit.jsx'
import { FilterBar, FacetRows } from './filter.jsx'
import { RackListing } from './listing.jsx'
import { RackItemEditor } from './editor.jsx'
import { useMergeMode, RackMergeButtons, RackMerge } from './merge.jsx'
import { RackBulkEditor } from './bulk.jsx'
import { useRackList } from './list.js'
import { useRackKeys, useToggleKey } from './hooks.js'
import { typeOf } from './types.jsx'
import { useFolders, RackFolder, RackFilePane, RackSettings, hasRoots } from './files.jsx'
import { asSorts, bumpSort, bySome } from './sort.js'
import {
  defineRack, itemColumns, classColumns, itemSorters, itemCells, itemSearch, itemTokens,
  classRows, wornBy, wears, isRef, fixedTabs, itemTabId, itemScope, labelOf, useRemoteDocs, valueOf,
  EMPTY_CELL as D,
} from './schema.js'
import { PORTAL_PROJECT, brandStyle, isManager, portalUser, fetchDoc, putDoc, newId } from './portal.js'

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
 *   slots.editors                { kind: (tab, api) => node } — editor panes of its own;
 *                                open one with api.openEdit({ id, kind, label, … })
 *   registerType(name, type)     a field type of its own (types.jsx)
 *   field.cell / field.edit      one field drawn differently
 *
 * `api` is what those get: doc, commit(patch, said), openTab, openEdit,
 * setNote, the selection (picked, chosen) and the current tab. A field's
 * widget and cell get much the same through `ctx`.
 */
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

  const FIXED = useMemo(() => [
    ...fixedTabs(def),
    ...(slots.tabs || []).map((t) => ({ id: t.id, kind: 'slot', label: t.label })),
    // Where the service may read the disk is a manager's to say.
    ...(IS_ADMIN && hasRoots(def) ? [{ id: 'settings', kind: 'settings', label: 'settings' }] : []),
  ], [def, slots.tabs, IS_ADMIN])

  const extra = useMemo(() => ({ remote, folders }), [remote, folders])
  const itemSort = useMemo(() => itemSorters(def, doc, extra), [def, doc, extra])
  // A sorter may depend on the tab (a group's own core on that group's tab).
  const sortersFor = useCallback((t) => (t?.kind !== 'items' ? {}
    : def.item.tabbed ? itemSorters(def, doc, { ...extra, tab: t }) : itemSort), [def, doc, extra, itemSort])
  const scopeOf = useCallback((t, sort) => itemScope(def, doc, t, sort, sortersFor(t),
    def.item.tie?.(t, { def, doc, ...extra, tab: t })), [def, doc, extra, sortersFor])
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
    setNote(allPicked ? `${rows.length}${def.unit} 선택 해제` : `${rows.length}${def.unit} 선택`)
  })

  const items = doc?.[def.item.key] || []
  const cls = tab?.kind === 'classes' ? def.classes.find((c) => c.k === tab.of) : null
  // Names worn through a plain field (tags) can be folded into one another.
  const clsField = cls ? wornBy(def, cls) : null
  const mergeable = !!cls && ((!cls.stored && !!clsField && !isRef(clsField) && !typeOf(clsField).keys)
    || (cls.stored && !!cls.merge))
  const merge = useMergeMode(mergeable)

  useEffect(() => {
    if (!PORTAL_PROJECT) { setErr('이 앱은 LILAK 포털을 통해 열어야 합니다.'); return }
    fetchDoc().then(setDoc).catch((e) => setErr(String(e.message || e)))
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
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
        setNote('목록이 그 사이 바뀌어 새로 읽었습니다 — 저장을 한 번 더 눌러주세요.')
        return false
      }
      setDoc(r.doc)
      setNote(said || '저장했습니다.')
      return true
    } catch (e) { setNote(String(e.message || e)); return false }
  }, [doc, def, setNote])

  const openEdit = useCallback((t) => panes.open(t), [panes])
  // `rec` when the caller already has the record — right after creating one,
  // the document this closure sees does not have it yet, and the tab would be
  // named "새 …" for a record that has a name.
  const openItem = useCallback((id, rec) => {
    const r = rec || (doc?.[def.item.key] || []).find((x) => idOf(x) === id)
    openEdit({ id: `item:${id || 'new'}`, kind: 'item', who: id || null,
      label: r ? labelOf(def, r) : `새 ${def.item.noun}` })
  }, [doc, def, openEdit])
  const rowLabel = (c, rec) => (c.rowLabel ? c.rowLabel(rec) : rec?.name) || ''
  // A stored record is found by its id, or — one from before ids — by its key.
  const whoOf = (c, rec) => (rec ? rec.id || rec[c.keyBy] : null)
  const findStored = (c, who) => (doc?.[c.k] || []).find((r) => (r.id ? r.id === who : r[c.keyBy] === who))
  const openClass = useCallback((c, rec) => openEdit(c.stored
    ? { id: `class:${c.k}:${whoOf(c, rec) || 'new'}`, kind: 'class', of: c.k, stored: true, who: whoOf(c, rec),
      label: rec ? rowLabel(c, rec) : `새 ${c.noun}` }
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
  const ctx = useMemo(() => ({
    remote, folders, reloadFolders, openFolder, openFile, say: setNote, openItem,
    openClass: openClassByName, openTab, openEdit, commit, isAdmin: IS_ADMIN, tab,
  }), [remote, folders, reloadFolders, openFolder, openFile, setNote, openItem, openClassByName,
    openTab, openEdit, commit, IS_ADMIN, tab])
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
    setTimeout(() => openEdit({ id: 'many', kind: 'many', ids, label: `${ids.length}${def.unit} 한꺼번에` }), 0)
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
    if (await commit({ [c.k]: next }, `${add.length}${def.unit}을(를) '${name}' ${c.noun}에 넣었습니다.`)) {
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
    if (await commit({ [c.k]: next }, `${out.size}${def.unit}을(를) ${c.noun}에서 뺐습니다.`)) clearPicked()
  }
  // My lists first: they are the ones I am filling.
  const listsFor = (c) => [...(doc?.[c.k] || [])].sort((a, b) => (
    (c.list.owner ? (b[c.list.owner] === ME) - (a[c.list.owner] === ME) : 0)
    || String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))))

  function editorFor(etab) {
    if (slots.editors?.[etab.kind]) return slots.editors[etab.kind](etab, api)
    if (etab.kind === 'folder') return <RackFolder key={etab.who} name={etab.who} say={setNote} />
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
        <RackItemEditor def={def} doc={doc} rec={rec} ctx={ctx} onSave={commit}
          canDelete={IS_ADMIN} onCancel={() => panes.close(etab.id)}
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
        const live = (etab.names || []).filter((n) => rowsNow.some((r) => r.name === n))
        const users = items.filter((r) => live.some((n) => wears(r, field, n)))
        return (
          <RackMerge names={etab.names || []} noun={c.noun} exists={rowsNow.map((r) => r.name)}
            count={(t) => rowsNow.find((r) => r.name === t)?.count || 0}
            users={users.map((r) => labelOf(def, r))}
            onMerge={async (gone, to) => {
              if (await commit(c.merge(doc, gone, to),
                `${c.noun} ${gone.length + 1}개를 '${to}' 하나로 합쳤습니다 · ${users.length}${def.unit}`)) {
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
              `${field.label || c.noun} ${gone.length + 1}개를 '${to}' 하나로 합쳤습니다 · ${users.length}${def.unit}`)) {
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
          <RackItemEditor def={def} doc={doc} rec={rec} fields={c.fields} listKey={c.k} noun={c.noun} cls={c}
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
        <RackEditClass name={etab.who} noun={c.noun} wears={`쓰는 ${def.item.noun}`} unit={def.unit}
          exists={names} wearing={(gone) => wearing(field, gone).map((r) => ({ id: idOf(r), label: labelOf(def, r) }))}
          onOpen={openItem}
          onSave={async (gone, to, said) => {
            if (await commit({ [def.item.key]: foldNames(field, gone, to) }, said)) panes.close(etab.id)
          }}
          onCancel={() => panes.close(etab.id)}
          onDelete={IS_ADMIN ? async () => {
            if (await commit({ [def.item.key]: foldNames(field, [etab.who], '') },
              `'${etab.who}'를 뗐습니다.`)) panes.close(etab.id)
          } : null} />
      )
    }
    return <p className="rl-msg">이 편집창을 그릴 수 없습니다.</p>
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
        <header className="rl-bar">
          <b>{def.title}</b>
          <span className="rl-n">{doc ? `${items.length}${def.unit}` : ''}</span>
          <span className="rl-sp" />
          <span className="rl-n">{PORTAL_PROJECT}</span>
        </header>

        <div className="rl-cmd">
          {cls?.stored ? (
            /* Mustard: it is only here while a class tab is, and the colour is
               what says so. */
            <button type="button" className="rl-btn rl-tabonly" onClick={() => openClass(cls, null)}>
              + 새 {cls.noun}
            </button>
          ) : (
            <button type="button" className="rl-btn rl-go" onClick={() => openItem(null)}>
              + 새 {def.item.noun}
            </button>
          )}
          {mergeable && (
            <RackMergeButtons merge={merge} noun={cls.stored ? cls.noun : (clsField.label || cls.noun)}
              onOpen={(names) => openEdit({ id: `merge:${cls.k}`, kind: 'merge', of: cls.k, names,
                label: `${cls.stored ? cls.noun : (clsField.label || cls.noun)} ${names.length}개 합치기` })} />
          )}
          {slots.commands?.(api)}
          <button type="button" className="rl-btn" disabled={!picked.size} onClick={clearPicked}>clear</button>
          {picked.size > 0 && <span className="rl-n">{picked.size} 선택</span>}
          {tab?.kind === 'items' && picked.size > 1 && (
            <button type="button" className="rl-btn" title="고른 것들의 같은 칸을 한꺼번에 바꿉니다"
              onClick={openMany}>선택 편집 ({picked.size})</button>
          )}
          {tab?.kind === 'items' && picked.size > 0 && listClasses.map((c) => (
            <select key={c.k} className="rl-btn rl-pick" value=""
              onChange={(e) => e.target.value && putInList(c, e.target.value)}>
              <option value="">{c.noun}에 넣기…</option>
              <option value="+new">+ 새 {c.noun}</option>
              {listsFor(c).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || l.id.slice(0, 8)} ({(l[c.list.ids] || []).length}){c.list.owner && l[c.list.owner] && l[c.list.owner] !== ME ? ` · ${l[c.list.owner]}` : ''}
                </option>
              ))}
            </select>
          ))}
          {inList && (
            <button type="button" className="rl-btn rl-tabonly"
              onClick={() => { const l = findStored(inList, tab.key); if (l) openClass(inList, l) }}>{inList.noun} 편집</button>
          )}
          {inList && picked.size > 0 && (
            <button type="button" className="rl-btn" title={`이 ${inList.label}에서만 뺍니다 — 항목은 그대로입니다`}
              onClick={() => takeOutOfList(inList, tab.key)}>{inList.label}에서 빼기 ({picked.size})</button>
          )}
          <span className="rl-gap" />
          {L.opened > 0 && (
            <button type="button" className="rl-btn" title="열어둔 탭을 모두 닫습니다" onClick={L.closeOpened}>
              탭 닫기 ({L.opened})
            </button>
          )}
          {panes.tabs.length > 0 && (
            <button type="button" className="rl-btn" title="편집 패널의 탭을 모두 닫습니다" onClick={panes.closeAll}>
              편집 닫기 ({panes.tabs.length})
            </button>
          )}
          {tab?.kind === 'items' && <FilterBar f={filter} />}
          <span className="rl-sp" />
          <input ref={findRef} type="search" className="rl-find"
            value={filter.mode ? filter.find : query}
            placeholder={filter.mode ? '고를 값 찾기   (⌘F)'
              : cls ? '이 목록에서 찾기   (⌘F)' : (def.item.findHint || `${def.item.noun} 찾기   (⌘F)`)}
            onChange={(e) => (filter.mode ? filter.setFind : setQuery)(e.target.value)} />
        </div>

        <div className="rl-body">
          {showList && (<div className="rl-pane" style={showEdit ? split.leftStyle : undefined}>
            <RackTabs tabs={tabs} active={L.active} fixed={FIXED} onPick={L.setActive} onClose={closeTab} />

            {err && <p className="rl-msg">{err}</p>}
            {!err && !doc && <p className="rl-msg">읽는 중…</p>}

            {doc && tab?.kind === 'items' && (
              <>
                <RackTable cols={cols} onDrag={drag('')} facet={filter.tableFacet}
                  sort={order}
                  onSort={(k) => setSort((s2) => bumpSort(asSorts(s2).length ? s2 : def.item.order, k))}
                  head={filter.mode ? null : { all: allPicked, some: somePicked, onAll: toggleAll }}>
                  <FacetRows f={filter} labels={{ empty: '이 열에는 값이 없습니다.' }} />
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
                            aria-label={`${labelOf(def, r)} 선택`} />,
                          num: i + 1,
                          ...itemCells(def, doc, r, ctx),
                        }} />
                    )
                  })}
                  {!filter.mode && rows.length === 0 && (
                    <p className="rl-msg">{items.length ? `해당하는 ${def.item.noun}이(가) 없습니다.` : `아직 ${def.item.noun}이(가) 없습니다 — + 새 ${def.item.noun}`}</p>
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
                          aria-label={`${r.name} 선택`} /> } : {}),
                        ...classCells(r, i),
                      }} />
                  )
                })}
                {classes.length === 0 && <p className="rl-msg">아직 없습니다.</p>}
              </RackTable>
            )}

            {doc && tab?.kind === 'settings' && (
              <RackSettings def={def} doc={doc} folders={folders} onSave={commit} say={setNote}
                onReload={reloadFolders} onOpenFolder={openFolder} />
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
          <span>{note || '왼쪽 클릭으로 선택, shift로 범위, 오른쪽 클릭으로 편집.'}</span>
          <span className="rl-sp" />
          <span className="rl-mono">
            {cls ? (classes.length ? `${classes.length}줄` : '') : (tab?.kind === 'items' && rows.length ? `${rows.length}줄` : '')}
          </span>
        </footer>
      </section>
    </div>
  )
}
