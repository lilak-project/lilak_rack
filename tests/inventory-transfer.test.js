import { describe, it, expect } from 'vitest'
import { xlsxBlob, readXlsx, guessMap, newAssets, readNumbers, hwpx } from '../inventory/src-lilak/transfer.jsx'

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer())

describe('inventory files in and out', () => {
  it('an exported sheet comes back in: header found, columns matched, only new numbers registered', async () => {
    const H = await hwpx()
    const out = xlsxBlob(H, [
      { assetId: '202401401', name: '네트워크랙 <A&B>', location: 'IRIS2', assetClass: '연구장비' },
      { assetId: '202501382', name: '전자교탁' },
    ])
    const { rows, header } = await readXlsx(await bytesOf(out))
    expect(header).toBe(0)
    expect(rows[1].slice(0, 2)).toEqual(['202401401', '네트워크랙 <A&B>'])
    const map = guessMap(rows[header])
    expect(map).toMatchObject({ assetId: '자산번호', name: '자산명', location: '위치', assetClass: '자산분류', type: 'Type' })
    const plan = newAssets(rows, header, map, new Set(['202501382']))
    expect([plan.total, plan.dup, plan.add.map((a) => a.assetId)]).toEqual([2, 1, ['202401401']])
    expect(plan.add[0]).toMatchObject({ location: 'IRIS2', assetClass: '연구장비' })
  })
  it('a JSON list names assets; a PDF is refused', async () => {
    const enc = (o) => new TextEncoder().encode(JSON.stringify(o))
    expect(await readNumbers('x.json', enc({ rows: [{ assetNumber: '1001' }, { assetId: '1002' }, '1003'] }))).toEqual(['1001', '1002', '1003'])
    await expect(readNumbers('x.pdf', new Uint8Array())).rejects.toThrow()
  })
})

describe('scan: what a code says → 자산번호', async () => {
  const { assetNumber } = await import('../inventory/src-lilak/scan.jsx')
  const have = new Set(['202500051', '202002654'])
  it('reads the number alone, in a URL, or among words', () => {
    expect(assetNumber(' 202500051 ', have)).toBe('202500051')
    expect(assetNumber('https://x.kr/a?assetId=202002654&b=1', have)).toBe('202002654')
    expect(assetNumber('https://x.kr/asset/202002654', have)).toBe('202002654')
    expect(assetNumber('CENS 2024 자산 202500051', have)).toBe('202500051')   // the known run wins
    expect(assetNumber('번호 77 없음', have)).toBe('77')
    expect(assetNumber('', have)).toBe('')
  })
})
