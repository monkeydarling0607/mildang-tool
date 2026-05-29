// scripts/test-subject-regen.mjs — 주제 후보 생성 후처리 검증
//
// 검증 항목:
//  1) normalizeEpisodeKey 의미 그룹 매칭 (서버 ↔ 클라이언트 동일)
//  2) detectBasicOwnerAnxiety / detectBroadGenericTitle 인식
//  3) buildEpisodeExcludeMap (archive hard/strong + rejected)
//  4) processSubjects — 기본형 제거, seed fallback 사용, archive 충돌 시 다른 seed 사용
//  5) 최종 5개 품질 (기본형 0개, epKey 중복 없음, 구체 사건/seed ≥ 3개)
//
// 실행: node scripts/test-subject-regen.mjs
// 환경: Windows / PowerShell 호환

import fs from 'node:fs';

/* ── client 함수 추출 ── */
const html = fs.readFileSync('index.html', 'utf8');
const clientScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
global.document = { addEventListener:()=>{}, querySelectorAll:()=>[], getElementById:()=>({value:'',style:{},classList:{add:()=>{},remove:()=>{},toggle:()=>{}},querySelectorAll:()=>[]}) };
global.localStorage = { getItem:()=>null, setItem:()=>{} };
global.window = global;
const { effectiveEpisodeAxisClient, detectBasicOwnerAnxietyClient, detectBroadGenericTitleClient } =
  new Function(clientScript + '; return { effectiveEpisodeAxisClient, detectBasicOwnerAnxietyClient, detectBroadGenericTitleClient };')();

/* ── server 헬퍼 블록 추출 (TEST_HELPERS_START ~ TEST_HELPERS_END) ── */
const serverSrc = fs.readFileSync('api/generate.js', 'utf8');
const startTag = '/* TEST_HELPERS_START';
const endTag   = '/* TEST_HELPERS_END */';
const startIdx = serverSrc.indexOf(startTag);
const endIdx   = serverSrc.indexOf(endTag);
if (startIdx < 0 || endIdx < 0) throw new Error('TEST_HELPERS 마커가 없습니다 — api/generate.js 확인 필요');
const helperBlock = serverSrc.slice(startIdx, endIdx);

const {
  normalizeEpisodeKey,
  effectiveAxis,
  detectBasicOwnerAnxiety,
  detectBroadGenericTitle,
  buildEpisodeExcludeMap,
  processSubjects,
  CONCRETE_EPISODE_SEED_BANK,
} = new Function(helperBlock + `
  return {
    normalizeEpisodeKey,
    effectiveAxis,
    detectBasicOwnerAnxiety,
    detectBroadGenericTitle,
    buildEpisodeExcludeMap,
    processSubjects,
    CONCRETE_EPISODE_SEED_BANK,
  };
`)();

