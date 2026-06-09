// scripts/test-story-episode-lock.mjs — 3번 탭 사연 후보 episode lock 검증
//
// 검증 항목:
//  A. 예약금 subject → normalizeSubjectEpisodeKey = 예약금매출인식, guard allowed/banned 구성
//  B. 예약금 episode에 맞는 story 후보는 offEpisode=false
//  C. 예약금에서 벗어난 후보는 offEpisode=true
//  D. processStoriesWithEpisodeLock — off 후보 제거 + seed로 5개 보강, 모두 offEpisode=false
//
// 실행: node scripts/test-story-episode-lock.mjs

import fs from 'node:fs';

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
  normalizeSubjectEpisodeKey,
  getStoryEpisodeGuard,
  isStoryCandidateOffEpisode,
  processStoriesWithEpisodeLock,
  STORY_EPISODE_GUARDS,
  STORY_SEED_BANK,
} = new Function(helperBlock + `
  return {
    normalizeEpisodeKey,
    normalizeSubjectEpisodeKey,
    getStoryEpisodeGuard,
    isStoryCandidateOffEpisode,
    processStoriesWithEpisodeLock,
    STORY_EPISODE_GUARDS,
    STORY_SEED_BANK,
  };
`)();

let totalFails = 0;
function assert(name, cond, detail) {
  if (cond) { console.log('  ✓', name); }
  else { console.log('  ✗', name); if (detail) console.log('    →', detail); totalFails++; }
}

/* ── 선택 주제 (사용자 실제 예시) ── */
const reservationSubject = {
  title: '예약금은 받았는데 환불될 수도 있대요',
  summary: '예약금을 받았지만 환불 가능성이 남아 있어 매출 인식 시점이 애매한 상황입니다.',
  episode_axis: '예약금 매출 인식',
  trigger_moment: '예약 취소 메시지가 온 순간',
  conflict_axis: '받은 돈이지만 매출로 잡을지 환불 대비로 둘지 헷갈림',
  money_flow_axis: '예약금/선결제',
  resolution_angle: '예약금 매출 인식 시점 정리',
  problem_axis: '매출·정산·현금흐름',
  subject_category: '세무 리스크형',
};

/* ═══════════════════════════════════════════════════════════════════
   Story Test A. 예약금 subject guard 생성
   ═══════════════════════════════════════════════════════════════════ */
console.log('━━━ Story Test A) 예약금 subject guard 생성 ━━━');
const epKey = normalizeSubjectEpisodeKey(reservationSubject);
assert('normalizeSubjectEpisodeKey = 예약금매출인식', epKey === '예약금매출인식', `epKey=${epKey}`);
const guard = getStoryEpisodeGuard(reservationSubject);
assert('guard 존재', !!guard, 'guard=null');
const aBlob = (guard ? guard.allowed.join(' ') : '');
const bBlob = (guard ? guard.banned.join(' ') : '');
assert('allowed에 예약금', /예약금/.test(aBlob));
assert('allowed에 환불', /환불/.test(aBlob));
assert('allowed에 선결제', /선결제/.test(aBlob));
assert('allowed에 잔금', /잔금/.test(aBlob));
assert('allowed에 현금영수증', /현금영수증/.test(aBlob));
assert('allowed에 매출 인식', /매출 인식/.test(aBlob));
assert('banned에 정산(플랫폼/PG 정산 지연류)', /정산/.test(bBlob));
assert('banned에 수수료', /수수료/.test(bBlob));
assert('banned에 매출 감소', /매출 감소/.test(bBlob));
assert('banned에 직원 급여', /직원 급여/.test(bBlob));
assert('banned에 지원금', /지원금/.test(bBlob));

