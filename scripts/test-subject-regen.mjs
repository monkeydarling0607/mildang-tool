// scripts/test-subject-regen.mjs — 임시 검증
// 1) 서버 normalizeEpisodeKey vs 클라이언트 effectiveEpisodeAxisClient 의미 그룹 일치
// 2) regenerationContext rejectedKey 매칭이 새 후보를 강등시키는지

import fs from 'node:fs';

/* ── client effectiveEpisodeAxisClient 추출 ── */
const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
global.document = { addEventListener:()=>{}, querySelectorAll:()=>[], getElementById:()=>({value:'',style:{},classList:{add:()=>{},remove:()=>{},toggle:()=>{}},querySelectorAll:()=>[]}) };
global.localStorage = { getItem:()=>null, setItem:()=>{} };
global.window = global;
const { effectiveEpisodeAxisClient } = new Function(script + '; return { effectiveEpisodeAxisClient };')();

/* ── server normalizeEpisodeKey 추출 (regex 직접 import 못하므로 require로) ── */
const serverSrc = fs.readFileSync('api/generate.js', 'utf8');
const startMarker = 'function normalizeEpisodeKey(s) {';
const startIdx = serverSrc.indexOf(startMarker);
const endIdx = serverSrc.indexOf('\nfunction normalizeRejectedKeys', startIdx);
const fnSrc = serverSrc.slice(startIdx, endIdx);
const normalizeEpisodeKey = new Function('return (' + fnSrc.replace(/^function\s+normalizeEpisodeKey/, 'function') + ')')();

/* ── Test cases ── */
const SPEC = [
  /* 사용자 spec에 명시된 묶음 그룹 — 서버·클라이언트 모두 같은 키로 묶여야 */
  { name: '증빙 누락 그룹', cases: [
      { episode_axis: '증빙 누락' },
      { episode_axis: '영수증 누락' },
      { episode_axis: '카드 비용 인정 불안' },
      { episode_axis: '적격증빙 없음' }
    ], expectGroup: true },
  { name: '신고후추가세금 그룹', cases: [
      { episode_axis: '신고 후 추가 세금' },
      { episode_axis: '가산세 발생' },
      { episode_axis: '고지서 갑작스러운 통보' },
      { episode_axis: '신고 끝났는데 세금 더 나옴' }
    ], expectGroup: true },
  { name: '사후반납 그룹', cases: [
      { episode_axis: '사후 반납' },
      { episode_axis: '지원금 사후 점검 반납' },
      { title: '지원금 받았는데 반납하라는 연락이 왔어요', episode_axis: '반납 통보' }
    ], expectGroup: true },
  { name: '매출-현금흐름 불일치', cases: [
      { title: '매출 늘었는데 통장엔 왜 돈이 없을까요?', episode_axis: '매출-현금흐름 불일치' },
      { title: '카드 매출 늘었는데 왜 통장 잔고가 없죠?', episode_axis: '매출 늘었는데 통장 잔고 없음' },
      { episode_axis: '정산은 늘었는데 돈 없음' }
    ], expectGroup: true },
  { name: '직원비용부담', cases: [
      { title: '직원 채용 후 부담이 너무 많이 늘었어요', episode_axis: '직원 채용 비용 부담' },
      { title: '직원 월급 올렸더니 4대보험도 올라갔어요', episode_axis: '4대보험 증가' }
    ], expectGroup: true },
  { name: '임대차계약변경', cases: [
      { title: '이사 후 세금이 늘어날 줄이야', episode_axis: '이사 후 세금 변동' },
      { title: '임대차 계약이 변동되면 세금도 바뀌나요?', episode_axis: '임대차 계약 변경' }
    ], expectGroup: true },
  { name: '자동결제 명의 문제', cases: [
      { title: '자동결제 서비스가 대표 개인 명의로 빠져나가요', episode_axis: '자동결제 누락' }
    ], expectGroup: false },  /* 단일 — 다른 그룹과 안 섞임만 확인 */
];

let allPass = true;
for (const t of SPEC) {
  console.log('━━━ ' + t.name + ' ━━━');
  const cKeys = t.cases.map(effectiveEpisodeAxisClient);
  const sKeys = t.cases.map(normalizeEpisodeKey);
  t.cases.forEach((c, i) => {
    console.log('  ' + (c.title || c.episode_axis).slice(0, 40).padEnd(42), '| client:', cKeys[i].padEnd(28), '| server:', sKeys[i]);
  });
  if (t.expectGroup) {
    const cAllSame = cKeys.every(k => k && k === cKeys[0]);
    const sAllSame = sKeys.every(k => k && k === sKeys[0]);
    if (!cAllSame) { console.log('  ✗ client 같은 그룹으로 묶이지 않음'); allPass = false; }
    if (!sAllSame) { console.log('  ✗ server 같은 그룹으로 묶이지 않음'); allPass = false; }
    if (cAllSame && sAllSame) console.log('  ✓ 모두 같은 그룹');
  }
}

console.log('');
console.log('━━━ 사용자 spec 테스트 A: 1차 후보 vs 2차 후보 키 매칭 ━━━');
const round1 = [
  { title:'매출 늘었는데, 통장엔 왜 돈이 없을까요?', episode_axis:'매출 늘었는데 통장 잔고 없음' },
  { title:'카드 긁었는데, 비용 인정이 안 된다네요',  episode_axis:'카드 비용 인정 불안' },
  { title:'직원 채용 후, 부담이 너무 많이 늘었어요',  episode_axis:'직원 채용 비용 부담' },
  { title:'지원금 받았는데, 반납하라는 연락이 왔어요', episode_axis:'사후 반납' },
  { title:'이사 후, 세금이 늘어날 줄이야',           episode_axis:'임대차 계약 변경' }
];
const round2 = [
  { title:'지원금 받았는데, 이건 내 돈으로 갚아야 한다고요?', episode_axis:'지원금 반납' },
  { title:'카드 매출 늘었는데 왜 통장 잔고가 없죠?',          episode_axis:'매출-현금흐름 불일치' },
  { title:'신고했는데 벌 세금이 더 나왔다고요?',              episode_axis:'신고 후 추가 세금' },
  { title:'임대차 계약이 변동되면 세금도 바뀌나요?',          episode_axis:'임대차 계약 변경' },
  { title:'직원 월급 올렸더니 4대보험도 올라갔어요',          episode_axis:'4대보험 증가' }
];
const rejectedKeySet = new Set(round1.map(normalizeEpisodeKey).filter(Boolean));
console.log('rejected keys:', Array.from(rejectedKeySet));
let hits = 0;
round2.forEach(s => {
  const k = normalizeEpisodeKey(s);
  const hit = rejectedKeySet.has(k);
  console.log(' ', (hit ? '✗ REJECTED 매칭' : '  통과').padEnd(16), '|', k.padEnd(28), '|', s.title);
  if (hit) hits++;
});
console.log('총 ' + round2.length + '개 중 ' + hits + '개가 rejected와 매칭 → 강등됨 (기대: 4~5개 — 사용자 spec상 반복 후보)');

console.log('');
console.log(allPass ? '✅ 모든 그룹 매칭 통과' : '❌ 일부 그룹 불일치');
