// scripts/test-tip-quiz-news-flow.mjs — 꿀팁 직접입력 / 퀴즈 다양성 / 뉴스 이동·요약 / 오프닝 검증
//
// 검증 항목:
//  Tip A. 직접 입력 대처방안형 → tip_input_type = 대처방안/실무 체크리스트형 (공고형 아님)
//  Tip B. 지원사업형 → tip_input_type = 지원사업/공고형
//  Quiz A. rejectedQuizHistory 유사(모두 확인) 퀴즈 차단
//  Quiz B. 자동결제 quiz_axis 4개 이상 다양화
//  News A. 뉴스 브리핑 탭 이동 (10번, 필수 플로우 아님 — 꿀팁 통합으로 번호 -1)
//  News B. 뉴스 브리핑 프롬프트 순수 요약 구조 (배경/정책변화/영향·우려/결론·전망, 조언 금지)
//  Opening A. 오프닝 가이드 (가벼운 인삿말 / 핵심 episode 관통 / 3~5문장 / 공포·세법설명 시작 금지)
//
// 실행: node scripts/test-tip-quiz-news-flow.mjs

import fs from 'node:fs';

/* ── server 헬퍼 추출 ── */
const serverSrc = fs.readFileSync('api/generate.js', 'utf8');
const startIdx = serverSrc.indexOf('/* TEST_HELPERS_START');
const endIdx   = serverSrc.indexOf('/* TEST_HELPERS_END */');
if (startIdx < 0 || endIdx < 0) throw new Error('TEST_HELPERS 마커 없음');
const helperBlock = serverSrc.slice(startIdx, endIdx);

const {
  classifyTipInputType,
  detectAllConfirmAnswer,
  isQuizDuplicateOfHistory,
  suggestQuizAxes,
  summarizeQuizHistoryForPrompt,
} = new Function(helperBlock + `
  return {
    classifyTipInputType,
    detectAllConfirmAnswer,
    isQuizDuplicateOfHistory,
    suggestQuizAxes,
    summarizeQuizHistoryForPrompt,
  };
`)();

const html      = fs.readFileSync('index.html', 'utf8');
const newsSrc   = fs.readFileSync('api/fetch-news.js', 'utf8');

let totalFails = 0;
function assert(name, cond, detail) {
  if (cond) { console.log('  ✓', name); }
  else { console.log('  ✗', name); if (detail) console.log('    →', detail); totalFails++; }
}

/* ═══════════════════════════════════════════════════════════════════
   Tip Test A. 직접 입력 대처방안형 분류
   ═══════════════════════════════════════════════════════════════════ */
console.log('━━━ Tip Test A) 직접 입력 대처방안/체크리스트형 분류 ━━━');
const tipInputA = '플랫폼 손실보상 승인 전 법적 대응 권리 확인, 문제가 되었던 번호·주소·특이 요청사항을 POS 메모나 장부에 기록, '
  + '허위 민원/반복 피해 방지, 남은 음식 회수, 대표적 환불 유형 파악';
const typeA = classifyTipInputType(tipInputA);
assert('tip_input_type = 대처방안/실무 체크리스트형', typeA === '대처방안/실무 체크리스트형', `type=${typeA}`);
assert('지원사업/공고형으로 분류되지 않음', typeA !== '지원사업/공고형', `type=${typeA}`);

/* ═══════════════════════════════════════════════════════════════════
   Tip Test B. 지원사업형은 공고형
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Tip Test B) 지원사업형 → 공고형 ━━━');
const tipInputB = '지원대상: 강원 소재 소상공인 / 신청기간: 2026.07.01 ~ 07.31 / '
  + '신청방법: 기업마당 온라인 접수 / 지원금액: 최대 300만 원';
const typeB = classifyTipInputType(tipInputB);
assert('tip_input_type = 지원사업/공고형', typeB === '지원사업/공고형', `type=${typeB}`);

/* 빈 입력 처리 */
assert('빈 입력 → 미상', classifyTipInputType('') === '미상', classifyTipInputType(''));

/* ═══════════════════════════════════════════════════════════════════
   Quiz Test A. 재생성 history 유사 퀴즈 차단
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Quiz Test A) rejectedQuizHistory 유사 퀴즈 차단 ━━━');
const rejectedQuizHistory = [
  {
    question: '자동결제 서비스로 인해 매출이 줄어들지는 않았는지 확인해야 할 것은?',
    choices: ['빠진 매출·자료', '신고서 접수 여부', '접수증', '모두 확인'],
    answer: 3,
    explanation: '모두 확인해야 합니다.',
    quiz_axis: '확인 항목 점검',
    answer_type: '모두 확인',
    correct_choice_pattern: '모두 확인',
  },
];
/* history의 정답이 "모두 확인" 구조임을 감지 */
assert('history 퀴즈 정답이 "모두 확인" 감지', detectAllConfirmAnswer(rejectedQuizHistory[0]) === true);

