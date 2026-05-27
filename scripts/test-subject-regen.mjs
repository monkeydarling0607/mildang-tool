// scripts/test-subject-regen.mjs — 임시 검증
// 1) 서버 normalizeEpisodeKey vs 클라이언트 effectiveEpisodeAxisClient 의미 그룹 일치
// 2) regenerationContext rejectedKey 매칭이 새 후보를 강등시키는지
// 3) buildEpisodeExcludeMap이 archive(hard/strong/soft) + rejected 키를 올바르게 묶는지
// 4) detectBasicOwnerAnxiety / detectBroadGenericTitle이 기본형 후보를 인식하는지

import fs from 'node:fs';

/* ── client effectiveEpisodeAxisClient + 클라이언트 detect 함수 추출 ── */
const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
global.document = { addEventListener:()=>{}, querySelectorAll:()=>[], getElementById:()=>({value:'',style:{},classList:{add:()=>{},remove:()=>{},toggle:()=>{}},querySelectorAll:()=>[]}) };
global.localStorage = { getItem:()=>null, setItem:()=>{} };
global.window = global;
const { effectiveEpisodeAxisClient, detectBasicOwnerAnxietyClient, detectBroadGenericTitleClient } =
  new Function(script + '; return { effectiveEpisodeAxisClient, detectBasicOwnerAnxietyClient, detectBroadGenericTitleClient };')();

/* ── server 함수 추출 — buildEpisodeExcludeMap이 normalizeEpisodeKey를 참조하므로
   하나의 묶음으로 평가해 클로저 안에서 서로 참조 가능하게 한다. ── */
const serverSrc = fs.readFileSync('api/generate.js', 'utf8');
function slice(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  if (s < 0) throw new Error('missing marker: ' + startMarker);
  const e = src.indexOf(endMarker, s);
  if (e < 0) throw new Error('missing end: ' + endMarker);
  return src.slice(s, e);
}
const bundle = [
  slice(serverSrc, 'function normalizeEpisodeKey(',   '\nfunction detectBasicOwnerAnxiety'),
  slice(serverSrc, 'function detectBasicOwnerAnxiety(', '\nfunction detectBroadGenericTitle'),
  slice(serverSrc, 'function detectBroadGenericTitle(', '\nfunction buildEpisodeExcludeMap'),
  slice(serverSrc, 'function buildEpisodeExcludeMap(',  '\nfunction normalizeRejectedKeys'),
].join('\n');
const {
  normalizeEpisodeKey,
  detectBasicOwnerAnxiety,
  detectBroadGenericTitle,
  buildEpisodeExcludeMap,
} = new Function(bundle + '\nreturn { normalizeEpisodeKey, detectBasicOwnerAnxiety, detectBroadGenericTitle, buildEpisodeExcludeMap };')();

/* ── Test cases: 의미 그룹 매칭 ── */
const SPEC = [
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
      { episode_axis: '신고 끝났는데 세금 더 나옴' },
      { episode_axis: '세금 폭탄' },
      { title: '직원 뽑고 세금 폭탄이 날아올 줄이야?' },
    ], expectGroup: true },
  { name: '사후반납 그룹', cases: [
      { episode_axis: '사후 반납' },
      { episode_axis: '지원금 사후 점검 반납' },
      { title: '지원금 받았는데 반납하라는 연락이 왔어요', episode_axis: '반납 통보' }
    ], expectGroup: true },
  { name: '매출-현금흐름 불일치', cases: [
      { title: '매출 늘었는데 통장엔 왜 돈이 없을까요?', episode_axis: '매출-현금흐름 불일치' },
      { title: '카드 매출 늘었는데 왜 통장 잔고가 없죠?', episode_axis: '매출 늘었는데 통장 잔고 없음' },
      { episode_axis: '정산은 늘었는데 돈 없음' },
      { title: '정산금이 없는데 매출은 늘고 있어요?', episode_axis: '정산금 없음' }
    ], expectGroup: true },
  { name: '직원비용부담', cases: [
      { title: '직원 채용 후 부담이 너무 많이 늘었어요', episode_axis: '직원 채용 비용 부담' },
      { title: '직원 월급 올렸더니 4대보험도 올라갔어요', episode_axis: '4대보험 증가' },
      { title: '직원 뽑았는데 부담', episode_axis: '직원 채용 부담' }
    ], expectGroup: true },
  { name: '신청단계탈락', cases: [
      { title: '지원금 신청했는데 연락 없음', episode_axis: '신청 후 연락 없음' },
      { title: '지원금 좋은데, 왜 안 줄까요?', episode_axis: '지원금 신청 탈락' }
    ], expectGroup: true },
  { name: '임대차계약변경', cases: [
      { title: '이사 후 세금이 늘어날 줄이야', episode_axis: '이사 후 세금 변동' },
      { title: '임대차 계약이 변동되면 세금도 바뀌나요?', episode_axis: '임대차 계약 변경' }
    ], expectGroup: true },
  { name: '자동결제 명의 문제', cases: [
      { title: '자동결제 서비스가 대표 개인 명의로 빠져나가요', episode_axis: '자동결제 누락' }
    ], expectGroup: false },
];