/* ═══════════════════════════════════════════════════════════════════
   Story Test B. 예약금에 맞는 story 후보는 통과 (offEpisode=false)
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Story Test B) 예약금 episode 안 후보 → offEpisode=false ━━━');
const onEpisodeStories = [
  { title: '예약금 받았는데, 취소하면 매출은 어떻게 되나요?', text: '행사 예약금을 먼저 받았는데 고객이 취소할 수도 있어서 매출로 잡아야 할지 헷갈려요.' },
  { title: '입금은 이번 달, 서비스는 다음 달이에요', text: '레슨 예약금을 이번 달에 받았는데 실제 서비스 제공은 다음 달이라 매출 시점이 애매해요.' },
  { title: '예약금 일부를 환불했는데 장부가 꼬였어요', text: '고객 취소로 예약금 일부를 돌려줬는데 처음 받은 금액과 환불 금액 정리가 헷갈려요.' },
  { title: '예약금에도 현금영수증을 끊어야 하나요?', text: '계좌로 예약금을 받았는데 고객이 현금영수증을 요청해서 발행 시점이 헷갈려요.' },
  { title: '예약금과 잔금이 나뉘어 들어왔어요', text: '예약금 먼저 받고 잔금은 서비스 당일 받는 구조라 매출 시점이 고민이에요.' },
];
onEpisodeStories.forEach(s => {
  const off = isStoryCandidateOffEpisode(s, guard);
  assert(`"${s.title.slice(0, 24)}" offEpisode=false`, off === false, `off=${off}`);
});

/* ═══════════════════════════════════════════════════════════════════
   Story Test C. 예약금에서 벗어난 후보는 제외 (offEpisode=true)
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Story Test C) 예약금 episode 벗어난 후보 → offEpisode=true ━━━');
const offEpisodeStories = [
  { title: '정산이 늦어져서 곤란합니다', text: '플랫폼 정산이 늦어져서 자금이 곤란해요.' },
  { title: '수익이 줄어든 이유를 모르겠어요', text: '매출은 비슷한데 수익이 줄어든 이유를 모르겠어요.' },
  { title: '이번 달 매출은 좋은데 통장 잔고가 없어요', text: '매출은 좋은데 통장 잔고가 비어 있어요.' },
  { title: '직원 급여 때문에 예약금을 써버렸어요', text: '직원 급여가 부담돼서 받은 예약금을 먼저 써버렸어요.' },
  { title: '지원금 신청도 같이 해야 하나요?', text: '지원금 신청을 같이 해야 하는지 고민이에요.' },
];
offEpisodeStories.forEach(s => {
  const off = isStoryCandidateOffEpisode(s, guard);
  assert(`"${s.title.slice(0, 24)}" offEpisode=true`, off === true, `off=${off}`);
});

/* ═══════════════════════════════════════════════════════════════════
   Story Test D. 예약금 story fallback — 5개 중 4개 off → seed 보강
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Story Test D) off 후보 제거 + seed로 5개 보강 ━━━');
const mixedStories = [
  { title: '예약금이랑 잔금을 따로 받는데 매출은 언제 잡나요?', text: '예약금 먼저 받고 잔금은 나중에 받는데 매출 인식 시점이 헷갈려요.' }, /* on-episode 1개 */
  { title: '정산이 늦어져서 곤란합니다', text: '플랫폼 정산이 늦어서 곤란해요.' },                                       /* off */
  { title: '직원 급여가 너무 부담돼요', text: '직원 급여 때문에 통장이 비어요.' },                                          /* off */
  { title: '지원금 신청은 어떻게 하나요?', text: '소상공인 지원금 신청 방법이 궁금해요.' },                                  /* off */
  { title: '임대차 계약이 바뀌면 세금도 바뀌나요?', text: '월세 계약 갱신하면서 세금이 걱정돼요.' },                          /* off */
];
const lock = processStoriesWithEpisodeLock(mixedStories, reservationSubject);
assert('guarded=true', lock.stats.guarded === true, `guarded=${lock.stats.guarded}`);
assert('episodeKey=예약금매출인식', lock.stats.episodeKey === '예약금매출인식', `key=${lock.stats.episodeKey}`);
assert('최종 story 후보 5개 유지', lock.stories.length === 5, `length=${lock.stories.length}`);
assert('off 후보 4개 제거', lock.stats.offEpisodeRemoved === 4, `removed=${lock.stats.offEpisodeRemoved}`);
assert('seed로 4개 보강', lock.stats.seedFallbackUsed === 4, `seed=${lock.stats.seedFallbackUsed}`);
const allOnEpisode = lock.stories.every(s => !isStoryCandidateOffEpisode(s, guard));
assert('최종 후보 모두 offEpisode=false', allOnEpisode,
  JSON.stringify(lock.stories.map(s => ({ t: s.title.slice(0, 20), off: isStoryCandidateOffEpisode(s, guard) }))));
const seedCount = lock.stories.filter(s => s._storySeedFallback).length;
assert('seed fallback 후보 4개 포함', seedCount === 4, `seedCount=${seedCount}`);

/* ═══════════════════════════════════════════════════════════════════
   Story Test E. seed bank 정합성 — 예약금 seed는 모두 on-episode
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Story Test E) 예약금 seed bank 정합성 ━━━');
const resSeeds = STORY_SEED_BANK['예약금매출인식'] || [];
assert('예약금 seed ≥ 5개', resSeeds.length >= 5, `length=${resSeeds.length}`);
resSeeds.forEach((seed, i) => {
  assert(`seed[${i}] "${(seed.title || '').slice(0, 24)}" offEpisode=false`,
    isStoryCandidateOffEpisode(seed, guard) === false, `off=${isStoryCandidateOffEpisode(seed, guard)}`);
});

/* ═══════════════════════════════════════════════════════════════════
   Story Test F. guard 없는 주제는 필터링하지 않고 통과
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Story Test F) guard 미정의 주제는 그대로 통과 ━━━');
const unknownSubject = { title: '뭔가 애매한 주제', summary: '특정 episode로 분류 안 되는 주제', episode_axis: 'ZZZ-미분류-XYZ' };
const unknownStories = [
  { title: '사연 1', text: '내용 1' }, { title: '사연 2', text: '내용 2' },
  { title: '사연 3', text: '내용 3' }, { title: '사연 4', text: '내용 4' },
  { title: '사연 5', text: '내용 5' },
];
const unknownLock = processStoriesWithEpisodeLock(unknownStories, unknownSubject);
assert('guard 없으면 guarded=false', unknownLock.stats.guarded === false, `guarded=${unknownLock.stats.guarded}`);
assert('guard 없으면 5개 그대로', unknownLock.stories.length === 5, `length=${unknownLock.stories.length}`);

/* ═══════════════════════════════════════════════════════════════════ */
console.log('');
if (totalFails === 0) { console.log('✅ 모든 테스트 통과'); process.exit(0); }
else { console.log(`❌ ${totalFails}개 실패`); process.exit(1); }
