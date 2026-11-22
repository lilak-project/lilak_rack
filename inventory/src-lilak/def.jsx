import './strings.js'
import { useEffect, useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import { portalUser } from 'racklist'
import { safeName, download, hwpx, byClass } from './transfer.jsx'
import { HIDEABLE, shows, canMove, canAdd, canPhoto } from './settings.jsx'
/**
 * asset manager — the declaration. The table, the tabs, the editors, the
 * selection and the lists are the kit's <RackService>; what is here is what
 * makes it about ASSETS: the fields, the photos, and what a list does to the
 * assets in it.
 *
 * The document is unchanged from before the move: assets known by their
 * 자산번호 (assetId — they carry no other id), and lists as `records` holding
 * assetIds. The tab and column keys are the old ones where they can be, so a
 * stored view and dragged widths carry over.
 */
const D = '·'
const day = (v) => String(v || '').slice(0, 10)

// What a list was made for. 반출 · 반입 · 연장 are the same act: the place on
// the list is written onto every asset in it.
const LIST_TYPES = [
  ['save', tr("as_lt_save")], ['update', tr("as_lt_update")], ['checkout', tr("as_lt_checkout")],
  ['checkin', tr("as_lt_checkin")], ['extension', tr("as_lt_extend")], ['request', tr("as_lt_request")], ['hide', tr("as_hide")],
]
const typeLabel = (t) => (LIST_TYPES.find(([k]) => k === t) || [, t || tr("as_lt_save")])[1]
/** The state of a list, said in one line: waiting, applied, or neither. */
const listState = (r) => (r?.pending ? tr("as_pending")
  : (r?.appliedAt ? tr("as_applied_at", String(r.appliedAt).slice(0, 10)) : ''))

// A 반출 · 반입 · 연장 list is also a request form: who asks, for how long, why.
// The keys are the old app's, which hwpx-export.js prints under its own Korean
// labels — the form is a Korean document whatever the screen's language.
// `place`: the list's location goes into the form under that key.
const FORMS = {
  checkout: { title: '반출신청', place: 'takeoutPlace', fields: ['takeoutPeriod', 'takeoutReason', 'domesticOrInternational'],
    need: ['takeoutPeriod', 'takeoutReason'] },
  checkin: { title: '반입신청', place: 'returnPlace', fields: ['returnDate', 'returnReason'], need: ['returnDate', 'returnReason'] },
  extension: { title: '연장신청', fields: ['extensionPeriod', 'extensionReason'], need: ['extensionPeriod', 'extensionReason'] },
}
const APPLICANT = ['applicantName', 'applicantOrg']
const isForm = (t) => (f) => (t ? [t] : Object.keys(FORMS)).includes(f.type)

// Who asked last time, kept in this browser for this account: the next form
// starts with it. (The old app did the same, under cens.profile.)
const profileKey = () => `am2.profile.${portalUser()?.email || 'local'}`
function readProfile() { try { return JSON.parse(localStorage.getItem(profileKey()) || '{}') } catch { return {} } }
function saveProfile(f) {
  try { localStorage.setItem(profileKey(), JSON.stringify({ applicantName: f.applicantName || '', applicantOrg: f.applicantOrg || '' })) } catch { /* private window */ }
}

/** The form of a request list, as HWPX: one file per 자산분류 (the office takes
 *  them apart that way) and a ZIP of all. Built on a press, then saved on
 *  another — a browser lets one press save one file, and building takes longer
 *  than a press lasts. Made from the form as it stands, saved or not. */
function RequestForm({ f, setF, ctx }) {
  const form = FORMS[f.type]
  const [out, setOut] = useState(null)               // null | 'busy' | { files, zip, zipName }
  // Who asked last time, into an empty form.
  useEffect(() => {
    if (!form || APPLICANT.some((k) => f[k])) return
    const p = readProfile()
    if (p.applicantName || p.applicantOrg) setF((s) => ({ ...s, ...p }))
  }, [f.type])                                       // eslint-disable-line react-hooks/exhaustive-deps
  // What was built is of the form as it was: a change to what it prints makes
  // it stale — not an autosave stamping the time (that lost the first press).
  const sig = JSON.stringify([f.name, f.type, f.location, f.assetIds,
    ...[...APPLICANT, ...(form?.fields || [])].map((k) => f[k])])
  useEffect(() => setOut(null), [sig])
  if (!form) return null

  async function build() {
    const missing = [...APPLICANT, ...form.need].filter((k) => !String(f[k] || '').trim())
    if (missing.length) { ctx.say?.(tr("as_form_missing", missing.map((k) => tr(`as_f_${k}`)).join(', '))); return }
    const byId = new Map((ctx.doc.assets || []).map((a) => [a.assetId, a]))
    const assets = (f.assetIds || []).map((id) => byId.get(id)).filter(Boolean)
    if (!assets.length) { ctx.say?.(tr("as_list_empty")); return }
    setOut('busy')
    try {
      const H = await hwpx()
      const fields = Object.fromEntries([...APPLICANT, ...form.fields].map((k) => [k, f[k] || '']))
      if (form.place) fields[form.place] = f.location || ''
      const files = []
      for (const [c, group] of byClass(assets)) {
        const blob = await H.build({
          version: 1, title: f.name || tr("as_list"), savedAt: new Date().toISOString(),
          printSettings: { fontSize: 12, rowStart: 1, orientation: 'portrait', viewMode: 'wide', description: 'hide', photos: 'show' },
          request: { type: f.type, fields: { ...fields, assetClass: c } },
          rows: group.map((a) => ({ assetNumber: a.assetId, assetName: a.name || '', assetDescription: a.description || '',
            numberPhoto: a.photo2 || '', wholePhoto: a.photo1 || '' })),
        }, form.title)
        files.push({ c, n: group.length, blob, name: `${safeName(f.name)}_${safeName(c)}.hwpx` })
      }
      const zip = H.makeZip(await Promise.all(files.map(async (x) => ({ name: x.name, data: new Uint8Array(await x.blob.arrayBuffer()) }))))
      saveProfile(f)
      setOut({ files, zip, zipName: `${safeName(f.name)}.zip` })
    } catch (e) {
      setOut(null)
      ctx.say?.(tr("as_hwpx_failed", e?.message || String(e)))
    }
  }

  if (out === 'busy') return <button type="button" className="rl-btn" disabled>{tr("as_hwpx_building")}</button>
  if (!out) return <button type="button" className="rl-btn rl-go" title={tr("as_hwpx_hint")} onClick={build}>{tr("as_hwpx_make")}</button>
  // One class: its file. More: the ZIP, and each on its own.
  if (out.files.length === 1) {
    const [x] = out.files
    return <button type="button" className="rl-btn rl-go" onClick={() => download(x.blob, x.name)}>{tr("as_hwpx_save")}</button>
  }
  return (
    <>
      <button type="button" className="rl-btn rl-go" onClick={() => download(out.zip, out.zipName)}>{tr("as_hwpx_zip", out.files.length)}</button>
      {out.files.map((x) => (
        <button key={x.c} type="button" className="rl-btn" onClick={() => download(x.blob, x.name)}>{tr("as_hwpx_one", x.c, x.n)}</button>
      ))}
    </>
  )
}

/** A place or a kind of asset as a RECORD — a name with a photo and a few
 *  words — that assets wear BY NAME (keyBy: 'name'): the data has always held
 *  the name, and the forms, the lists and asset manager (legacy) read it. A
 *  name in use with no record yet is still a row; opened, it becomes one.
 *  Renaming one renames it on the assets (the kit) and on the lists (here);
 *  deleting one leaves its name on them as text. Merging folds names into one. */
const classOf = (k, field, label, noun) => ({
  k, label, noun, keyBy: 'name', countLabel: tr("as_count_assets"),
  fill: (r) => ({ ...r, name: String(r.name || '').trim(), lastUpdate: new Date().toISOString() }),
  check: (r, doc, prev) => (!r.name ? tr("as_need_name")
    : (doc[k] || []).some((x) => x.name === r.name && x !== prev) ? tr("as_name_taken") : ''),
  // A list says where it goes by the same name.
  onSave: (r, prev, doc) => (field === 'location' && prev?.name && prev.name !== r.name
    ? { records: (doc.records || []).map((x) => (x.location === prev.name ? { ...x, location: r.name } : x)) } : {}),
  merge: (doc, gone, to) => {
    const drop = new Set(gone)
    const recs = doc[k] || []
    let kept = recs.filter((r) => !drop.has(r.name))
    // The one kept is the one named `to` — or, if it had no record, the first
    // one going, renamed: its photo and words are not thrown away.
    if (!kept.some((r) => r.name === to)) {
      const first = recs.find((r) => drop.has(r.name))
      if (first) kept = [...kept, { ...first, name: to }]
    }
    const now = new Date().toISOString()
    return {
      [k]: kept,
      assets: (doc.assets || []).map((a) => (drop.has(a[field]) ? { ...a, [field]: to, lastUpdate: now } : a)),
      ...(field === 'location'
        ? { records: (doc.records || []).map((r) => (drop.has(r.location) ? { ...r, location: to } : r)) } : {}),
    }
  },
  deleteWarn: (r, doc) => tr("as_class_delete_warn", (doc.assets || []).filter((a) => a[field] === r.name).length),
  fields: [
    { k: 'name', label: tr("as_class_name"), type: 'text', required: true, width: 360, col: { w: 320, min: 120 }, tone: 'ink' },
    { k: 'photo', label: tr("as_class_photo"), type: 'image', bulk: false, disabled: noPhoto },
    { k: 'description', label: tr("as_description"), type: 'longtext', rows: 2, col: { w: 220, min: 80, drop: 1000 }, tone: 'dim' },
    { k: 'memo', label: tr("as_memo"), type: 'longtext', rows: 2 },
  ],
})

// A field a manager may hide from the others (settings.jsx): out of the editor,
// and its column out of the table.
const hideable = (f) => (HIDEABLE.includes(f.k) ? { ...f, when: (r, x) => shows(x?.doc, f.k),
  ...(f.col ? { col: { ...f.col, when: (tab, x) => shows(x?.doc, f.k) } } : {}) } : f)
// A photo, unless a manager has said only managers change them.
const noPhoto = (r, x) => !canPhoto(x?.doc)

/** An asset's history: the lists it has been in, newest first — each opens. */
function InLists({ rec, ctx }) {
  const mine = (ctx.doc?.records || []).filter((r) => (r.assetIds || []).includes(rec?.assetId))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  if (!mine.length) return <span className="rl-hint">{tr("as_in_no_list")}</span>
  return (
    <div className="rl-rows">
      {mine.map((r) => (
        <span key={r.id} className="rl-rrow">
          <button type="button" className="rl-lnk" onClick={() => ctx.openClass?.('records', r.id)}>{r.name || tr("as_list")}</button>
          <span className="rl-hint">{[typeLabel(r.type), r.location, String(r.createdAt || '').slice(0, 10), listState(r)].filter(Boolean).join(' · ')}</span>
        </span>
      ))}
    </div>
  )
}

/** What a list can DO, beside being saved: the place written onto its assets,
 *  a manager's approval asked for, its assets hidden or shown. Nothing here
 *  deletes an asset — a list points at assets, it does not own them. */
function ListActions({ f, setF, ctx }) {
  const { doc, commit, isAdmin, say, rec } = ctx
  if (!rec) return null
  const ids = f.assetIds || []
  const place = String(f.location || '').trim()
  const putList = (next, said) => commit({ records: doc.records.map((r) => (r.id === rec.id ? next : r)) }, said)
  async function apply() {
    if (!place) { say?.(tr("as_set_location_first")); return }
    if (!ids.length) { say?.(tr("as_list_empty")); return }
    const now = new Date().toISOString()
    const seen = new Set(ids)
    await commit({
      records: doc.records.map((r) => (r.id === rec.id ? { ...f, assetIds: ids, appliedAt: now, pending: false } : r)),
      assets: doc.assets.map((a) => (seen.has(a.assetId)
        ? { ...a, location: place, lastUpdate: now, lastInOutDate: now } : a)),
    }, tr("as_moved_to", ids.length, place))
  }
  async function setHidden(hidden) {
    const seen = new Set(ids)
    await commit({ assets: doc.assets.map((a) => (seen.has(a.assetId) ? { ...a, hidden } : a)) },
      hidden ? tr("as_hidden_n", ids.length) : tr("as_unhidden_n", ids.length))
  }
  return (
    <>
      <RequestForm f={f} setF={setF} ctx={ctx} />
      {/* Moving is everyone's — unless a manager has said it waits for them. */}
      {canMove(doc) && (
        <button type="button" className="rl-btn rl-go" onClick={apply}
          title={tr("as_apply_location_hint")}>{tr("as_apply_location")}</button>
      )}
      {/* A non-manager asks instead of doing: the list waits for a manager. */}
      {!isAdmin && (
        <button type="button" className="rl-btn" onClick={() => putList(
          { ...f, assetIds: ids, type: f.type === 'request' ? f.type : 'request', pending: true }, tr("as_approval_requested"))}>{tr("as_request_approval")}</button>
      )}
      {isAdmin && rec.pending && <button type="button" className="rl-btn rl-go" onClick={apply}>{tr("as_approve")}</button>}
      {isAdmin && (
        <>
          <button type="button" className="rl-btn" onClick={() => setHidden(true)}>{tr("as_hide")}</button>
          <button type="button" className="rl-btn" onClick={() => setHidden(false)}>{tr("as_unhide")}</button>
        </>
      )}
      {listState(rec) && <span className="rl-hint">{listState(rec)}</span>}
    </>
  )
}

export default {
  name: 'inventory', title: tr("as_title"), unit: tr("as_unit"), key: 'am2',
  item: {
    key: 'assets', id: 'assetId', noun: tr("as_asset"), allLabel: tr('as_tab_assets'), tabId: 'assets',
    label: (a) => a.assetId || a.name || tr("as_asset"),
    order: { k: 'assetId', dir: 1 },
    findHint: tr("as_find_hint"),
    check: (a, doc, prev) => {
      const id = String(a.assetId || '').trim()
      if (!id) return tr("as_need_number")
      return (doc.assets || []).some((x) => x.assetId === id && x !== prev) ? tr("as_number_taken") : ''
    },
    // Every save says when the asset last changed.
    fill: (a) => ({ ...a, assetId: String(a.assetId || '').trim(), lastUpdate: new Date().toISOString() }),
    canAdd,
    fields: [
      // The sticker first, then the whole thing — photo2 and photo1, the names
      // the old app wrote and the data still uses.
      { k: 'photo2', label: tr("as_photo_sticker"), type: 'image', group: tr("as_photos"), bulk: false, disabled: noPhoto },
      { k: 'photo1', label: tr("as_photo_whole"), type: 'image', group: tr("as_photos"), bulk: false, disabled: noPhoto },
      { k: 'assetId', label: tr("as_number"), type: 'text', mono: true, width: 160, required: true,
        col: { w: 118, min: 70 } },
      { k: 'name', label: tr("as_name"), type: 'text', width: 320, col: { w: 250, min: 110 }, tone: 'ink' },
      // A location and a type are words other assets already use, offered as
      // you type — and, being shared, they can be set on many at once.
      { k: 'location', label: tr("as_location"), type: 'class', of: 'locations', col: { w: 150, min: 70 }, tone: 'dim' },
      { k: 'type', label: 'Type', type: 'class', of: 'types', col: { w: 120, min: 60, drop: 1180 }, tone: 'dim' },
      { k: 'assetClass', label: tr("as_category"), type: 'text', width: 200, col: { w: 120, min: 60, drop: 1100 }, tone: 'dim' },
      { k: 'accountHolder', label: tr("as_custodian"), type: 'text', width: 200, col: { w: 112, min: 60, drop: 1400 }, tone: 'dim' },
      { k: 'applicationName', label: tr("as_requested_item"), type: 'text', width: 320 },
      { k: 'spec', label: tr("as_spec"), type: 'text', width: 240 },
      { k: 'manufacturerProvider', label: tr("as_maker"), type: 'text', width: 240 },
      { k: 'acquisitionDate', label: tr("as_acquired"), type: 'text', width: 140 },
      { k: 'acquisitionPriceKrw', label: tr("as_price"), type: 'text', width: 140 },
      { k: 'description', label: tr("as_description"), type: 'longtext', rows: 2 },
      { k: 'memo', label: tr("as_memo"), type: 'longtext', rows: 2 },
      { k: 'upd', label: tr("as_last_change"), get: (a) => day(a.lastUpdate), col: { w: 96, min: 70, drop: 900 }, tone: 'dim' },
      // Where it has been: the lists that hold it (a helper, never stored).
      { k: 'inLists', label: tr("as_in_lists"), store: false, search: false, edit: (p) => <InLists rec={p.rec} ctx={p.ctx} /> },
    ].map(hideable),
  },
  // The lists, newest first.
  classSort: { k: 'at', dir: -1 },
  classes: [
    classOf('locations', 'location', tr("as_tab_locations"), tr("as_location")),
    classOf('types', 'type', tr("as_tab_types"), 'Type'),
    { k: 'records', label: tr('as_tab_lists'), noun: tr("as_list"), countLabel: tr("as_count"),
      list: { ids: 'assetIds', owner: 'user', show: (a) => [a.name, a.location].filter(Boolean).join(' · ') },
      rowLabel: (r) => r.name || tr("as_list"),
      actions: (f, setF, ctx) => <ListActions f={f} setF={setF} ctx={ctx} />,
      deleteWarn: () => tr("as_delete_list_warn"),
      fields: [
        { k: 'name', label: tr("as_list_name"), type: 'text', required: true, width: 280, col: { w: 230, min: 100 }, tone: 'ink' },
        { k: 'type', label: tr("as_list_type"), type: 'select', options: LIST_TYPES, default: 'save',
          col: { w: 96, min: 60 }, tone: 'dim', hint: tr("as_list_type_hint"),
          cell: (r) => typeLabel(r.type) + (r.pending ? tr("as_waiting_suffix") : '') },
        { k: 'location', label: tr("as_location"), type: 'class', placeholder: tr("as_destination"), col: { w: 150, min: 70 }, tone: 'dim' },
        // Where the assets were put, as a picture beside the list.
        { k: 'placePhoto', label: tr("as_place_photo"), type: 'image', bulk: false },
        // The request form, on a 반출 · 반입 · 연장 list only.
        { k: 'applicantName', label: tr("as_f_applicantName"), type: 'text', width: 160, group: tr("as_applicant"), when: isForm() },
        { k: 'applicantOrg', label: tr("as_f_applicantOrg"), type: 'text', width: 220, group: tr("as_applicant"), when: isForm() },
        { k: 'takeoutPeriod', label: tr("as_f_takeoutPeriod"), type: 'text', width: 240, placeholder: '2026.05.27.~2026.12.31', when: isForm('checkout') },
        { k: 'takeoutReason', label: tr("as_f_takeoutReason"), type: 'longtext', rows: 2, when: isForm('checkout') },
        { k: 'domesticOrInternational', label: tr("as_f_domesticOrInternational"), type: 'text', width: 80, placeholder: 'O/X', when: isForm('checkout') },
        { k: 'returnDate', label: tr("as_f_returnDate"), type: 'text', width: 140, when: isForm('checkin') },
        { k: 'returnReason', label: tr("as_f_returnReason"), type: 'longtext', rows: 2, when: isForm('checkin') },
        { k: 'extensionPeriod', label: tr("as_f_extensionPeriod"), type: 'text', width: 240, when: isForm('extension') },
        { k: 'extensionReason', label: tr("as_f_extensionReason"), type: 'longtext', rows: 2, when: isForm('extension') },
        { k: 'user', label: tr("as_made_by"), type: 'text', edit: false, col: { w: 120, min: 60, drop: 1100 }, tone: 'dim',
          cell: (r) => (r.user ? String(r.user).split('@')[0] : D) },
        { k: 'at', label: tr("as_time"), get: (r) => r.createdAt || '', col: { w: 150, min: 90, drop: 900 }, tone: 'dim',
          cell: (r) => String(r.createdAt || '').slice(0, 16).replace('T', ' ') || D },
      ] },
  ],
}
