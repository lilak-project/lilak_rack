import { useCallback, useEffect, useMemo, useState } from 'react'
import './strings.js'
import { tr, currentLang } from '../i18n.jsx'
import { RackActions } from './actions.jsx'
import { RackField } from './fields.jsx'

/**
 * Folding several names into one.
 *
 * Every rack-list service keeps a list of free names that records point at —
 * tags on a paper, groups and affiliations on a person — and every one of them
 * drifts: SpiRIT, SpiRIT TPC, SpiRITROOT. Tidying it means saying which
 * spelling survives and which disappear, which is the same question whatever
 * the names stand for, so the picking and the panel live here. What a name
 * MEANS is the service's: it supplies the counts and does the fold.
 *
 *   const merge = useMergeMode(onTagsTab)
 *   …a chk column while merge.mode, rows call merge.toggle(name)…
 *   <RackMerge names={tab.names} noun="태그"
 *     count={(t) => papersWith(t).length} users={labelsOf(picked)}
 *     exists={allTags} onMerge={(gone, to) => save(fold(gone, to))} />
 */
/** '태그가' but '그룹이': the particle depends on whether the word ends in a
 *  consonant, and getting it wrong is the first thing a reader notices. */
const subj = (w) => {
  if (currentLang() !== 'ko') return String(w || '')   // other languages carry no particle
  const c = String(w || '').trim().slice(-1).charCodeAt(0)
  const batchim = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0
  return `${w}${batchim ? '이' : '가'}`
}

export function useMergeMode(active) {
  const [mode, setMode] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  // Leaving the list that was being merged leaves the mode behind with it.
  useEffect(() => { if (!active) { setMode(false); setPicked(new Set()) } }, [active])
  const toggle = useCallback((name) => setPicked((s) => {
    const n = new Set(s)
    if (n.has(name)) n.delete(name); else n.add(name)
    return n
  }), [])
  const clear = useCallback(() => setPicked(new Set()), [])
  const off = useCallback(() => { setMode(false); setPicked(new Set()) }, [])
  return {
    mode, picked, toggle, clear, off,
    names: useMemo(() => [...picked], [picked]),
    size: picked.size,
    has: useCallback((n) => picked.has(n), [picked]),
    turn: useCallback(() => { setMode((m) => !m); setPicked(new Set()) }, []),
    /** the head checkbox for a list of names */
    head: (all) => ({
      all: all.length > 0 && all.every((n) => picked.has(n)),
      some: all.some((n) => picked.has(n)),
      onAll: () => setPicked((s) => (all.every((n) => s.has(n)) ? new Set() : new Set(all))),
    }),
  }
}

/** The two buttons the mode needs, for the service's command bar. */
export function RackMergeButtons({ merge, noun = tr("rk_tag"), onOpen }) {
  return (
    <>
      <button type="button" className={`rl-btn rl-tabonly${merge.mode ? ' on' : ''}`}
        title={tr("rk_merge_pick_hint", noun)} onClick={merge.turn}>
        {merge.mode ? tr("rk_merge_mode_off") : tr("rk_merge_mode")}
      </button>
      {merge.mode && (
        <button type="button" className="rl-btn rl-go" disabled={merge.size < 2}
          onClick={() => onOpen(merge.names)}>{tr("rk_merge_n", merge.size)}</button>
      )}
    </>
  )
}

/**
 * The panel: which name survives, which go, and what it costs.
 *
 * `users` and `moved` are labels the service worked out — the records that
 * change, and the ones whose MAIN name is among those going, which is the part
 * that bites because a key is usually filed under it.
 */
export function RackMerge({
  names = [], noun = tr("rk_tag"), count = () => 0, exists = [],
  users = [], moved = [], movedWhy = tr("rk_renamed_must_rebuild"),
  onMerge, onCancel,
}) {
  const live = useMemo(() => names.filter((n) => exists.includes(n)), [names, exists])
  const best = useMemo(() => [...live].sort((a, b) => count(b) - count(a))[0] || '',
    [live, count])
  const [to, setTo] = useState(best)
  useEffect(() => { setTo(best) }, [best])

  const named = String(to || '').trim()
  const gone = live.filter((t) => t !== named)
  // Which records are hurt depends on which name survives, so the service may
  // answer that as a function of it rather than as a list fixed in advance.
  const hurt = typeof moved === 'function' ? moved(named) : moved
  const fresh = named && !exists.includes(named)
  const [busy, setBusy] = useState(false)

  if (live.length < 2) {
    return (
      <div className="rl-edit">
        <RackActions saveLabel={tr("rk_close")} onSave={onCancel} />
        <p className="rl-msg">{tr("rk_nothing_left_to_merge", subj(noun))}</p>
      </div>
    )
  }
  return (
    <div className="rl-edit">
      <RackActions key={live.join('\u0000')} saveLabel={tr("rk_merge")}
        onSave={async () => {
          if (!named || !gone.length || busy) return
          setBusy(true)
          try { await onMerge(gone, named) } finally { setBusy(false) }
        }}
        saveDisabled={busy || !named || !gone.length} onCancel={onCancel}
        hint={tr("rk_merge_summary", live.length, users.length)} />
      <div className="rl-rec">
        <RackField label={tr("rk_keep_which", noun)}>
          <div className="rl-rows">
            {live.map((t) => (
              <label key={t} className={`rl-rrow rl-hit${t === named ? ' on' : ''}`}>
                <input type="radio" name="rl-merge-keep" checked={t === named}
                  onChange={() => setTo(t)} />
                <span className={t === named ? '' : 'rl-gone'}>{t}</span>
                <span className="rl-hint">{tr("rk_n", count(t))}</span>
                <span className="rl-sp" />
                {/* What goes is the name. Saying "없어집니다" beside a count of
                    records reads as though the records go with it. */}
                <span className="rl-hint">{t === named
                  ? tr("rk_stays_after_merge", users.length)
                  : tr("rk_only_this_removed", noun)}</span>
              </label>
            ))}
          </div>
        </RackField>
        <RackField label={tr("rk_name")}>
          <input className="rl-in" style={{ width: 260 }} value={to || ''}
            onChange={(e) => setTo(e.target.value)} />
          <button type="button" className="rl-btn" disabled={to === best}
            onClick={() => setTo(best)}>{tr("rk_use_picked")}</button>
          {fresh && (
            <span className="rl-hint">{tr("rk_new_name_all_become", live.length)}</span>
          )}
        </RackField>
        <RackField label={tr("rk_going", noun)}>
          <div className="rl-rrow">
            {gone.length === 0 && <span className="rl-hint">{tr("rk_none")}</span>}
            {gone.map((t) => <span key={t} className="rl-tag rl-gone">{t}</span>)}
          </div>
        </RackField>
        <RackField label={tr("rk_impact")}>
          <div className="rl-rows">
            <span className="rl-hint">{tr("rk_records_change", users.length, subj(noun))}</span>
            {hurt.length > 0 && (
              <span className="rl-hint">{tr("rk_of_which", hurt.length, movedWhy, hurt.slice(0, 6).join(', '), hurt.length > 6 ? ' …' : '')}</span>
            )}
          </div>
        </RackField>
        <RackField label={tr("rk_records_using")}>
          <div className="rl-rows">
            {users.length === 0 && <span className="rl-hint">{tr("rk_none")}</span>}
            {users.slice(0, 12).map((u) => <span key={u} className="rl-hint">{u}</span>)}
            {users.length > 12 && <span className="rl-hint">{tr("rk_all_n", users.length)}</span>}
          </div>
        </RackField>
      </div>
    </div>
  )
}