/* 같은 quiz_axis 후보 → 차단 */
const sameAxisQuiz = {
  question: '자동결제로 빠질 수 있는 비용, 무엇을 체크해야 할까요?',
  choices: ['누락된 매출', '접수증', '신고서 접수 여부', '모두 확인'],
  answer: 3, quiz_axis: '확인 항목 점검', answer_type: '모두 확인', correct_choice_pattern: '모두 확인',
};
assert('같은 quiz_axis 재생성 → 중복 차단', isQuizDuplicateOfHistory(sameAxisQuiz, rejectedQuizHistory) === true);
assert('"모두 확인" 정답 반복 → 중복 차단', detectAllConfirmAnswer(sameAxisQuiz) === true);

/* 다른 axis라도 "모두 확인" 정답 반복이면 차단 */
const repeatAllConfirm = {
  question: '자동결제 비용 처리 시 챙길 것은?',
  choices: ['사업용 카드 확인', '개인카드 확인', '증빙 보관', '모두 확인'],
  answer: 3, quiz_axis: '비용 처리 방법', answer_type: '모두 확인', correct_choice_pattern: '모두 확인',
};
assert('다른 axis라도 "모두 확인" 반복 → 차단', isQuizDuplicateOfHistory(repeatAllConfirm, rejectedQuizHistory) === true);

/* 다른 학습축 + 단일 정답 → 통과 */
const freshQuiz = {
  question: '자동결제 구독료를 개인카드로 냈다면 가장 먼저 확인할 것은?',
  choices: ['사업 관련성과 증빙 주체', '오늘 날씨', '직원 근무표', '간판 색깔'],
  answer: 0, quiz_axis: '증빙 주체', answer_type: '단일 정답', correct_choice_pattern: '단일 항목',
};
assert('다른 학습축 + 단일정답 → 통과', isQuizDuplicateOfHistory(freshQuiz, rejectedQuizHistory) === false);
assert('fresh 퀴즈는 "모두 확인" 정답 아님', detectAllConfirmAnswer(freshQuiz) === false);

/* history 요약 블록이 재생성 회피 규칙을 포함 */
const histBlock = summarizeQuizHistoryForPrompt(rejectedQuizHistory);
assert('history 블록에 quiz_axis 회피 명시', /quiz_axis/.test(histBlock) && /다른 학습 포인트/.test(histBlock));
assert('history 블록에 "모두 확인" 반복 금지 명시', /모두 확인/.test(histBlock));

/* ═══════════════════════════════════════════════════════════════════
   Quiz Test B. 자동결제 quiz_axis 다양화
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Quiz Test B) 자동결제 quiz_axis 4개 이상 다양화 ━━━');
const axes = suggestQuizAxes({ subjectTitle: '자동결제 서비스가 대표 개인 명의로 빠져나가요', problemAxis: '카드·증빙·경비 관리' });
assert('자동결제 quiz_axis 후보 ≥ 4개', axes.length >= 4, `axes=${JSON.stringify(axes)}`);
assert('quiz_axis 서로 다름 (중복 없음)', new Set(axes).size === axes.length, `axes=${JSON.stringify(axes)}`);
const axisBlob = axes.join(' ');
assert('사업용/개인용 결제수단 구분 포함', /사업용\/개인용 결제수단 구분/.test(axisBlob));
assert('증빙 주체 포함', /증빙 주체/.test(axisBlob));
assert('장부 기록 축 포함', /장부 기록/.test(axisBlob));
assert('비용 인정 요건 포함', /비용 인정 요건/.test(axisBlob));
assert('고정비 증가 체크 포함', /고정비 증가/.test(axisBlob));
/* 비-자동결제 주제는 빈 배열 */
assert('비-자동결제 주제는 빈 후보', suggestQuizAxes({ subjectTitle: '직원 급여 관련 주제' }).length === 0);

/* ═══════════════════════════════════════════════════════════════════
   News Test A. 뉴스 브리핑 탭 이동 (11번, 필수 플로우 아님)
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ News Test A) 뉴스 브리핑 탭 이동 ━━━');
/* 탭 버튼: 10 뉴스 브리핑 → goTab(9) (꿀팁 후보+원고 통합으로 -1) */
assert('뉴스 브리핑 탭이 10번(goTab(9))', /goTab\(9\)">10 뉴스 브리핑/.test(html),
  'goTab(9)">10 뉴스 브리핑 패턴 없음');
