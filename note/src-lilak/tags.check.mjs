/** What `#태그` means, checked. Run: node src-lilak/tags.check.mjs
 *
 *  The rule is copied from MarkdownArea.jsx on purpose — this file must not
 *  pull in JSX to run. If the two drift, the first case fails.
 */
import assert from 'node:assert/strict'
import { outsideCode, replaceOutsideCode, TAG_COMMENT, projText, isProject, setProjChoices } from './marks.js'

export const TAG_RE = /(^|[\s(])#(?![0-9]+(?![^\s#.,;:!?()[\]{}'"]))([^\s#.,;:!?()[\]{}'"]+)/g
export const renameBodyTag = (body, from, to) =>
  String(body || '').replace(TAG_RE, (m, lead, name) => (name === from ? `${lead}#${to}` : m))

const cases = [
  ['#old 입니다', 'old', 'new', '#new 입니다'],
  ['앞에 #old 뒤에', 'old', 'new', '앞에 #new 뒤에'],
  ['(#old)', 'old', 'new', '(#new)'],
  // #oldish is its own tag, and `# ` is a heading
  ['#oldish 는 다른 태그', 'old', 'new', '#oldish 는 다른 태그'],
  ['# 제목은 태그가 아니다', '제목은', 'x', '# 제목은 태그가 아니다'],
  ['a#old 는 태그가 아니다', 'old', 'new', 'a#old 는 태그가 아니다'],
  ['#old 와 #old 둘 다', 'old', 'new', '#new 와 #new 둘 다'],
  ['#old, 쉼표 앞', 'old', 'new', '#new, 쉼표 앞'],
  ['#SpiRIT_TPC 밑줄', 'SpiRIT_TPC', 'SpiRIT', '#SpiRIT 밑줄'],
  ['#old\n줄바꿈', 'old', 'new', '#new\n줄바꿈'],
  ['#한글태그 다', '한글태그', '새태그', '#새태그 다'],
  // a number alone is a PR or issue number, not a tag; with letters it is a tag
  ['PR #207, 끝', '207', 'x', 'PR #207, 끝'],
  ['#2026계획 시작', '2026계획', 'plan', '#plan 시작'],
]
for (const [body, from, to, want] of cases) {
  assert.equal(renameBodyTag(body, from, to), want, JSON.stringify(body))
}
// `+프로젝트` — the project rule (marks.js PROJ_RE), copied as TAG_RE is.
export const PROJ_RE = /(^|[\s(])\+(?![0-9]+(?![^\s#+.,;:!?()[\]{}'"]))([^\s#+.,;:!?()[\]{}'"]+)/g
const projs = [
  ['+STARK 회의', ['STARK']], ['(+ELARK) 와 +S-TPC,', ['ELARK', 'S-TPC']],
  ['C++ 와 a+b', []], ['+ 글머리표', []], ['+3 명', []], ['+2026계획', ['2026계획']],
]
for (const [body, want] of projs) {
  assert.deepEqual([...body.matchAll(PROJ_RE)].map((m) => m[2]), want, JSON.stringify(body))
}
// ── code is not prose: a `#` inside it is not a tag ──────────────────────
const tagsIn = (body) => [...outsideCode(body).matchAll(TAG_RE)].map((m) => m[2])
const codes = [
  ['#real\n\n```c++\n#include <v>\n```\n\n#after', ['real', 'after']],
  ['`#inline` 은 코드', []],
  ['``#double`` 도 코드', []],
  ['~~~\n#tilde\n~~~', []],
  // A fence nobody closed runs to the end — markdown's own rule.
  ['#a\n```\n#b\n#c', ['a']],
  ['  ```\n#in\n  ```\n#out', ['out']],
]
for (const [body, want] of codes) {
  assert.equal(outsideCode(body).length, body.length, 'a blank keeps the shape')
  assert.deepEqual(tagsIn(body), want, JSON.stringify(body))
}
// A rename walks past code and leaves it exactly as it was.
assert.equal(
  replaceOutsideCode('#old\n```\n#old\n```\n#old', TAG_RE, (m, lead, name) => (name === 'old' ? `${lead}#new` : m)),
  '#new\n```\n#old\n```\n#new')

// ── a tex note's tags live on a comment line ─────────────────────────────
// `#` is TeX's macro parameter character, so the tag goes where LaTeX does not
// read it — and the tag rule still does.
const comments = [
  ['% #favorite', true], ['%#a #b', true], ['%   #한글태그  ', true],
  ['#favorite', false],                       // a markdown note's, not a tex note's
  ['% favorite', false],                      // nothing to read: the `#` is gone
  ['% #favorite 쓴 이유', false],              // a sentence, not a tag line — left alone
  ['%% #a', false],                           // `%%` is the template's own comment
  ['\\section{A} % #a', false],                // a tag beside text stays where it is
]
for (const [line, want] of comments) {
  assert.equal(TAG_COMMENT.test(line), want, JSON.stringify(line))
}
// What the line says is read as tags, the `%` notwithstanding.
assert.deepEqual([...outsideCode('x\n% #favorite #elark').matchAll(TAG_RE)].map((m) => m[2]), ['favorite', 'elark'])

// Only project_manager's projects are projects; a name with spaces is one word in text.
setProjChoices(['STARK + CRIB'])
assert.equal(projText('STARK + CRIB'), 'STARK_CRIB')
assert.ok(isProject('stark_crib') && !isProject('STARK') && !isProject('없는것'))
console.log(`${cases.length + projs.length + codes.length + comments.length + 2}개 통과`)
