import './strings.js'
import { useState } from 'react'
import { tr } from 'lilak-ui/i18n.jsx'
import Select from 'lilak-ui/components/Select.jsx'
import { RackActions, RackField, newId, portalUser } from 'racklist'
import { shows, canAdd } from './settings.jsx'

/**
 * Files in and out — what asset manager did with them, on the rack frame:
 *
 *   내보내기  the assets in sight (or the ticked ones) as XLSX, one sheet with
 *             every field but the photos, or as HWPX, a table with the photos,
 *             one file per 자산분류 and a ZIP of all;
 *   들여오기  an XLSX of assets registered in bulk (pick the header row, match
 *             its columns to the fields, see what is new, register it), or an
 *             HWPX / JSON that names assets — they are ticked, or made a list.
 *
 * Both open as editor panes (slots.editors), from the menu (slots.commands).
 * Every save is its own press: a browser lets one press save one file, and
 * building a file takes longer than a press lasts.
 */

export const safeName = (v) => String(v || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'asset-list'
export function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
/** hwpx-export.js, fetched the first time a file is made: it sets window.CensHwpx
 *  (build, and makeZip — a STORE zip, which is also what an .xlsx is). */
export async function hwpx() {
  await import('./hwpx-export.js')
  return window.CensHwpx
}

/** Assets by 자산분류, in the order met: [[class, [assets…]], …]. */
export function byClass(assets) {
  const m = new Map()
  for (const a of assets) {
    const c = String(a.assetClass || '').trim() || tr("as_unclassified")
    m.set(c, [...(m.get(c) || []), a])
  }
  return [...m.entries()]
}

// ─── XLSX ───────────────────────────────────────────────────────────────────
// The sheet's columns, as asset manager wrote them — so a sheet it made comes
// back in, and the office reads its own words.
export const COLUMNS = [
  ['assetId', '자산번호'], ['name', '자산명'], ['type', 'Type'], ['assetClass', '자산분류'],
  ['location', '위치'], ['user', '최근변경자'], ['accountHolder', '관리책임자'],
  ['applicationName', '신청품목명'], ['spec', '규격'], ['description', '설명'], ['memo', '메모'],
  ['manufacturerProvider', '제조사'], ['acquisitionDate', '취득일'], ['acquisitionPriceKrw', '취득가'],
  ['lastInOutDate', '최근반출입일'], ['editedBy', '편집이력'], ['lastUpdate', '최근변경'],
]
// What a column in someone else's sheet may be called, for each field an import fills.
const ALIASES = {
  assetId: ['자산번호', 'assetno', 'asset number', 'asset id', '자산 번호'],
  name: ['자산명', 'assetname', '이름', '품명'],
  location: ['위치', '동호실', '설치위치'],
  type: ['type', '타입', '종류'],
  assetClass: ['자산분류', '분류'],
  accountHolder: ['관리책임자', '사용책임자', '책임자'],
  applicationName: ['신청품목명', '신청명'],
  spec: ['규격', 'specification'],
  description: ['설명', '자산명영문', '비고'],
  memo: ['메모', 'note'],
  manufacturerProvider: ['제조사', '거래처명', '공급처', 'maker'],
  acquisitionDate: ['취득일', '취득일자'],
  acquisitionPriceKrw: ['취득가', '취득금액', '가격'],
}
const IMPORTED = Object.keys(ALIASES)

const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s }
const colIdx = (ref) => { let n = 0; for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

/** One sheet, inline strings, no library. `doc`: leave out what its settings
 *  hide from whoever is exporting. */
export function xlsxBlob(H, assets, doc) {
  const COLS = COLUMNS.filter(([k]) => !doc || shows(doc, k))
  const esc = (v) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const rows = [COLS.map(([, h]) => h), ...assets.map((a) => COLS.map(([k]) => a[k] ?? ''))]
    .map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) =>
      `<c r="${colName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')}</row>`).join('')
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const ns = 'http://schemas.openxmlformats.org'
  const enc = new TextEncoder()
  return H.makeZip([
    ['[Content_Types].xml', `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets><sheet name="Assets" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', `<worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`],
  ].map(([name, xml]) => ({ name, data: enc.encode(head + xml) })))
}

// ─── reading a zip (an .xlsx, an .hwpx): STORE, or DEFLATE by the browser ────
const z16 = (b, o) => b[o] | (b[o + 1] << 8)
const z32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
/** name → () => Promise<bytes>, every entry of the zip. */
function zipEntries(bytes) {
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i -= 1) if (z32(bytes, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error(tr("as_not_zip"))
  const out = new Map()
  let off = z32(bytes, eocd + 16)
  for (let i = 0, n = z16(bytes, eocd + 10); i < n && z32(bytes, off) === 0x02014b50; i += 1) {
    const method = z16(bytes, off + 10), size = z32(bytes, off + 20)
    const nlen = z16(bytes, off + 28), skip = z16(bytes, off + 30) + z16(bytes, off + 32), lo = z32(bytes, off + 42)
    const name = new TextDecoder().decode(bytes.slice(off + 46, off + 46 + nlen))
    out.set(name, async () => {
      const at = lo + 30 + z16(bytes, lo + 26) + z16(bytes, lo + 28)
      const data = bytes.slice(at, at + size)
      if (method === 0) return data
      const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return new Uint8Array(await new Response(s).arrayBuffer())
    })
    off += 46 + nlen + skip
  }
  return out
}
const unxml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&')

/** An .xlsx's first sheet as rows of strings, and the row most likely its header
 *  (the first with a 자산번호 cell — instruction rows above a table often say the
 *  word in a sentence, so a header cell is short). */
export async function readXlsx(bytes) {
  const z = zipEntries(bytes)
  const names = [...z.keys()]
  const sheet = names.find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n)) || names.find((n) => /^xl\/worksheets\/.*\.xml$/i.test(n))
  if (!sheet) throw new Error(tr("as_no_sheet"))
  const dec = new TextDecoder()
  const ss = names.find((n) => /^xl\/sharedStrings\.xml$/i.test(n))
  const shared = ss ? [...dec.decode(await z.get(ss)()).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))) : []
  const rows = []
  for (const r of dec.decode(await z.get(sheet)()).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = []
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (/\br="([A-Z]+)\d+"/.exec(c[1]) || [])[1]
      const t = (/\bt="([^"]+)"/.exec(c[1]) || [])[1]
      const body = c[2] || ''
      const v = t === 'inlineStr' ? (/<t[^>]*>([\s\S]*?)<\/t>/.exec(body) || [])[1]
        : (/<v[^>]*>([\s\S]*?)<\/v>/.exec(body) || [])[1]
      row[ref ? colIdx(ref) : row.length] = v === undefined ? '' : t === 's' ? (shared[+v] ?? '') : unxml(v)
    }
    rows.push(Array.from(row, (x) => String(x ?? '').trim()))
  }
  const isId = (v) => { const t = v.replace(/[\s.()]/g, ''); return !!t && t.length <= 12 && (t.includes('자산번호') || /asset(no|number|id)/i.test(t)) }
  let header = rows.findIndex((r) => r.some(isId))
  if (header < 0) header = Math.max(0, rows.findIndex((r) => r.filter(Boolean).length >= 2))
  return { rows, header }
}

/** The 자산번호s a file names: our JSON, or an HWPX we (or asset manager) made. */
export async function readNumbers(name, bytes) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.json')) {
    const data = JSON.parse(new TextDecoder().decode(bytes))
    const rows = Array.isArray(data) ? data : (data.rows || data.assetIds || [])
    return rows.map((r) => String(typeof r === 'string' ? r : (r.assetNumber || r.assetId || '')).trim()).filter(Boolean)
  }
  if (lower.endsWith('.hwpx')) {
    const sec = zipEntries(bytes).get('Contents/section0.xml')
    if (!sec) throw new Error(tr("as_not_zip"))
    // The numbers in its TEXT (<hp:t>), not in its layout — widths and ids are
    // digits too, and the old app's reading of the whole XML picked them up.
    const text = [...new TextDecoder().decode(await sec()).matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((m) => unxml(m[1])).join('\n')
    return [...new Set(text.match(/[0-9]{5,}/g) || [])]
  }
  throw new Error(lower.endsWith('.pdf') ? tr("as_pdf_no") : tr("as_kind_no"))
}

/** Which header each field takes, guessed from its name and the old app's words. */
export function guessMap(headers) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[\s._()·]/g, '')
  const out = {}
  for (const k of IMPORTED) {
    const want = [k, ...ALIASES[k]].map(norm)
    const hit = headers.find((h) => h && want.includes(norm(h)))
    if (hit) out[k] = hit
  }
  if (!out.assetId) { const h = headers.find((x) => /자산.*번호|asset.*(no|id|number)/i.test(x)); if (h) out.assetId = h }
  return out
}

/** The rows under the header as new assets: those with a number not already
 *  here (nor twice in the sheet). */
export function newAssets(rows, header, map, have) {
  const heads = rows[header] || []
  const col = (h) => heads.indexOf(h)
  const seen = new Set(have)
  const out = []
  let total = 0, dup = 0
  for (const r of rows.slice(header + 1)) {
    const id = String(r[col(map.assetId)] ?? '').trim()
    if (!map.assetId || !id) continue
    total += 1
    if (seen.has(id)) { dup += 1; continue }
    seen.add(id)
    out.push(Object.fromEntries(IMPORTED.map((k) => [k, map[k] && col(map[k]) >= 0 ? String(r[col(map[k])] ?? '').trim() : '']).concat([['assetId', id]])))
  }
  return { total, dup, add: out }
}

// ─── the panes ────────────────────────────────────────────────────────────────
const fieldLabel = (def, k) => def.item.fields.find((f) => f.k === k)?.label || k

/** What is in sight — or ticked — as XLSX or HWPX. */
export function ExportPane({ api, etab }) {
  const ticked = api.chosen.length > 0
  const assets = ticked ? api.chosen : api.rows
  const title = etab.title || tr("as_tab_assets")
  const [out, setOut] = useState({})                 // { xlsx: {blob,name}, hwpx: {files, zip, zipName} }
  const [busy, setBusy] = useState('')
  async function make(kind) {
    setBusy(kind)
    try {
      const H = await hwpx()
      if (kind === 'xlsx') setOut((o) => ({ ...o, xlsx: { blob: xlsxBlob(H, assets, api.doc), name: `${safeName(title)}.xlsx` } }))
      else {
        const files = []
        for (const [c, group] of byClass(assets)) {
          const blob = await H.build({
            version: 1, title: `${title} - ${c}`, savedAt: new Date().toISOString(),
            printSettings: { fontSize: 12, rowStart: 1, orientation: 'portrait', viewMode: 'wide', description: 'hide', photos: 'show' },
            request: { type: '', fields: {} },
            rows: group.map((a) => ({ assetNumber: a.assetId, assetName: a.name || '', assetDescription: a.description || '',
              numberPhoto: a.photo2 || '', wholePhoto: a.photo1 || '' })),
          }, '')
          files.push({ c, n: group.length, blob, name: `${safeName(title)}_${safeName(c)}.hwpx` })
        }
        const zip = H.makeZip(await Promise.all(files.map(async (x) => ({ name: x.name, data: new Uint8Array(await x.blob.arrayBuffer()) }))))
        setOut((o) => ({ ...o, hwpx: { files, zip, zipName: `${safeName(title)}.zip` } }))
      }
    } catch (e) {
      api.setNote(tr("as_export_failed", e?.message || String(e)))
    } finally { setBusy('') }
  }
  return (
    <div className="rl-edit">
      <RackActions onClose={() => api.closeEdit(etab.id)} hint={tr(ticked ? "as_export_ticked" : "as_export_shown", assets.length)} />
      <div className="rl-rec">
        <RackField label="XLSX">
          {out.xlsx
            ? <button type="button" className="rl-btn rl-go" onClick={() => download(out.xlsx.blob, out.xlsx.name)}>{tr("as_save_file", out.xlsx.name)}</button>
            : <button type="button" className="rl-btn" disabled={!!busy || !assets.length} onClick={() => make('xlsx')}>{tr("as_make_xlsx")}</button>}
          <span className="rl-hint">{tr("as_xlsx_hint")}</span>
        </RackField>
        <RackField label="HWPX">
          {!out.hwpx && <button type="button" className="rl-btn" disabled={!!busy || !assets.length}
            onClick={() => make('hwpx')}>{busy === 'hwpx' ? tr("as_hwpx_building") : tr("as_make_hwpx")}</button>}
          {out.hwpx && (out.hwpx.files.length === 1
            ? <button type="button" className="rl-btn rl-go" onClick={() => download(out.hwpx.files[0].blob, out.hwpx.files[0].name)}>{tr("as_hwpx_save")}</button>
            : <>
              <button type="button" className="rl-btn rl-go" onClick={() => download(out.hwpx.zip, out.hwpx.zipName)}>{tr("as_hwpx_zip", out.hwpx.files.length)}</button>
              {out.hwpx.files.map((x) => <button key={x.c} type="button" className="rl-btn" onClick={() => download(x.blob, x.name)}>{tr("as_hwpx_one", x.c, x.n)}</button>)}
            </>)}
          <span className="rl-hint">{tr("as_hwpx_table_hint")}</span>
        </RackField>
      </div>
    </div>
  )
}

/** A file in: an XLSX of assets to register, or an HWPX / JSON naming assets. */
export function ImportPane({ api, etab }) {
  const { def, doc } = api
  const [file, setFile] = useState(null)             // { name, sheet: {rows, header} } | { name, ids }
  const [map, setMap] = useState({})
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const have = new Set((doc.assets || []).map((a) => a.assetId))

  async function take(f) {
    if (!f) return
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      if (/\.xlsx$/i.test(f.name)) {
        const sheet = await readXlsx(bytes)
        if (!sheet.rows.length) throw new Error(tr("as_sheet_empty"))
        setFile({ name: f.name, sheet })
        setMap(guessMap(sheet.rows[sheet.header] || []))
      } else {
        setFile({ name: f.name, ids: await readNumbers(f.name, bytes) })
      }
    } catch (e) { setFile(null); api.setNote(tr("as_import_failed", e?.message || String(e))) }
  }
  const setHeader = (i) => { setFile((x) => ({ ...x, sheet: { ...x.sheet, header: i } })); setMap(guessMap(file.sheet.rows[i] || [])) }

  const plan = file?.sheet && newAssets(file.sheet.rows, file.sheet.header, map, have)
  const mayAdd = canAdd(doc)
  async function register() {
    if (!plan?.add.length || busy) return
    setBusy(true)
    const now = new Date().toISOString()
    const me = portalUser()?.email || ''
    const add = plan.add.map((a) => ({ ...a, photo1: '', photo2: '', createdAt: now, lastUpdate: now, user: me }))
    try {
      if (await api.commit({ assets: [...add, ...(doc.assets || [])] }, tr("as_registered_n", add.length))) {
        api.setPicked(new Set(add.map((a) => a.assetId)))
        api.closeEdit(etab.id)
      }
    } finally { setBusy(false) }
  }

  const found = file?.ids ? file.ids.filter((id) => have.has(id)) : []
  const missing = file?.ids ? file.ids.filter((id) => !have.has(id)) : []
  async function makeList() {
    if (!found.length || busy) return
    setBusy(true)
    const name = file.name.replace(/\.[^.]+$/, '')
    try {
      const rec = { id: newId(), name, type: 'save', location: '', assetIds: found,
        user: portalUser()?.email || '', createdAt: new Date().toISOString() }
      if (await api.commit({ records: [rec, ...(doc.records || [])] }, tr("as_list_made", name, found.length))) api.closeEdit(etab.id)
    } finally { setBusy(false) }
  }

  const heads = file?.sheet ? file.sheet.rows[file.sheet.header] || [] : []
  return (
    <div className="rl-edit">
      <RackActions onClose={() => api.closeEdit(etab.id)}
        extra={<>
          {plan && <button type="button" className="rl-btn rl-go" disabled={busy || !plan.add.length || !mayAdd} onClick={register}>{tr("as_register_n", plan.add.length)}</button>}
          {file?.ids && <button type="button" className="rl-btn rl-go" disabled={busy || !found.length} onClick={makeList}>{tr("as_make_list_n", found.length)}</button>}
          {file?.ids && <button type="button" className="rl-btn" disabled={!found.length}
            onClick={() => { api.setPicked(new Set(found)); api.setNote(tr("as_ticked_n", found.length)) }}>{tr("as_tick_n", found.length)}</button>}
        </>} />
      <div className="rl-rec">
        <RackField label={tr("as_file")}>
          <label className={`rl-btn${over ? ' on' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]) }}>
            {file ? file.name : tr("as_pick_file")}
            <input type="file" accept=".xlsx,.hwpx,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; take(f) }} />
          </label>
          <span className="rl-hint">{tr("as_import_hint")}</span>
        </RackField>
        {file?.sheet && (
          <>
            <RackField label={tr("as_header_row")}>
              <Select className="rl-btn rl-pick" value={String(file.sheet.header)} onChange={(e) => setHeader(+e.target.value)}>
                {file.sheet.rows.slice(0, 15).map((r, i) => (
                  <option key={i} value={String(i)}>{tr("as_row_n", i + 1, r.filter(Boolean).slice(0, 4).join(' · ').slice(0, 60))}</option>
                ))}
              </Select>
            </RackField>
            {IMPORTED.map((k) => (
              <RackField key={k} label={fieldLabel(def, k)}>
                <Select className="rl-btn rl-pick" value={map[k] || ''} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))}>
                  <option value="">—</option>
                  {heads.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
                {k === 'assetId' && !map.assetId && <span className="rl-hint">{tr("as_need_id_column")}</span>}
              </RackField>
            ))}
            <RackField label={tr("as_preview")}>
              <div className="rl-rows">
                <span className="rl-hint">{tr("as_import_counts", plan.total, plan.dup, plan.add.length)}</span>
                {!mayAdd && <span className="rl-hint">{tr("as_no_create")}</span>}
                {plan.add.slice(0, 8).map((a) => <span key={a.assetId} className="rl-hint">{a.assetId} · {a.name || ''}</span>)}
                {plan.add.length > 8 && <span className="rl-hint">…</span>}
              </div>
            </RackField>
          </>
        )}
        {file?.ids && (
          <RackField label={tr("as_preview")}>
            <div className="rl-rows">
              <span className="rl-hint">{tr("as_numbers_counts", file.ids.length, found.length, missing.length)}</span>
              {missing.length > 0 && <span className="rl-hint">{tr("as_not_here", missing.slice(0, 10).join(', ') + (missing.length > 10 ? ' …' : ''))}</span>}
            </div>
          </RackField>
        )}
      </div>
    </div>
  )
}
