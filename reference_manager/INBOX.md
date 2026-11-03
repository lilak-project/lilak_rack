# reference_manager — 받은 것을 들이는 길 (계획)

새 reference를 만드는 일과 이미 있는 것과 합치는 일을 **project_manager의 inbox**로
보내자는 계획. 아직 만들지 않았다. 설계 노트이지 할 일 목록이 아니다.

## 왜 inbox인가

지금 들어오는 길이 셋인데 셋 다 제각각이다.

- note의 `.bib 맞추기` — 못 찾은 cite key를 **빨간 글씨로 말하고 끝난다**
  (노트 「관리 도구함」의 「bib 맞추기는 키 문자열로만 맞춘다」).
- note의 zip import — 공저자 원고의 `reference.bib`에서 **키 개수만 센다.**
- 손으로 입력 — 라이브러리를 눈으로 뒤져보고 없으면 새로 만든다.

inbox는 이 모양을 이미 갖고 있다 (`project_manager/src-lilak/inbox.jsx`): **후보**
레코드 하나에 `target`(어느 서비스), `match: {id}`(이미 있는 레코드를 가리키면),
`mode`(`update` · `checked`), 상태(`waiting` → `approved` · `checked` · `discarded`).
버튼은 [예]가 그 서비스의 API로 **만들고**, [업데이트]가 채워진 칸만 **덮고**,
[확인]이 "새로운 것 없음", [열기]가 그 레코드를 연다.

맞춰보는 쪽(기계)과 들이는 쪽(사람)이 갈려 있다는 것이 요점이다. DOI가 같다고
기계가 합쳐버리면 틀렸을 때 되돌릴 것이 남지 않는다. **기계는 후보를 내고 사람이
누른다.**

## 후보 하나

`target: 'reference'`, 그리고 어디서 왔는지를 말하는 몇 칸:

```
from      reference.bib (2026-10-31-ELARK-NIM) | doi.org | 손으로
citeKey   orruba                 ← 원고가 쓰는 키
doi       10.1016/j.nima.2007.05.109
title     The Oak Ridge Rutgers University Barrel Array
authors   S. D. Pain, J. A. Cizewski, …      ← 텍스트 그대로
year      2007
journal   Nucl. Instrum. Methods A
match     { id: 'ref_8831' }     ← 기계가 찾았으면
why       doi | 키 규칙 | 제목+연도   ← 무엇으로 찾았는지, 사람이 믿을지 정하라고
```

`why`가 있어야 한다. "DOI가 같다"와 "제목이 비슷하다"는 사람이 다르게 판단한다.

## 찾는 순서

노트 「관리 도구함」에 적은 그대로다: **DOI → arXiv id → reference_manager의 키 규칙으로
다시 만든 키 → 저장된 citeKey → 정규화한 (제목 + 연도)**. 별칭 칸은 두지 않는다 —
규칙(`citeKeyFor(doc, r, rule)`)이 이미 있으니 다시 만들어 비교한다.

## 저자도 같은 모양으로 — 생각보다 가깝다

"그냥 텍스트로 쓰여 있으니까 어렵지 않나"는 **절반만 맞다.** reference_manager의
저자는 이미 레코드다:

- 논문의 `authors`는 `{ name, ref, corr }` 줄들이고, `ref`는 같은 문서의 `authors`
  클래스를 가리킨다. 그 레코드가 `name`(인용 철자) · `fullName` · `bibName` ·
  `tag`(핸들) · `aliases`를 들고 있다.
- **`ref` 없이 `name`만 있는 줄**이 바로 "텍스트로 쓰여 있는" 경우다. 즉 지금도
  등록된 사람과 등록 안 된 철자가 한 줄기 안에 섞여 있고, 구분은 `ref` 하나다.
- 맞추는 규칙도 이미 있다: `linkSpellings(a, doc)` — 사람을 저장하면 그 사람의 모든
  철자(`name` · `fullName` · `bibName` · `aliases`)와 같은 **텍스트 줄들이 전부 그
  레코드로 이어진다.** `handleFor(name)`가 핸들을 짓는다.

그래서 저자 후보는 새 기계가 아니라 **같은 inbox의 다른 `target`**이다:

```
target  author
name    S. D. Pain
seen    ref_8831, ref_9120, …        ← 이 철자가 붙어 있는 논문들
match   { id: 'aut_41' }             ← aliases 로 찾았으면
why     aliases | handle | 같은 성과 머리글자
```

[예]는 새 저자 레코드를 만들고 `linkSpellings`로 흩어진 철자를 당긴다. [업데이트]는
그 철자를 기존 사람의 `aliases`에 더한다 — **본문(논문의 authors 줄)은 안 고친다.**
`.bib`와 같은 원칙이다: 철자는 원고의 것이고, 신원만 라이브러리가 안다.

`ref` 없는 철자를 모아 세는 화면이 먼저 있으면 (`"S. D. Pain" ×7`) 후보는 거기서
저절로 나온다. 그게 첫 조각이고, author_manager는 그 다음이다 — 그쪽은 **다른
서비스의 레코드**라 같은 사람인지 묻는 일이 한 겹 더 있다.

## 순서

**하나.** `bib.js`에 `sameWork(a, b)` — DOI · arXiv · 규칙 키 · 제목+연도, 무엇으로
맞췄는지(`why`)까지 돌려준다. 테스트가 붙는다.

**둘.** note의 zip import가 `reference.bib`를 읽어 `sameWork`로 가른다:
"15개 중 11개는 이미 있습니다(DOI 일치) · 4개 새로". 아직 inbox는 없이, 보고만.

**셋.** 그 4개를 **inbox 후보로** 넣는다. 여기서 project_manager의 `target`에
`reference`가 는다.

**넷.** 저자 — `ref` 없는 철자를 세는 화면, 그 다음 같은 inbox의 `target: 'author'`.