let totalFails = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log('  ✓', name);
  } else {
    console.log('  ✗', name);
    if (detail) console.log('    →', detail);
    totalFails++;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   0. 의미 그룹 매칭 — 서버/클라이언트 동일
   ═══════════════════════════════════════════════════════════════════ */
console.log('━━━ 0) normalizeEpisodeKey 의미 그룹 매칭 (서버 ↔ 클라이언트) ━━━');
const GROUPS = [
  { name: '증빙누락', cases: [
      { episode_axis: '증빙 누락' },
      { episode_axis: '카드 비용 인정 불안' },
      { episode_axis: '적격증빙 없음' },
    ], expectGroup: true },
  { name: '신고후추가세금', cases: [
      { episode_axis: '신고 후 추가 세금' },
      { episode_axis: '가산세 발생' },
      { episode_axis: '세금 폭탄' },
      { title: '직원 뽑고 세금 폭탄이 날아올 줄이야?' },
    ], expectGroup: true },
  { name: '사후반납', cases: [
      { episode_axis: '사후 반납' },
      { title: '지원금 받았는데 반납하라는 연락이 왔어요' },
    ], expectGroup: true },
  { name: '매출-현금흐름', cases: [
      { title: '매출 늘었는데 통장엔 왜 돈이 없을까요?' },
      { episode_axis: '정산은 늘었는데 돈 없음' },
      { title: '정산금이 없는데 매출은 늘고 있어요?' },
    ], expectGroup: true },
  { name: '직원비용부담', cases: [
      { title: '직원 채용 후 부담이 너무 많이 늘었어요' },
      { title: '직원 뽑았는데 부담' },
    ], expectGroup: true },
  { name: '신청단계탈락', cases: [
      { title: '지원금 신청했는데 연락 없음' },
      { title: '지원금 좋은데, 왜 안 줄까요?' },
      { title: '지원금 신청했는데 보류됐어요' },
    ], expectGroup: true },
  { name: '임대차계약변경', cases: [
      { title: '이사 후 세금이 늘어날 줄이야' },
      { title: '임대차 계약이 변동되면 세금도 바뀌나요?' },
    ], expectGroup: true },
  { name: '자동결제명의문제', cases: [
      { title: '자동결제 서비스가 대표 개인 명의로 빠져나가요' },
    ], expectGroup: false },
];
GROUPS.forEach(g => {
  const sKeys = g.cases.map(normalizeEpisodeKey);
  const cKeys = g.cases.map(effectiveEpisodeAxisClient);
  if (g.expectGroup) {
    const sAllSame = sKeys.every(k => k && k === sKeys[0]);
    const cAllSame = cKeys.every(k => k && k === cKeys[0]);
    assert(`[${g.name}] server 의미 그룹 일치`, sAllSame, `keys=${JSON.stringify(sKeys)}`);
    assert(`[${g.name}] client 의미 그룹 일치`, cAllSame, `keys=${JSON.stringify(cKeys)}`);
  }
  /* 매 케이스마다 server ↔ client 키가 같아야 한다 */
  g.cases.forEach((c, i) => {
    const label = (c.title || c.episode_axis || '').slice(0, 30);
    assert(`[${g.name}] ${label} — 서버/클라이언트 키 동일`, sKeys[i] === cKeys[i], `s=${sKeys[i]} c=${cKeys[i]}`);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   Test 1. 기본형 후보 5개 → regen=2에서 전부 제거
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test 1) 기본형 후보 제거 (regenerateCount=2) ━━━');
const test1Subjects = [
  { title:'매출은 증가했는데, 통장 잔고는 왜 비는 걸까요?', summary:'카드 매출은 늘었는데 통장에 돈이 없어 답답합니다.', subject_category:'사업 운영형', problem_axis:'매출·정산·현금흐름', episode_axis:'매출 증가하는데 통장은 빈다', trigger_moment:'월말 통장 확인', conflict_axis:'매출과 잔고 차이', final_score:9.0, episode_diversity_score:7 },
  { title:'카드 긁었는데, 경비 인정이 안 된다?', summary:'사업카드로 결제했지만 경비 인정이 어려운 상황입니다.', subject_category:'세무 리스크형', problem_axis:'카드·증빙·경비 관리', episode_axis:'카드 비용 인정 불안', trigger_moment:'결산 직전', conflict_axis:'경비 인정 여부', final_score:8.7, episode_diversity_score:6 },
  { title:'직원 뽑고 원천세가 이렇게 늘어났어요?', summary:'직원 한 명 채용했을 뿐인데 원천세 부담이 늘었습니다.', subject_category:'직원·노무형', problem_axis:'직원·급여·4대보험', episode_axis:'직원 채용 비용 부담', trigger_moment:'첫 월급일', conflict_axis:'예상보다 큰 부담', final_score:8.5, episode_diversity_score:6 },
  { title:'지원금 신청했는데 보류됐어요',                  summary:'지원금 신청했는데 결과가 보류 상태입니다.', subject_category:'지원·정책형', problem_axis:'지원사업·정책자금', episode_axis:'지원금 신청 보류', trigger_moment:'결과 통보', conflict_axis:'신청 후 미수령', final_score:8.4, episode_diversity_score:6 },
  { title:'계약 바뀌면 세금도 바뀌나요?',                  summary:'임대차 계약 갱신 후 세금이 어떻게 바뀔지 걱정입니다.', subject_category:'사업 운영형', problem_axis:'사업자 정보·명의·주소·계약', episode_axis:'임대차 계약 변경 세금', trigger_moment:'계약 갱신', conflict_axis:'계약 변경 세금 변화', final_score:8.2, episode_diversity_score:6 },
];
const test1Payload = { regenerationContext: { regenerateCount: 2 }, archive: [] };
const test1Out = processSubjects(test1Subjects, test1Payload);
const test1Removed = test1Out.stats.removedByBasicPattern;
const test1AnyLeftover = test1Out.finalSubjects.some(s => detectBasicOwnerAnxiety(s));
assert('기본형 5개 모두 basic-owner-anxiety로 감지', test1Removed >= 5, `removedByBasicPattern=${test1Removed}`);
assert('최종 후보에 기본형 0개', !test1AnyLeftover, `leftover titles=${JSON.stringify(test1Out.finalSubjects.map(s=>s.title))}`);
assert('최종 후보 5개', test1Out.finalSubjects.length === 5, `length=${test1Out.finalSubjects.length}`);
assert('seed fallback으로 보강', test1Out.stats.seedFallbackUsed >= 5, `seedFallbackUsed=${test1Out.stats.seedFallbackUsed}`);
assert('similar fallback 0개 (유사 후보 안내 안 뜸)', test1Out.stats.similarFallbackUsed === 0, `similarFallbackUsed=${test1Out.stats.similarFallbackUsed}`);

/* ═══════════════════════════════════════════════════════════════════
   Test 2. 구체 사건형 5개 → regen=2에서 전부 유지
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test 2) 구체 사건형 후보 유지 (regenerateCount=2) ━━━');
const test2Subjects = [
  { title:'가족카드로 결제한 비용도 사업비가 되나요?',           summary:'가족 명의 카드로 결제한 사업용 지출의 경비 인정 여부.', subject_category:'세무 리스크형', problem_axis:'카드·증빙·경비 관리', episode_axis:'가족카드 사업비 처리', trigger_moment:'결산 중', conflict_axis:'결제 주체 다름', final_score:8.8, episode_diversity_score:9 },
  { title:'자동결제 서비스가 대표 개인 명의로 빠져나가요',        summary:'사업 구독료가 대표 개인 명의로 결제되는 상황.', subject_category:'세무 리스크형', problem_axis:'카드·증빙·경비 관리', episode_axis:'자동결제 명의 문제', trigger_moment:'카드 명세 확인', conflict_axis:'명의 차이', final_score:8.7, episode_diversity_score:9 },
  { title:'세금계산서는 이번 달, 입금은 다음 달이면요?',         summary:'계산서 발행과 입금 시점이 달라 매출 인식이 모호.', subject_category:'세무 리스크형', problem_axis:'매출·정산·현금흐름', episode_axis:'세금계산서·입금 시점 차이', trigger_moment:'월말 결산', conflict_axis:'시점 불일치', final_score:8.6, episode_diversity_score:9 },
  { title:'공동대표로 바꿨더니 계산서 발행 주체가 애매해요',     summary:'공동대표 전환 후 세금계산서 발행 주체가 헷갈림.', subject_category:'세무 리스크형', problem_axis:'사업자 정보·명의·주소·계약', episode_axis:'공동대표 세금계산서 발행 주체', trigger_moment:'전환 직후 첫 발행', conflict_axis:'주체 분산', final_score:8.5, episode_diversity_score:9 },
  { title:'프리랜서로 계약했는데 근로자라고 볼 수도 있대요',      summary:'프리랜서 계약이지만 실제 근로 관계가 있어 근로자성 판단 필요.', subject_category:'직원·노무형', problem_axis:'직원·급여·4대보험', episode_axis:'프리랜서 근로자성 판단', trigger_moment:'노동청 안내', conflict_axis:'계약 vs 실태', final_score:8.4, episode_diversity_score:9 },
];
const test2Payload = { regenerationContext: { regenerateCount: 2 }, archive: [] };
const test2Out = processSubjects(test2Subjects, test2Payload);
assert('구체 사건형 5개 모두 통과', test2Out.finalSubjects.length === 5
  && test2Out.finalSubjects.every(s => !detectBasicOwnerAnxiety(s)),
  `final=${JSON.stringify(test2Out.finalSubjects.map(s=>s.title))}`);
assert('basic-owner-anxiety로 제거된 후보 0개', test2Out.stats.removedByBasicPattern === 0, `removedByBasic=${test2Out.stats.removedByBasicPattern}`);
assert('seed fallback 사용 안 함', test2Out.stats.seedFallbackUsed === 0, `seedFallbackUsed=${test2Out.stats.seedFallbackUsed}`);
assert('similar fallback 사용 안 함', test2Out.stats.similarFallbackUsed === 0, `similarFallbackUsed=${test2Out.stats.similarFallbackUsed}`);

/* ═══════════════════════════════════════════════════════════════════
   Test 3. 후보 대부분 제거 → seed bank로 보강
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test 3) 후보 부족 시 seed bank로 보강 ━━━');
/* 모두 기본형 — regen=2에서 다 제거되므로 seed bank로 5개 채워야 함 */
const test3Subjects = test1Subjects.slice();
const test3Out = processSubjects(test3Subjects, { regenerationContext: { regenerateCount: 2 }, archive: [] });
assert('최종 5개 채워짐', test3Out.finalSubjects.length === 5, `length=${test3Out.finalSubjects.length}`);
assert('seed fallback ≥ 5', test3Out.stats.seedFallbackUsed >= 5, `seedFallbackUsed=${test3Out.stats.seedFallbackUsed}`);
const test3HasSeedFlag = test3Out.finalSubjects.some(s => s._seedFallback === true);
assert('finalSubjects에 _seedFallback=true 포함', test3HasSeedFlag, JSON.stringify(test3Out.finalSubjects.map(s => ({t:s.title, seed:!!s._seedFallback}))));
assert('similar fallback 0개 (유사 후보 안내 플래그 false)', test3Out.stats.similarFallbackUsed === 0, `similarFallbackUsed=${test3Out.stats.similarFallbackUsed}`);

/* ═══════════════════════════════════════════════════════════════════
   Test 4. archive에 자동결제명의문제 hard → 자동결제 seed 제외, 다른 seed 사용
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test 4) archive hard key와 겹치는 seed는 사용 안 함 ━━━');
const test4Archive = [
  { kakaoTitle: '자동결제 명의 문제로 골치 아팠던 사례', topic: '자동결제 명의' },
  { kakaoTitle: '다른 회차',  topic: '소재 A' },
  { kakaoTitle: '다른 회차2', topic: '소재 B' },
  { kakaoTitle: '다른 회차3', topic: '소재 C' },
  { kakaoTitle: '다른 회차4', topic: '소재 D' },
];
const test4Out = processSubjects(test1Subjects.slice(), { regenerationContext: { regenerateCount: 2 }, archive: test4Archive });
const test4AutoUsed = test4Out.finalSubjects.some(s => normalizeEpisodeKey(s) === '자동결제명의문제');
assert('자동결제명의문제 seed 사용 안 함', !test4AutoUsed, `자동결제 seed 사용됨? final=${JSON.stringify(test4Out.finalSubjects.map(s=>({t:s.title, k:normalizeEpisodeKey(s)})))}`);
assert('그래도 최종 5개 채워짐 (다른 seed 사용)', test4Out.finalSubjects.length === 5, `length=${test4Out.finalSubjects.length}`);
assert('seed fallback ≥ 5', test4Out.stats.seedFallbackUsed >= 5, `seedFallbackUsed=${test4Out.stats.seedFallbackUsed}`);

/* ═══════════════════════════════════════════════════════════════════
   Test 5. 최종 5개 품질 — basic 0개, epKey 중복 없음, 구체 사건 ≥ 3
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test 5) 최종 5개 품질 검사 ━━━');
const test5Out = processSubjects(test1Subjects.slice(), { regenerationContext: { regenerateCount: 2 }, archive: [] });
const test5Basic = test5Out.finalSubjects.filter(s => detectBasicOwnerAnxiety(s)).length;
const epKeys = test5Out.finalSubjects.map(normalizeEpisodeKey);
const uniqueEpKeys = new Set(epKeys);
const concreteOrSeed = test5Out.finalSubjects.filter(s => s._seedFallback || !detectBasicOwnerAnxiety(s)).length;
const similarBadgeCount = test5Out.finalSubjects.filter(s => s._similarFallback).length;
assert('basic 후보 0개', test5Basic === 0, `basic=${test5Basic}`);
assert('epKey 중복 없음', uniqueEpKeys.size === epKeys.length, `epKeys=${JSON.stringify(epKeys)}`);
assert('seed 또는 구체 사건 후보 ≥ 3', concreteOrSeed >= 3, `count=${concreteOrSeed}`);
assert('유사 후보 배지 ≤ 1', similarBadgeCount <= 1, `similarFallback=${similarBadgeCount}`);

/* ═══════════════════════════════════════════════════════════════════
   Test 6. regen=0 일 때는 기본형도 통과 (구체 사건 강제 없음)
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test 6) regenerateCount=0 — 기본형도 통과 ━━━');
const test6Out = processSubjects(test1Subjects.slice(), { regenerationContext: { regenerateCount: 0 }, archive: [] });
assert('regen=0에서는 basic-owner-anxiety로 제거 안 됨', test6Out.stats.removedByBasicPattern === 0, `removed=${test6Out.stats.removedByBasicPattern}`);
assert('5개 모두 LLM 후보 그대로 유지', test6Out.finalSubjects.length === 5 && test6Out.stats.seedFallbackUsed === 0, `length=${test6Out.finalSubjects.length} seed=${test6Out.stats.seedFallbackUsed}`);

/* ═══════════════════════════════════════════════════════════════════
   Test 7. seed bank 자체 정합성 — 각 seed가 epKey/필드 완비, 기본형으로 잡히지 않음
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test 7) seed bank 정합성 검사 ━━━');
assert('seed bank ≥ 15개', CONCRETE_EPISODE_SEED_BANK.length >= 15, `length=${CONCRETE_EPISODE_SEED_BANK.length}`);
CONCRETE_EPISODE_SEED_BANK.forEach((seed, i) => {
  const required = ['title', 'summary', 'why_now', 'subject_category', 'problem_axis', 'episode_axis', 'trigger_moment', 'conflict_axis'];
  const missing = required.filter(k => !seed[k]);
  assert(`seed[${i}] "${seed.title.slice(0, 30)}" 필수 필드`, missing.length === 0, `missing=${missing.join(',')}`);
  const k = normalizeEpisodeKey(seed);
  assert(`seed[${i}] normalizeEpisodeKey 산정 가능`, !!k, `key='${k}'`);
  assert(`seed[${i}] basic-owner-anxiety 아님`, !detectBasicOwnerAnxiety(seed), `tag='${detectBasicOwnerAnxiety(seed)}' title='${seed.title}'`);
  assert(`seed[${i}] broad-generic-title 아님`, !detectBroadGenericTitle(seed), `seed=${seed.title}`);
});

/* ═══════════════════════════════════════════════════════════════════
   Test A~E: similarFallback 허용 개수 제한 검증
   ═══════════════════════════════════════════════════════════════════ */

/* seed bank의 모든 고유 epKey를 strong 슬롯(idx 5~14)에 배치해 seed 사용을 차단하는 archive.
   normalizeEpisodeKey가 regex 우선 매칭이라 입력 필드 순서에 따라 키가 달라지므로,
   strong 후보가 실제 어떤 키로 매핑되는지 검증된 텍스트를 사용한다.
   (CONCRETE_EPISODE_SEED_BANK의 실제 키들과 동일한 키로 매핑되는 것을 확인함.) */
function buildAllSeedBlockingStrongSlots() {
  return [
    { kakaoTitle: '증빙 누락 사례', topic: '증빙 누락' },                                                       /* 증빙누락-비용인정불안 */
    { kakaoTitle: '예약금 환불 회차', topic: '예약금 매출 인식' },                                              /* 예약금매출인식 */
    { kakaoTitle: '매출 늘었는데 통장 잔고 부족', topic: '매출 통장' },                                          /* 매출정산-현금흐름불일치 */
    { kakaoTitle: '대상 아님 통보', topic: '매출 기준 미달' },                                                  /* 대상기준착각 */
    { kakaoTitle: '가족 명의 계좌 매출', topic: '가족 계좌 명의' },                                              /* 가족명의거래 */
    { kakaoTitle: '공동대표 변경 발행 주체', topic: '명의 발행' },                                              /* 명의주체불일치 */
    { kakaoTitle: '프리랜서 근로 판정', topic: '근로자성' },                                                     /* 근로자성판단 */
    { kakaoTitle: 'PG 정산일 신고 기준일 달라', topic: '배달앱 정산일' },                                       /* 정산일신고기준차이 */
    { kakaoTitle: '상호 변경 후 계약·계산서 불일치 거래처에서 계산서 명의가 다른' },                              /* seed 13 fallback (raw 20자) */
    { kakaoTitle: '현금 매출 누락', topic: '현금 매출' },                                                       /* 현금매출누락 */
  ];
}

/* ═══ Test A: similarFallback 1개는 허용 ═══ */
console.log('');
console.log('━━━ Test A) similarFallback 1개는 허용 ━━━');
/* keeper 4개 (unique fallback 키) + similar 1개 (증빙누락-비용인정불안 key, archive strong과 매칭).
   archive의 strong 슬롯에 10개 seed key가 모두 들어 있어 seed 풀은 비게 된다. */
const testA_keepers = [
  { title:'테스트 keeper 1', summary:'구체 사건 1',  subject_category:'세무 리스크형', problem_axis:'카드·증빙·경비 관리',   episode_axis:'테스트 keeper1 에피소드 ABC', trigger_moment:'XX1', conflict_axis:'YY1', final_score:9.0, episode_diversity_score:8 },
  { title:'테스트 keeper 2', summary:'구체 사건 2',  subject_category:'사업 운영형',  problem_axis:'사업자 정보·명의·주소·계약', episode_axis:'테스트 keeper2 에피소드 DEF', trigger_moment:'XX2', conflict_axis:'YY2', final_score:8.9, episode_diversity_score:8 },
  { title:'테스트 keeper 3', summary:'구체 사건 3',  subject_category:'세무 리스크형', problem_axis:'카드·증빙·경비 관리',   episode_axis:'테스트 keeper3 에피소드 GHI', trigger_moment:'XX3', conflict_axis:'YY3', final_score:8.8, episode_diversity_score:8 },
  { title:'테스트 keeper 4', summary:'구체 사건 4',  subject_category:'의외성·생활형', problem_axis:'사업자 정보·명의·주소·계약', episode_axis:'테스트 keeper4 에피소드 JKL', trigger_moment:'XX4', conflict_axis:'YY4', final_score:8.7, episode_diversity_score:8 },
];
/* similar candidate: episode_axis='증빙 누락' → 증빙누락-비용인정불안 key.
   증빙누락-비용인정불안은 seed bank의 한 key이기도 해서 strong 슬롯 하나로 둘 다 차단됨. */
const testA_similar = { title:'A. archive와 결이 비슷한 후보 카드', summary:'관련 사건 내용', subject_category:'세무 리스크형', problem_axis:'카드·증빙·경비 관리', episode_axis:'증빙 누락', trigger_moment:'특정 순간', conflict_axis:'유사 갈등', final_score:7.0, episode_diversity_score:6 };

const testA_archive = [];
for (let i = 0; i < 5; i++) testA_archive.push({ kakaoTitle:'hard-pad-'+i, topic:'unrelated-'+i });
for (const item of buildAllSeedBlockingStrongSlots()) testA_archive.push(item);
const testA_out = processSubjects([...testA_keepers, testA_similar], { regenerationContext:{ regenerateCount:0 }, archive: testA_archive });
assert('A. 최종 5개 유지', testA_out.finalSubjects.length === 5, `length=${testA_out.finalSubjects.length}`);
assert('A. similarFallback === 1', testA_out.stats.similarFallbackUsed === 1,
  `similarFallbackUsed=${testA_out.stats.similarFallbackUsed} | final=${JSON.stringify(testA_out.finalSubjects.map(s=>({t:s.title, k:normalizeEpisodeKey(s), seed:!!s._seedFallback, sim:!!s._similarFallback})))}`);
const testA_similarItems = testA_out.finalSubjects.filter(s => s._similarFallback);
assert('A. similar 후보에 _similarFallback=true', testA_similarItems.length === 1, JSON.stringify(testA_out.finalSubjects.map(s=>({t:s.title, sim:!!s._similarFallback}))));
assert('A. seed fallback 사용 안 함 (다 차단됨)', testA_out.stats.seedFallbackUsed === 0, `seedFallbackUsed=${testA_out.stats.seedFallbackUsed}`);
assert('A. 상단 안내 배너 조건 false (similar < 2)', testA_out.stats.similarFallbackUsed < 2, `similarFallbackUsed=${testA_out.stats.similarFallbackUsed}`);

/* ═══ Test B: similar 2개 후보 → seed로 대체 ═══ */
console.log('');
console.log('━━━ Test B) similarFallback 2개 후보 → seed bank로 대체 ━━━');
const testB_keepers = testA_keepers.slice(0, 3);
const testB_similar1 = { title:'유사 후보 B-1', summary:'유사', subject_category:'세무 리스크형',  problem_axis:'세무 리스크형',  episode_axis:'가산세 발생',           trigger_moment:'M', conflict_axis:'C', final_score:7.0, episode_diversity_score:6 };
const testB_similar2 = { title:'유사 후보 B-2', summary:'유사', subject_category:'직원·노무형',  problem_axis:'직원·급여·4대보험', episode_axis:'직원 채용 부담 증가',     trigger_moment:'M', conflict_axis:'C', final_score:6.9, episode_diversity_score:6 };
const testB_archive = [];
for (let i = 0; i < 5; i++) testB_archive.push({ kakaoTitle:'hard-pad-'+i, topic:'unrelated-'+i });
testB_archive.push({ kakaoTitle:'가산세 발생 회차', topic:'가산세' });            /* → 신고후추가세금 */
testB_archive.push({ kakaoTitle:'직원 채용 부담 회차', topic:'직원 채용 부담' }); /* → 직원비용부담 */
const testB_out = processSubjects([...testB_keepers, testB_similar1, testB_similar2], { regenerationContext:{ regenerateCount:0 }, archive: testB_archive });
assert('B. 최종 5개 유지', testB_out.finalSubjects.length === 5, `length=${testB_out.finalSubjects.length}`);
assert('B. similarFallback <= 1', testB_out.stats.similarFallbackUsed <= 1,
  `similarFallbackUsed=${testB_out.stats.similarFallbackUsed} | final=${JSON.stringify(testB_out.finalSubjects.map(s=>({t:s.title, seed:!!s._seedFallback, sim:!!s._similarFallback})))}`);
assert('B. seedFallback ≥ 1 (유사 대신 seed로 보강)', testB_out.stats.seedFallbackUsed >= 1, `seedFallbackUsed=${testB_out.stats.seedFallbackUsed}`);
assert('B. 상단 안내 배너 조건 false', testB_out.stats.similarFallbackUsed < 2, `similarFallbackUsed=${testB_out.stats.similarFallbackUsed}`);

/* ═══ Test C: similar 3개 입력 → seed로 보강, 최종 similar ≤ 1 ═══ */
console.log('');
console.log('━━━ Test C) similarFallback 3개 입력 → seed로 보강 ━━━');
const testC_keepers = testA_keepers.slice(0, 2);
const testC_similars = [
  { title:'유사 C-1', summary:'유사', subject_category:'세무 리스크형',  problem_axis:'세무 리스크형',  episode_axis:'가산세 발생',           trigger_moment:'M', conflict_axis:'C', final_score:7.0, episode_diversity_score:6 },
  { title:'유사 C-2', summary:'유사', subject_category:'직원·노무형',  problem_axis:'직원·급여·4대보험', episode_axis:'직원 채용 부담 증가',     trigger_moment:'M', conflict_axis:'C', final_score:6.9, episode_diversity_score:6 },
  { title:'유사 C-3', summary:'유사', subject_category:'사업 운영형',  problem_axis:'사업자 정보·명의·주소·계약', episode_axis:'이사 후 세금 변동',     trigger_moment:'M', conflict_axis:'C', final_score:6.8, episode_diversity_score:6 },
];
const testC_archive = [];
for (let i = 0; i < 5; i++) testC_archive.push({ kakaoTitle:'hard-pad-'+i, topic:'unrelated-'+i });
testC_archive.push({ kakaoTitle:'가산세 발생 회차', topic:'가산세' });
testC_archive.push({ kakaoTitle:'직원 채용 부담 회차', topic:'직원 채용 부담' });
testC_archive.push({ kakaoTitle:'이사 후 세금 회차', topic:'이사 후 세금' });
const testC_out = processSubjects([...testC_keepers, ...testC_similars], { regenerationContext:{ regenerateCount:0 }, archive: testC_archive });
assert('C. 최종 5개 유지', testC_out.finalSubjects.length === 5, `length=${testC_out.finalSubjects.length}`);
assert('C. similarFallback <= 1', testC_out.stats.similarFallbackUsed <= 1,
  `similarFallbackUsed=${testC_out.stats.similarFallbackUsed} | final=${JSON.stringify(testC_out.finalSubjects.map(s=>({t:s.title, seed:!!s._seedFallback, sim:!!s._similarFallback})))}`);
assert('C. seedFallback ≥ 2 (보강에 사용됨)', testC_out.stats.seedFallbackUsed >= 2, `seedFallbackUsed=${testC_out.stats.seedFallbackUsed}`);
const testC_similarsInFinal = testC_out.finalSubjects.filter(s => s._similarFallback).length;
assert('C. finalSubjects 내 _similarFallback ≤ 1', testC_similarsInFinal <= 1, `count=${testC_similarsInFinal}`);

/* ═══ Test D: seedFallback에는 _similarFallback 안 붙음 ═══ */
console.log('');
console.log('━━━ Test D) seedFallback 후보에 _similarFallback 안 붙음 ━━━');
const testD_out = processSubjects(test1Subjects.slice(), { regenerationContext:{ regenerateCount:2 }, archive: [] });
const testD_seedItems = testD_out.finalSubjects.filter(s => s._seedFallback);
assert('D. seedFallback 후보가 1개 이상', testD_seedItems.length >= 1, `count=${testD_seedItems.length}`);
testD_seedItems.forEach((s, i) => {
  assert(`D. seed[${i}] "${s.title.slice(0,30)}" _seedFallback=true`, s._seedFallback === true);
  assert(`D. seed[${i}] "${s.title.slice(0,30)}" _similarFallback 아님`, !s._similarFallback, `_similarFallback=${s._similarFallback}`);
});

/* ═══ Test E: 최종 5개 품질 기준 (regen ≥ 2) ═══ */
console.log('');
console.log('━━━ Test E) 최종 5개 품질 기준 (regenerateCount >= 2) ━━━');
const testE_out = processSubjects(test1Subjects.slice(), { regenerationContext:{ regenerateCount:2 }, archive: [] });
const testE_basics = testE_out.finalSubjects.filter(s => detectBasicOwnerAnxiety(s)).length;
const testE_epKeys = testE_out.finalSubjects.map(normalizeEpisodeKey);
const testE_uniqueKeys = new Set(testE_epKeys);
const testE_concreteOrSeed = testE_out.finalSubjects.filter(s => s._seedFallback || !detectBasicOwnerAnxiety(s)).length;
assert('E. similarFallback ≤ 1', testE_out.stats.similarFallbackUsed <= 1, `similarFallbackUsed=${testE_out.stats.similarFallbackUsed}`);
assert('E. basic_owner_anxiety 후보 0개', testE_basics === 0, `basics=${testE_basics}`);
assert('E. normalizedEpisodeKey 중복 없음', testE_uniqueKeys.size === testE_epKeys.length, `keys=${JSON.stringify(testE_epKeys)}`);
assert('E. 구체 사건형/seed 후보 ≥ 4개', testE_concreteOrSeed >= 4, `count=${testE_concreteOrSeed}`);

/* ═══════════════════════════════════════════════════════════════════
   Test F. 최종 후보 5개 보장 — 극단 상황에서 emergency phase 동작
   입력: LLM 후보 25개 대부분이 basic/rejected/archive로 제거되는 mock,
         seed bank의 거의 모든 epKey가 archive strong에 차단됨
   기대: finalSubjects.length === 5
         seedFallback 또는 emergency fallback으로 5개 채워짐
         similarFallback <= 1 기본 유지 (cap 1)
         basic_owner_anxiety 후보는 0개 또는 emergency 상황에서도 최소화
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test F) 극단 상황에서도 최종 후보 5개 보장 ━━━');
/* 25개 LLM 후보 중 keepers 2개만 남기고 나머지는 basic-owner-anxiety/broad-generic으로 제거되도록 구성 */
const testF_keepers = [
  { title:'F. 아니, 카드 비용을 인정 안 해준다고요?',     summary:'카드 결제 비용 인정이 안 되는 상황.', subject_category:'세무 리스크형', problem_axis:'카드·증빙·경비 관리',    episode_axis:'F-카드비용인정-keeper-AAA', trigger_moment:'세무사 안내', conflict_axis:'경비 인정', final_score:9.0, episode_diversity_score:8 },
  { title:'F. 매출은 늘었는데, 현금 흐름이 이상해요!',  summary:'매출 증가에도 통장 잔고가 모자란 상황.', subject_category:'사업 운영형',   problem_axis:'매출·정산·현금흐름',    episode_axis:'F-매출현금흐름-keeper-BBB', trigger_moment:'월말 결산',   conflict_axis:'매출/현금 차이', final_score:8.9, episode_diversity_score:8 },
];
/* basic-owner-anxiety + broad-generic으로 23개를 채워 hard 제거되도록 만든다 (regen=2 환경 가정). */
const testF_basics = [];
for (let i = 0; i < 23; i++) {
  testF_basics.push({
    title:'직원 뽑고 부담이 너무 늘었어요? ' + i,
    summary:'직원 채용 후 부담 증가로 어려운 상황입니다.',
    subject_category:'직원·노무형',
    problem_axis:'직원·급여·4대보험',
    episode_axis:'직원 채용 부담 증가 ' + i,
    trigger_moment:'첫 월급일',
    conflict_axis:'예상보다 큰 부담',
    final_score: 8.0 - i*0.1,
    episode_diversity_score: 6
  });
}
/* seed bank 대부분을 차단할 만큼 강한 archive 슬롯 — Test A의 보조 헬퍼와 같은 패턴 */
const testF_archive = [];
for (let i = 0; i < 5; i++) testF_archive.push({ kakaoTitle:'hard-pad-'+i, topic:'unrelated-'+i });
for (const item of buildAllSeedBlockingStrongSlots()) testF_archive.push(item);

const testF_out = processSubjects([...testF_keepers, ...testF_basics], {
  regenerationContext:{ regenerateCount:2 },
  archive: testF_archive
});
assert('F. finalSubjects.length === 5', testF_out.finalSubjects.length === 5,
  `length=${testF_out.finalSubjects.length} | final=${JSON.stringify(testF_out.finalSubjects.map(s=>({t:s.title, seed:!!s._seedFallback, sim:!!s._similarFallback, last:!!s._lastResort})))}`);
const testF_seedOrEmergency = testF_out.finalSubjects.filter(s => s._seedFallback || s._lastResort).length;
assert('F. seedFallback 또는 emergency lastResort로 보강됨 (≥ 3)', testF_seedOrEmergency >= 3,
  `seedOrEmergency=${testF_seedOrEmergency} | seedFallbackUsed=${testF_out.stats.seedFallbackUsed} | emergencyFillUsed=${testF_out.stats.emergencyFillUsed}`);
assert('F. similarFallback <= 1 (기본 cap 유지 — blocked pool은 similar이 아님)', testF_out.stats.similarFallbackUsed <= 1,
  `similarFallbackUsed=${testF_out.stats.similarFallbackUsed}`);
/* emergency 상황에서 blocked pool(basic)로 보강되면 basic 후보가 끼어들 수 있다.
   사용자 spec: "0개 또는 emergency 상황에서도 최소화". 5개를 보장하는 게 우선이므로
   _lastResort=true로 표시된 basic은 허용 (≤ 2). */
const testF_basicNonSeed = testF_out.finalSubjects.filter(s => detectBasicOwnerAnxiety(s) && !s._seedFallback).length;
const testF_basicNonLast = testF_out.finalSubjects.filter(s => detectBasicOwnerAnxiety(s) && !s._seedFallback && !s._lastResort).length;
assert('F. basic_owner_anxiety 후보 최소화 (emergency lastResort 제외 ≤ 1)', testF_basicNonLast <= 1,
  `basicNonLast=${testF_basicNonLast} | final=${JSON.stringify(testF_out.finalSubjects.map(s=>({t:s.title.slice(0,30), seed:!!s._seedFallback, last:!!s._lastResort})))}`);
assert('F. basic 후보 전체 ≤ 2 (emergency 한계)', testF_basicNonSeed <= 2, `basicCount=${testF_basicNonSeed}`);
assert('F. stats.finalCount === 5', testF_out.stats.finalCount === 5, `finalCount=${testF_out.stats.finalCount}`);

/* ═══════════════════════════════════════════════════════════════════
   Test G. 클라이언트 renderSubjects는 후보를 제거하지 않음
   index.html의 renderSubjects 함수 본문 안에서 subjects 배열을 splice/filter로
   "줄이는" 패턴이 있는지 정적 검사한다. (filter는 counting/매핑용은 허용)
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test G) 클라이언트 renderSubjects는 후보 제거 금지 ━━━');
const renderStart = html.indexOf('function renderSubjects()');
const renderEnd   = html.indexOf('\nfunction ', renderStart + 1);
const renderBody  = html.slice(renderStart, renderEnd > renderStart ? renderEnd : renderStart + 5000);
assert('G. renderSubjects 함수 본문 찾음', renderBody.length > 200, `length=${renderBody.length}`);
/* 절대 금지 패턴: data.subjects = data.subjects.filter, subjects.splice(*) — 배열 길이를 줄이는 호출 */
const forbidden = [
  /data\.subjects\s*=\s*data\.subjects\.filter/,
  /S\.subjectData\.subjects\s*=\s*[^;]*\.filter/,
  /data\.subjects\.splice\s*\(/,
  /S\.subjectData\.subjects\.splice\s*\(/,
  /subjects\s*=\s*subjects\.filter/,
];
forbidden.forEach((re, i) => {
  assert(`G. 금지 패턴 ${i+1} 미사용 (${re})`, !re.test(renderBody),
    `forbidden pattern matched: ${re}`);
});
/* counting/매핑용 filter는 허용되지만 결과를 data.subjects에 재대입하면 안 된다 */
const reassignRegex = /(data\.subjects|S\.subjectData\.subjects)\s*=\s*[^;]+\.filter\(/;
assert('G. data.subjects 재대입(.filter) 없음', !reassignRegex.test(renderBody), 'filter 결과를 subjects에 재대입하는 코드 존재');

/* ═══════════════════════════════════════════════════════════════════
   Test H. seed fallback 후보는 정상 후보로 표시
   - _seedFallback === true
   - _similarFallback === false (또는 undefined)
   - 상단 안내 count에 포함되지 않음
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test H) seed fallback 후보는 정상 후보로 표시 ━━━');
/* test1Subjects는 5개 모두 basic-owner-anxiety로 제거되어 seed bank로 5개 보강된다. */
const testH_out = processSubjects(test1Subjects.slice(), { regenerationContext:{ regenerateCount:2 }, archive: [] });
const testH_seeds = testH_out.finalSubjects.filter(s => s._seedFallback);
assert('H. seedFallback 후보 ≥ 1', testH_seeds.length >= 1, `seeds=${testH_seeds.length}`);
testH_seeds.forEach((s, i) => {
  assert(`H. seed[${i}] "${s.title.slice(0,30)}" _seedFallback === true`, s._seedFallback === true, `_seedFallback=${s._seedFallback}`);
  assert(`H. seed[${i}] "${s.title.slice(0,30)}" _similarFallback falsy`, !s._similarFallback, `_similarFallback=${s._similarFallback}`);
});
/* 상단 안내 count: similarFallback만 카운트. seed 후보는 포함 안 됨. */
const testH_similarCount = testH_out.finalSubjects.filter(s => s._similarFallback).length;
assert('H. seedFallback은 상단 안내 count에서 제외', testH_similarCount === testH_out.stats.similarFallbackUsed,
  `final-count=${testH_similarCount} stats=${testH_out.stats.similarFallbackUsed}`);
assert('H. 카드 "유사 후보" 배지 대상 아님 (similar < 2 이므로 배너 없음)', testH_similarCount < 2,
  `similarCount=${testH_similarCount}`);

/* ═══════════════════════════════════════════════════════════════════
   Test I. 최종 후보 2개만 표시되는 회귀 방지
   입력: LLM이 2개만 반환하고 archive가 거의 모든 seed를 strong으로 차단하는 시나리오.
         (사용자가 보고한 "2개만 표시" 상황 직접 재현)
   기대: finalSubjects.length === 5 (emergency phase 발동)
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Test I) 최종 후보 2개만 표시되는 회귀 방지 ━━━');
/* 사용자 보고 시나리오: keepers 2개만 통과. seed bank는 archive strong으로 거의 차단. */
const testI_input = [
  { title:'I. 아니, 카드 비용을 인정 안 해준다고요?',  summary:'카드 비용 인정 거부.', subject_category:'세무 리스크형', problem_axis:'카드·증빙·경비 관리', episode_axis:'I-카드비용인정-keeper-XYZ', trigger_moment:'세무사 안내', conflict_axis:'경비 인정', final_score:9.0, episode_diversity_score:8 },
  { title:'I. 매출은 늘었는데, 현금 흐름이 이상해요!', summary:'매출 증가 vs 현금 부족.', subject_category:'사업 운영형', problem_axis:'매출·정산·현금흐름', episode_axis:'I-매출현금흐름-keeper-ZZZ', trigger_moment:'월말 결산',   conflict_axis:'매출/현금', final_score:8.9, episode_diversity_score:8 },
];
const testI_archive = [];
for (let i = 0; i < 5; i++) testI_archive.push({ kakaoTitle:'hard-pad-'+i, topic:'unrelated-'+i });
for (const item of buildAllSeedBlockingStrongSlots()) testI_archive.push(item);
const testI_out = processSubjects(testI_input, { regenerationContext:{ regenerateCount:0 }, archive: testI_archive });
assert('I. finalSubjects.length === 5 (회귀 방지)', testI_out.finalSubjects.length === 5,
  `length=${testI_out.finalSubjects.length} | final=${JSON.stringify(testI_out.finalSubjects.map(s=>({t:s.title.slice(0,30), seed:!!s._seedFallback, sim:!!s._similarFallback, last:!!s._lastResort})))}`);
assert('I. stats.finalCount === 5', testI_out.stats.finalCount === 5, `finalCount=${testI_out.stats.finalCount}`);
/* 2개로 떨어지는 회귀를 직접 잡는 체크 */
assert('I. 최종 후보가 5개 미만(2~4)이 아님', testI_out.finalSubjects.length >= 5,
  `length=${testI_out.finalSubjects.length}`);

/* ═══════════════════════════════════════════════════════════════════
   Summary
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
if (totalFails === 0) {
  console.log('✅ 모든 테스트 통과');
  process.exit(0);
} else {
  console.log(`❌ ${totalFails}개 실패`);
  process.exit(1);
}
