import { useCallback, useEffect, useMemo, useState } from 'react'
import { RackTable, RackRow, RackTabs } from './table.jsx'
import { RackPaneStrip } from './panes.jsx'
import { RackEditClass } from './classedit.jsx'
import { FilterBar, FacetRows } from './filter.jsx'
import { RackListing } from './listing.jsx'
import { RackItemEditor } from './editor.jsx'
import { useRackList } from './list.js'
import { useRackKeys, useToggleKey } from './hooks.js'
import { typeOf } from './types.jsx'
import { bySome } from './sort.js'
import {
  defineRack, itemColumns, classColumns, itemSorters, itemCells, itemSearch, itemTokens,
  classRows, wornBy, wears, isRef, fixedTabs, itemScope, labelOf, useRemoteDocs, EMPTY_CELL as D,
} from './schema.js'
import { PORTAL_PROJECT, brandStyle, isManager, fetchDoc, putDoc } from './portal.js'

/**
 * <RackService def={…} /> — a whole rack-list service from its declaration.
 *
 *   타이틀 바     the service's name, how many, the project — in its own colour
 *   버튼 스페이스  + 새 항목, clear, the selection, 탭 닫기 · 편집 닫기, the filter, search
 *   탭 스페이스    every item · one tab per class · the tabs you opened
 *   [표]          the items (or a class's records), with [나열] under it
 *   [편집창]      beside it: an item, a class record, or a tag
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
 * setNote, the selection (picked, chosen) and the current tab.
 */
