import { describe, it, expect } from 'vitest'
import { JOB_RE, jobOf, setJobChoices } from '../note/src-lilak/marks.js'

const found = (text) => [...text.matchAll(JOB_RE)].map((m) => m[2])

describe('::job', () => {
  it('six hex after a space or the line start, digits only included', () => {
    expect(found('::219c0f 와 (::220405) 를 비교')).toEqual(['219c0f', '220405'])
  })
  it('not a C++ name, a slice, an address or a longer word', () => {
    expect(found('TH1::Fill a[::2] ::1 ::219c0f0 ::xyz123 key:: value')).toEqual([])
  })
  it('names only a job jobboard has, by the end of its id', () => {
    setJobChoices([{ id: 'jobrun-20261110-220405-219c0f', name: 'ihm-scan' }])
    expect(jobOf('219c0f')?.name).toBe('ihm-scan')
    expect(jobOf('abcdef')).toBeNull()
  })
})

describe('::job, read', () => {
  it('is drawn as the ticket where a note is rendered', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { Rendered } = await import('../note/src-lilak/reading.jsx')
    setJobChoices([{ id: 'jobrun-20261110-220405-219c0f', name: 'ihm-scan' }])
    const html = renderToStaticMarkup(createElement(Rendered, null, '스캔 잡 ::219c0f 과 ::abcdef'))
    expect(html).toContain('<span class="nt-ticket-name">ihm-scan</span><span class="nt-ticket-id">219c0f</span>')
    expect(html).toContain('::abcdef')
    expect(html).not.toContain('::219c0f 과')
  })
})

describe('::job, offered', () => {
  it('by recipe, title or id, latest first, the short id to write', async () => {
    const { jobsFor } = await import('../note/src-lilak/marks.js')
    setJobChoices([
      { id: 'jobrun-20261110-220405-219c0f', name: 'ihm-scan', title: 'ihm-scan vmin=0', at: '2026-11-10 22:04' },
      { id: 'jobrun-20261110-223507-d88f7f', name: 'ihm-plot', title: 'ihm-plot', at: '2026-11-10 22:35' },
      { id: 'jobrun-20261109-071603-8a6d22', name: 'reco', title: 'reco run=101', at: '2026-11-09 07:16' },
    ])
    expect(jobsFor('ihm').map((j) => j.short)).toEqual(['d88f7f', '219c0f'])
    expect(jobsFor('run=101').map((j) => j.short)).toEqual(['8a6d22'])
    expect(jobsFor('219c').map((j) => j.name)).toEqual(['ihm-scan'])
  })
})