let allPass = true;
for (const t of SPEC) {
  console.log('━━━ ' + t.name + ' ━━━');
  const cKeys = t.cases.map(effectiveEpisodeAxisClient);
  const sKeys = t.cases.map(normalizeEpisodeKey);
  t.cases.forEach((c, i) => {
    const label = (c.title || c.episode_axis || '').slice(0, 38);
    console.log('  ' + label.padEnd(40), '| client:', cKeys[i].padEnd(26), '| server:', sKeys[i]);
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
console.log('총 ' + round2.length + '개 중 ' + hits + '개가 rejected와 매칭 → 제거됨 (기대: 4~5개 — 사용자 spec상 반복 후보)');

console.log('');
console.log('━━━ 테스트 B: buildEpisodeExcludeMap — archive(hard/strong) + rejected ━━━');
const archive = [
  /* idx 0~4: hard (최근 5회) */
  { kakaoTitle: '신고 마치고 세금이 더 나왔어요',  topic: '신고 후 추가 세금' },
  { kakaoTitle: '매출 늘었는데 통장이 비어 있어요', topic: '매출-현금흐름' },
  { kakaoTitle: '직원 뽑고 부담이 너무 늘었어요',   topic: '직원 비용 부담' },
  { kakaoTitle: '지원금 받았는데 반납 통보',        topic: '사후 반납' },
  { kakaoTitle: '임대차 계약 갱신',                topic: '임대차 변경' },
  /* idx 5~14: strong */
  { kakaoTitle: '카드 비용 인정 불안',              topic: '카드 증빙' },
  { kakaoTitle: '지원금 신청했는데 연락 없음',      topic: '신청 탈락' },
  /* idx 15+: soft */
];
for (let i = 7; i < 20; i++) archive.push({ kakaoTitle: '구회차 ' + i, topic: '소재' + i });

const excludeMap = buildEpisodeExcludeMap({
  archiveItems: archive,
  rejectedSubjects: [{ title: '카드 매출 늘었는데 통장 비었', episode_axis: '카드매출 통장' }],
  rejectedEpisodeKeys: []
});
console.log('hardKeys:', Array.from(excludeMap.hardKeys));
console.log('strongKeys:', Array.from(excludeMap.strongKeys));
console.log('rejectedKeys:', Array.from(excludeMap.rejectedKeys));

const newCandidate = { title: '매출은 늘었는데 통장은 비어 있어요', episode_axis: '매출 통장' };
const k = normalizeEpisodeKey(newCandidate);
const blockedAsHard = excludeMap.hardKeys.has(k);
console.log('새 후보 "' + newCandidate.title + '" — key=' + k + ', archive-hard로 제거되는가?',
  blockedAsHard ? '✓ 예' : '✗ 아니오 (실패)');
if (!blockedAsHard) allPass = false;

console.log('');
console.log('━━━ 테스트 C: detectBasicOwnerAnxiety — 기본형 패턴 인식 ━━━');
const basicCases = [
  { title: '직원 뽑았는데 부담', expect: true },
  { title: '매출 늘었는데 통장 비어 있음', expect: true },
  { title: '카드 비용 인정 불안', expect: true },
  { title: '지원금 신청했는데 연락 없음', expect: true },
  { title: '계약 바뀌면 세금 걱정', expect: true },
  { title: '세금 폭탄이 날아올 줄이야', expect: true },
  /* 구체 사건형 — false여야 함 */
  { title: '자동결제 서비스가 대표 개인 명의로 빠져나가요', expect: false },
  { title: '예약금은 받았는데 환불될 수도 있대요', expect: false },
  { title: '가족 계좌로 매출이 들어왔는데 괜찮나요?', expect: false },
  { title: '공동대표로 바꿨더니 계산서 발행 주체가 애매해요', expect: false },
];
basicCases.forEach(c => {
  const sv = detectBasicOwnerAnxiety(c);
  const cv = detectBasicOwnerAnxietyClient(c);
  const svDetected = !!sv, cvDetected = !!cv;
  const ok = svDetected === c.expect && cvDetected === c.expect;
  if (!ok) allPass = false;
  console.log(' ', (ok ? '✓' : '✗').padEnd(2), c.title.padEnd(48),
    '| server:', String(sv).padEnd(16), '| client:', String(cv).padEnd(16),
    '| 기대:', c.expect ? '기본형 감지' : '면제');
});

console.log('');
console.log('━━━ 테스트 D: detectBroadGenericTitle — 넓은 제목 인식 ━━━');
const broadCases = [
  { title: '매출 늘었는데 세금까지', expect: true },
  { title: '직원 뽑았는데 부담', expect: true },
  { title: '카드 썼는데 비용 안 됨', expect: true },
  { title: '지원금 신청했는데 연락 없음', expect: true },
  { title: '자동결제 서비스가 대표 개인 명의로 빠져나가요', expect: false },
  { title: '예약금은 받았지만 환불 가능성이 있어 매출 인식이 애매함', expect: false },
];
broadCases.forEach(c => {
  const sv = detectBroadGenericTitle(c);
  const cv = detectBroadGenericTitleClient(c);
  const ok = (!!sv) === c.expect && (!!cv) === c.expect;
  if (!ok) allPass = false;
  console.log(' ', (ok ? '✓' : '✗').padEnd(2), c.title.padEnd(60),
    '| server:', String(sv).padEnd(22), '| client:', String(cv));
});

console.log('');
console.log(allPass ? '✅ 모든 테스트 통과' : '❌ 일부 실패');
process.exit(allPass ? 0 : 1);