export function RackService({ def: declared, slots = {} }) {
  const def = useMemo(() => (declared.docKeys ? declared : defineRack(declared)), [declared])
  const [doc, setDoc] = useState(null)
  const [outOpen, setOutOpen] = useState(false)
  const remote = useRemoteDocs(def)
  const IS_ADMIN = useMemo(() => isManager(), [])

  const FIXED = useMemo(() => [
    ...fixedTabs(def),
    ...(slots.tabs || []).map((t) => ({ id: t.id, kind: 'slot', label: t.label })),
  ], [def, slots.tabs])

  const extra = useMemo(() => ({ remote }), [remote])
  const itemSort = useMemo(() => itemSorters(def, doc, extra), [def, doc, extra])
  const sortersFor = useCallback((t) => (t?.kind === 'items' ? itemSort : {}), [itemSort])
  const scopeOf = useCallback((t, sort) => itemScope(def, doc, t, sort, itemSort), [def, doc, itemSort])
  const search = useMemo(() => itemSearch(def, doc, extra), [def, doc, extra])
  const tokens = useMemo(() => itemTokens(def, doc, extra), [def, doc, extra])
  const allClassCols = useMemo(() => def.classes.flatMap((c) => classColumns(def, c)), [def])
  const colSets = useMemo(() => ({ '': itemColumns(def), 'c:': allClassCols }), [def, allClassCols])

  const L = useRackList({
    key: def.key, fixed: FIXED, firstTab: 'all', scopeOf, search,
    sorters: sortersFor, cols: colSets, clsSort: { k: 'count', dir: -1 },
  })
  const { tab, tabs, openTab, closeTab, rows, scope, filter, panes, split, findRef, drag } = L
  const { sort, setSort, clsSort, setClsSort, query, setQuery, note, setNote, err, setErr } = L
  const { picked, hit, all: allPicked, some: somePicked, toggleAll, clear: clearPicked, chosen } = L
  useToggleKey(toggleAll)

  const items = doc?.[def.item.key] || []
  const cls = tab?.kind === 'classes' ? def.classes.find((c) => c.k === tab.of) : null

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
        const f = wornBy(def, def.classes.find((c) => c.k === t.of) || {})
        return (f && items.some((r) => wears(r, f, t.key || t.name)))
          || (doc[t.of] || []).some((r) => r.name === t.name)
      }
      if (t.ids) return true
      return false
    })
    panes.keep((t) => {
      if (!t.who) return true
      if (t.kind === 'item') return items.some((r) => r.id === t.who)
      if (t.kind === 'class') return t.stored ? (doc[t.of] || []).some((r) => r.id === t.who) : true
      return true
    })
  }, [doc])   // eslint-disable-line react-hooks/exhaustive-deps

  /** Whole-document save, version-guarded: 409 means someone else got there
   *  first, and the answer is to read again rather than overwrite them. */
  const commit = useCallback(async (patch, said) => {
    if (!doc) return false
    try {
      const body = Object.fromEntries(def.docKeys.map((k) => [k, patch[k] ?? doc[k]]))
      const r = await putDoc(doc.version, body)
      if (r.conflict) { setNote('다른 사람이 먼저 저장했습니다 — 새로 읽어주세요.'); return false }
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
    const r = rec || (doc?.[def.item.key] || []).find((x) => x.id === id)
    openEdit({ id: `item:${id || 'new'}`, kind: 'item', who: id || null,
      label: r ? labelOf(def, r) : `새 ${def.item.noun}` })
  }, [doc, def, openEdit])
  const openClass = useCallback((c, rec) => openEdit(c.stored
    ? { id: `class:${c.k}:${rec?.id || 'new'}`, kind: 'class', of: c.k, stored: true, who: rec?.id || null,
      label: rec?.name || `새 ${c.label}` }
    : { id: `class:${c.k}:${rec.name}`, kind: 'class', of: c.k, stored: false, who: rec.name, label: rec.name }),
  [openEdit])

  useRackKeys({
    onNew: () => (cls?.stored ? openClass(cls, null) : openItem(null)),
    onClose: () => { const cur = panes.current(panes.cols[0]); if (cur) panes.close(cur.id) },
  })

  /** Open a stored class record by name — what a chip in the editor does, so a
   *  class without a tab of its own (tab: false) is still one press away. */
  const openClassByName = useCallback((of, name) => {
    const c = def.classes.find((x) => x.k === of)
    const rec = c?.stored && (doc?.[of] || []).find((r) => r.name === name)
    if (rec) openClass(c, rec)
  }, [def, doc, openClass])
  const ctx = useMemo(() => ({ remote, say: setNote, openItem, openClass: openClassByName }),
    [remote, setNote, openItem, openClassByName])
  const api = { def, doc, commit, openTab, openEdit, openItem, setNote, picked, chosen, tab, rows, scope }

  const cols = useMemo(() => L.colsOf(''), [L.colsOf])   // eslint-disable-line react-hooks/exhaustive-deps
  const clsCols = useMemo(() => (cls ? L.colsOf('c:', classColumns(def, cls)) : []), [L.colsOf, cls, def])   // eslint-disable-line react-hooks/exhaustive-deps
  const classes = useMemo(() => {
    if (!cls) return []
    const q = query.trim().toLowerCase()
    const all = classRows(def, doc, cls, extra)
      .filter((r) => !q || Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
    const get = clsSort.k === 'count' ? (r) => r.count : (r) => r[clsSort.k]
    return all.sort(bySome(get, clsSort.dir))
  }, [cls, def, doc, query, clsSort, extra])

  const showEdit = L.showEdit && !!doc
  const showList = !showEdit || L.showList
  const order = sort || def.item.order

  // ── a wearable class (tags): rename, merge or take it off every item ──────
  const foldNames = (field, gone, to) => items.map((r) => {
    const v = r[field.k]
    if (Array.isArray(v)) {
      if (!v.some((x) => gone.includes(x))) return r
      const next = []
      for (const x of v) { const y = gone.includes(x) ? to : x; if (y && !next.includes(y)) next.push(y) }
      return { ...r, [field.k]: next }
    }
    return gone.includes(v) ? { ...r, [field.k]: to || '' } : r
  })

  function editorFor(etab) {
    if (slots.editors?.[etab.kind]) return slots.editors[etab.kind](etab, api)
    if (etab.kind === 'item') {
      const rec = etab.who ? items.find((r) => r.id === etab.who) : null
      return (
        <RackItemEditor def={def} doc={doc} rec={rec} ctx={ctx} onSave={commit}
          canDelete={IS_ADMIN} onCancel={() => panes.close(etab.id)}
          onCreated={(r) => { panes.close(etab.id); openItem(r.id, r) }}
          onDeleted={() => panes.close(etab.id)} />
      )
    }
    if (etab.kind === 'class') {
      const c = def.classes.find((x) => x.k === etab.of)
      if (!c) return null
      if (c.stored) {
        const rec = etab.who ? (doc[c.k] || []).find((r) => r.id === etab.who) : null
        return (
          <RackItemEditor def={def} doc={doc} rec={rec} fields={c.fields} listKey={c.k} noun={c.label}
            ctx={ctx} onSave={commit} canDelete={IS_ADMIN} onCancel={() => panes.close(etab.id)}
            onCreated={(r) => { panes.close(etab.id); openClass(c, r) }}
            onDeleted={() => panes.close(etab.id)} />
        )
      }
      const field = wornBy(def, c)
      const names = classRows(def, doc, c, extra).map((r) => r.name)
      const wearing = (gone) => items.filter((r) => {
        const v = r[field.k]
        return Array.isArray(v) ? v.some((x) => gone.includes(x)) : gone.includes(v)
      }).map((r) => ({ id: r.id, label: labelOf(def, r) }))
      return (
        <RackEditClass name={etab.who} noun={c.label} wears={`쓰는 ${def.item.noun}`} unit={def.unit}
          exists={names} wearing={wearing} onOpen={openItem}
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
              + 새 {cls.label}
            </button>
          ) : (
            <button type="button" className="rl-btn rl-go" onClick={() => openItem(null)}>
              + 새 {def.item.noun}
            </button>
          )}
          {slots.commands?.(api)}
          <button type="button" className="rl-btn" disabled={!picked.size} onClick={clearPicked}>clear</button>
          {picked.size > 0 && <span className="rl-n">{picked.size} 선택</span>}
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
              : cls ? '이 목록에서 찾기   (⌘F)' : `${def.item.noun} 찾기   (⌘F)`}
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
                  onSort={(k) => setSort((s2) => {
                    const now = s2 || def.item.order
                    return now?.k === k ? { k, dir: -now.dir } : { k, dir: 1 }
                  })}
                  head={filter.mode ? null : { all: allPicked, some: somePicked, onAll: toggleAll }}>
                  <FacetRows f={filter} labels={{ empty: '이 열에는 값이 없습니다.' }} />
                  {!filter.mode && rows.map((r, i) => {
                    const on = picked.has(r.id)
                    const edited = panes.tabs.some((t) => t.kind === 'item' && t.who === r.id)
                    return (
                      <RackRow key={r.id || i} cols={cols}
                        className={`rl-hit${on ? ' on' : ''}${edited ? ' rl-edited' : ''}`}
                        onClick={(e) => hit(i, e.shiftKey)}
                        onContextMenu={(e) => { e.preventDefault(); openItem(r.id) }}
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
                {def.listing && (
                  <RackListing list={chosen.length ? chosen : scope} picked={chosen.length > 0}
                    tokens={tokens} presets={def.listing.presets} unit={def.unit}
                    say={setNote} open={outOpen} setOpen={setOutOpen} />
                )}
              </>
            )}

            {doc && cls && (
              <RackTable cols={clsCols} onDrag={drag('c:')} sort={clsSort}
                onSort={(k) => setClsSort((s2) => (s2.k === k ? { k, dir: -s2.dir } : { k, dir: 1 }))}>
                {classes.map((r, i) => (
                  <RackRow key={r.id || r.name} cols={clsCols} className="rl-hit"
                    onClick={() => openTab({ id: `${cls.k}:${r.key || r.name}`, kind: 'items', of: cls.k,
                      key: r.key || r.name, name: r.name, label: r.name })}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      // A class of links names people who live in another
                      // service: there is nothing here to rename them in.
                      if (!isRef(wornBy(def, cls))) openClass(cls, r)
                    }}
                    cell={{
                      num: i + 1,
                      // A class record's own columns are drawn by their types, as an item's are.
                      ...Object.fromEntries(cls.fields.filter((f) => f.col)
                        .map((f) => [f.k, typeOf(f).cell(r[f.k], { def, doc, field: f, ...ctx })])),
                      name: r.name || D,
                      count: r.count || D,
                    }} />
                ))}
                {classes.length === 0 && <p className="rl-msg">아직 없습니다.</p>}
              </RackTable>
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
          <span className="rl-mono">{tab?.kind === 'items' && rows.length ? `${rows.length}줄` : ''}</span>
        </footer>
      </section>
    </div>
  )
}
