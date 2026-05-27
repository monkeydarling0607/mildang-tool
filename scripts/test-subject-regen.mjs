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

console.log('');
if (totalFails === 0) {
  console.log('✅ 모든 테스트 통과');
  process.exit(0);
} else {
  console.log(`❌ ${totalFails}개 실패`);
  process.exit(1);
}
