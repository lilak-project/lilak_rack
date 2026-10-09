import { useCallback, useEffect, useMemo, useState } from 'react'
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
export function RackMergeButtons({ merge, noun = '태그', onOpen }) {
  return (
    <>
      <button type="button" className={`rl-btn rl-tabonly${merge.mode ? ' on' : ''}`}
        title={`${noun} 여러 개를 골라 하나로 합칩니다`} onClick={merge.turn}>
        {merge.mode ? '합치기 모드 끄기' : '합치기 모드'}
      </button>
      {merge.mode && (
        <button type="button" className="rl-btn rl-go" disabled={merge.size < 2}
          onClick={() => onOpen(merge.names)}>합치기 ({merge.size})</button>
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
  names = [], noun = '태그', count = () => 0, exists = [],
  users = [], moved = [], movedWhy = '이름이 바뀌므로 다시 만들어야 합니다',
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
        <RackActions saveLabel="닫기" onSave={onCancel} />
        <p className="rl-msg">합칠 {subj(noun)} 남아 있지 않습니다.</p>
      </div>
    )
  }
  return (
    <div className="rl-edit">
      <RackActions key={live.join('\u0000')} saveLabel="합치기"
        onSave={async () => {
          if (!named || !gone.length || busy) return
          setBusy(true)
          try { await onMerge(gone, named) } finally { setBusy(false) }
        }}
        saveDisabled={busy || !named || !gone.length} onCancel={onCancel}
        hint={`${live.length}개 → 1개 · ${users.length}개 기록`} />
      <div className="rl-rec">
        <RackField label={`남길 ${noun}`}>
          <div className="rl-rows">
            {live.map((t) => (
              <label key={t} className={`rl-rrow rl-hit${t === named ? ' on' : ''}`}>
                <input type="radio" name="rl-merge-keep" checked={t === named}
                  onChange={() => setTo(t)} />
                <span className={t === named ? '' : 'rl-gone'}>{t}</span>
                <span className="rl-hint">{count(t)}개</span>
                <span className="rl-sp" />
                {/* What goes is the name. Saying "없어집니다" beside a count of
                    records reads as though the records go with it. */}
                <span className="rl-hint">{t === named
                  ? `남습니다 · 합친 뒤 ${users.length}개`
                  : `이 ${noun}만 떼어집니다`}</span>
              </label>
            ))}
          </div>
        </RackField>
        <RackField label="이름">
          <input className="rl-in" style={{ width: 260 }} value={to || ''}
            onChange={(e) => setTo(e.target.value)} />
          <button type="button" className="rl-btn" disabled={to === best}
            onClick={() => setTo(best)}>← 고른 것으로</button>
          {fresh && (
            <span className="rl-hint">
              새 이름입니다 — 고른 {live.length}개가 모두 이것이 됩니다.
            </span>
          )}
        </RackField>
        <RackField label={`없어지는 ${noun}`}>
          <div className="rl-rrow">
            {gone.length === 0 && <span className="rl-hint">없음</span>}
            {gone.map((t) => <span key={t} className="rl-tag rl-gone">{t}</span>)}
          </div>
        </RackField>
        <RackField label="영향">
          <div className="rl-rows">
            <span className="rl-hint">
              {users.length}개 기록의 {subj(noun)} 바뀝니다 — 기록이 지워지지는 않습니다.
            </span>
            {hurt.length > 0 && (
              <span className="rl-hint">
                그중 {hurt.length}개는 {movedWhy} — {hurt.slice(0, 6).join(', ')}
                {hurt.length > 6 ? ' …' : ''}
              </span>
            )}
          </div>
        </RackField>
        <RackField label="쓰는 기록">
          <div className="rl-rows">
            {users.length === 0 && <span className="rl-hint">없음</span>}
            {users.slice(0, 12).map((u) => <span key={u} className="rl-hint">{u}</span>)}
            {users.length > 12 && <span className="rl-hint">… 모두 {users.length}개</span>}
          </div>
        </RackField>
      </div>
    </div>
  )
}