/* 핵심 플로우(세무퀴즈가 6번)는 뉴스 앞에 위치 */
assert('세무퀴즈가 6번(goTab(5))', /goTab\(5\)">6 세무퀴즈/.test(html));
assert('오프닝이 7번(goTab(6))', /goTab\(6\)">7 오프닝/.test(html));
/* 세무퀴즈(5) 다음 버튼이 오프닝(6)으로 — 뉴스 거치지 않음 */
assert('세무퀴즈 → 오프닝 직접 연결 (completeTab(5,6))', /completeTab\(5,6\)/.test(html));
/* 뉴스 패널 다음 버튼은 아카이브로(completeTab(9,10)) */
assert('뉴스 → 아카이브 연결 (completeTab(9,10))', /completeTab\(9,10\)/.test(html));
/* 뉴스 탭은 항상 잠금 해제 (선택 탭) — unlockedTabs에 9 포함, 꿀팁(4)도 항상 해제 */
assert('초기 unlockedTabs에 4(꿀팁)·9(뉴스) 포함', /unlockedTabs:\s*\[0,\s*4,\s*9,\s*10\]/.test(html),
  'unlockedTabs 초기값이 [0, 4, 9, 10]이 아님');
/* 뉴스 패널 다음 버튼에 disabled 없음 (없어도 진행 가능) */
const newsNextMatch = html.match(/<button class="btn-next" id="next7"[^>]*>/);
assert('뉴스 다음 버튼 존재', !!newsNextMatch, 'next7 버튼 없음');
assert('뉴스 다음 버튼이 disabled 아님 (뉴스 없이도 진행 가능)',
  !!newsNextMatch && !/disabled/.test(newsNextMatch[0]), newsNextMatch ? newsNextMatch[0] : '');
/* 오프닝/미리보기/제목이 뉴스 없이 도달 가능 — 잠금 해제 체인이 5→6→7→8 */
assert('오프닝 → 미리보기 (completeTab(6,7))', /completeTab\(6,7\)/.test(html));
assert('미리보기 → 제목 (completeTab(7,8))', /completeTab\(7,8\)/.test(html));
assert('제목 → 뉴스 (completeTab(8,9))', /completeTab\(8,9\)/.test(html));

/* ═══════════════════════════════════════════════════════════════════
   News Test B. 뉴스 브리핑 순수 요약 구조
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ News Test B) 뉴스 브리핑 순수 요약 구조 ━━━');
assert('배경/문제 구조 포함', /배경\/문제/.test(newsSrc));
assert('사건/정책 변화 구조 포함', /사건\/정책 변화/.test(newsSrc));
assert('영향/우려 구조 포함', /영향\/우려/.test(newsSrc));
assert('결론/전망 구조 포함', /결론\/전망/.test(newsSrc));
assert('해시태그 2~4개 안내', /해시태그 2~4개/.test(newsSrc));
assert('순수 기사 요약 방향 명시', /순수.*요약|순수하게 요약|기사를 "순수하게 요약"|순수 기사 요약/.test(newsSrc));
assert('"사장님은 반드시 ~하세요" 류 조언 금지 명시', /사장님은 반드시/.test(newsSrc) && /조언/.test(newsSrc));
assert('의견/해석 삽입 금지 명시', /의견 삽입|해석.*삽입|생각·해석·의견 삽입/.test(newsSrc));
assert('제목만 보고 쓴 1~2문장 요약 금지', /제목만 보고/.test(newsSrc));

/* ═══════════════════════════════════════════════════════════════════
   Opening Test A. 오프닝 가이드 반영
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ Opening Test A) 오프닝 가이드 반영 ━━━');
assert('가벼운 인삿말 가이드 포함', /가벼운 인삿말|밥 먹었어/.test(serverSrc));
assert('핵심 episode 관통 명시', /핵심 episode를 정확히 찔|핵심 episode/.test(serverSrc));
assert('3~5문장 이내 명시', /3~5문장/.test(serverSrc));
assert('세법 설명으로 시작 금지', /세법 설명으로 시작하지/.test(serverSrc));
assert('과한 공포/경고 시작 금지', /과한 공포\/경고로 시작하지/.test(serverSrc));
assert('"오늘은 ~에 대해 알아보겠습니다" 지양', /오늘은 ~에 대해 알아보겠습니다/.test(serverSrc));
assert('사연/꿀팁/퀴즈 연결 명시', /사연\/꿀팁\/퀴즈와 연결/.test(serverSrc));

/* ═══════════════════════════════════════════════════════════════════ */
console.log('');
if (totalFails === 0) { console.log('✅ 모든 테스트 통과'); process.exit(0); }
else { console.log(`❌ ${totalFails}개 실패`); process.exit(1); }
