/**
 * inbox — the declaration. A record is a candidate something automatic
 * proposed (the Claude mail task, an agent through the portal's MCP): a note,
 * an activity or a job, waiting for a person's yes before it is made in the
 * service it belongs to. One list, waiting first (backend/main.py keeps the
 * order), the buttons in its last column (inbox.jsx).
 */
import './strings.js'
import { tr } from 'lilak-ui/i18n.jsx'
import { InboxActions, MailField, MakesField, MatchName } from './inbox.jsx'

// The kinds an activity is stored with (Korean in the data) — as activities/src-lilak/def.js GROUPS has them.
const KINDS = ['학회', '워크샵', '학술미팅', '연구출장', '미팅', '세미나', '강연', '교육', '실험', '보고서', '제안서', '기타', '행사']
const isAct = (r) => r.target === 'activity'
const isNote = (r) => r.target === 'note'
const isJob = (r) => r.target === 'job'
const fromMail = () => true                       // the mail's own facts: shown, not edited
const isDel = (r) => r.target === 'note_delete' || r.target === 'record_delete'
const isTags = (r) => r.target === 'tags'
const what = (r) => (isTags(r) ? r.title || tr('ib_tags_n', (r.items || []).length) : isNote(r) || isDel(r) ? r.title : r.name) || ''

export default {
  name: 'inbox', title: tr('ib_title'), unit: tr('ib_unit'), key: 'ib',
  item: {
    key: 'inbox', noun: tr('ib_noun'), allLabel: tr('ib_title'), label: (r) => what(r) || r.subject || r.id,
    // Made by the mail task and the MCP, decided here: no copy of one. No tags of its own.
    clone: false, tags: false,
    // As the backend keeps it (_order): what is still to be decided, then the newest mail.
    order: [{ k: 'status', dir: 1 }, { k: 'date', dir: -1 }],
    actions: (f, setF, ctx) => <InboxActions r={f} ctx={ctx} after={(ch) => setF((s) => ({ ...s, ...ch }))} close={ctx.close} />,
    columns: ['target', 'what', 'status', 'mode', 'act', 'from', 'date', 'remark'],
    fields: [
      { k: 'target', label: tr('ib_kind'), type: 'select', col: 56, disabled: fromMail,
        options: [['activity', tr('ib_activity')], ['note', tr('ib_note')], ['job', tr('ib_job')],
          ['note_delete', tr('ib_note_delete')], ['record_delete', tr('ib_record_delete')], ['tags', tr('ib_tags')]] },
      { k: 'what', label: tr('ib_title_col'), col: 280, get: what,
        cell: (r) => <>{r.attachments?.length ? '📎 ' : ''}{what(r) || (r.match?.id ? <MatchName r={r} /> : '·')}</> },
      { k: 'status', label: tr('ib_status'), type: 'select', col: 80, disabled: fromMail, sort: (v) => (v === 'waiting' ? 0 : 1),
        options: [['waiting', tr('ib_waiting_s')], ['approved', tr('ib_approved_s')], ['checked', tr('ib_checked_s')], ['discarded', tr('ib_discarded_s')]] },
      // new, or about a record that exists (`match`): update it, or seen — nothing new
      { k: 'mode', label: tr('ib_mode'), type: 'select', col: 70, disabled: fromMail, default: '',
        options: [['', tr('ib_mode_new')], ['update', tr('ib_mode_update')], ['checked', tr('ib_mode_checked')]] },
      { k: 'act', label: '', col: 236, edit: false, cell: (r, ctx) => <InboxActions r={r} ctx={ctx} row /> },
      { k: 'from', label: tr('ib_from'), type: 'text', col: 180, tone: 'dim', disabled: fromMail },
      // No mail date: the day it came in.
      { k: 'date', label: tr('ib_date'), type: 'text', col: 92, tone: 'dim', disabled: fromMail,
        sort: (v, c, r) => `${String(r.date || r.createdAt || '').slice(0, 10)}|${r.createdAt || ''}` },
      { k: 'subject', label: tr('ib_mail'), type: 'text', disabled: fromMail },
      { k: 'mailView', label: tr('ib_mail_src'), type: 'text', store: false, when: (r) => !!(r.subject || r.threadId), edit: (p) => <MailField {...p} /> },
      { k: 'remark', label: tr('ib_remark'), type: 'text', col: 220, tone: 'dim', disabled: fromMail },
      // an activity's
      { k: 'name', label: 'name', type: 'text', when: isAct },
      { k: 'kind', label: 'kind', type: 'select', when: isAct, options: KINDS.map((k) => [k, k]) },
      { k: 'start', label: 'start', type: 'date', when: isAct },
      { k: 'startTime', label: 'startTime', type: 'time', when: isAct },
      { k: 'end', label: 'end', type: 'date', when: isAct },
      { k: 'endTime', label: 'endTime', type: 'time', when: isAct },
      { k: 'place', label: 'place', type: 'text', when: isAct },
      { k: 'link', label: 'link', type: 'url', when: isAct },
      { k: 'comment', label: 'comment', type: 'longtext', when: isAct },
      // a note's
      { k: 'title', label: 'title', type: 'text', when: isNote },
      { k: 'noteTags', label: 'tags', type: 'text', when: isNote, placeholder: '#태그 #태그' },
      { k: 'body', label: 'body', type: 'longtext', when: isNote },
      // a job an agent asks to run (approving submits it to jobrun through Jobboard)
      // a note to put in the bin (the portal's tidying): which, and its body as it was then
      { k: 'noteId', label: 'note', type: 'text', when: (r) => r.target === 'note_delete', disabled: fromMail },
      { k: 'excerpt', label: 'body', type: 'longtext', when: (r) => r.target === 'note_delete', disabled: fromMail },
      { k: 'recipe', label: 'recipe', type: 'text', when: isJob },
      { k: 'jobProject', label: 'project', type: 'text', when: isJob },
      { k: 'server', label: 'server', type: 'text', when: isJob },
      { k: 'params', label: 'params', type: 'longtext', when: isJob, placeholder: '{"run": 1241}' },
      // where it goes — a project of project_manager's, whose tags it then wears — and what it will be
      { k: 'project', label: tr('ib_project'), type: 'ref', to: { svc: 'project_manager', item: 'projects', label: 'name' },
        col: 120, hint: tr('ib_project_hint') },
      { k: 'makes', label: tr('ib_makes'), type: 'text', when: (r) => r.status === 'waiting' && r.mode !== 'checked', edit: (p) => <MakesField {...p} /> },
      // What this should have been, in the owner's words: the mail task learns from it.
      { k: 'feedback', label: tr('ib_feedback'), type: 'longtext', hint: tr('ib_feedback_hint') },
    ],
  },
}
