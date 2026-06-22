// scripts/test-tip-unified-flow.mjs — 꿀팁 후보+원고 통합 / 탭 번호 / 독립 실행 / 참고 자료 입력 / 입력 유형별 원고
//
// 검증 항목:
//  UI A. 꿀팁 후보+원고가 하나의 "꿀팁" 탭으로 통합 (별도 6 꿀팁 원고 탭 제거)
//  UI B. 탭 번호 재정렬 (5 꿀팁 / 6 세무퀴즈 / … / 11 아카이브)
//  UI C. 꿀팁 탭 독립 실행 — nav에서 잠금 아님 + unlockedTabs에 4 포함
//  UI D. 참고 자료 입력 명칭 (참고 URL/PDF/직접 입력하기/참고 자료로 꿀팁 만들기)
//  UI E. 직접 입력 아코디언 (t5benefitPasteWrap 기본 접힘 + toggleBenefitPaste)
//  UI F. 한 화면 흐름 — 후보(btn-tips)·참고자료(btn-extract-benefit)·원고(btn-tip-draft)·t6area·next4
//  API A. extract-benefit — 정보성 URL 거부 제거(not_official 없음) + getSourceInfo + input_type 분류
//  API B. extract-benefit — URL 못 읽으면 직접 입력 안내 / raw_user_input 전달
//  API C. generate.js tip_draft — 입력 유형별 포맷(DIRECT_FORMATS) + p.tipInputType 우선
//  LOGIC A. 정보성/대처방안 텍스트는 공고형으로 분류되지 않음
//
// 실행: node scripts/test-tip-unified-flow.mjs

import fs from 'node:fs';

const html        = fs.readFileSync('index.html', 'utf8');
const genSrc      = fs.readFileSync('api/generate.js', 'utf8');
const benefitSrc  = fs.readFileSync('api/extract-benefit.js', 'utf8');

/* classifyTipInputType 추출 (TEST_HELPERS 블록) */
const startIdx = genSrc.indexOf('/* TEST_HELPERS_START');
const endIdx   = genSrc.indexOf('/* TEST_HELPERS_END */');
if (startIdx < 0 || endIdx < 0) throw new Error('TEST_HELPERS 마커 없음');
const helperBlock = genSrc.slice(startIdx, endIdx);
const { classifyTipInputType } = new Function(helperBlock + 'return { classifyTipInputType };')();

let totalFails = 0;
function assert(name, cond, detail) {
  if (cond) { console.log('  ✓', name); }
  else { console.log('  ✗', name); if (detail) console.log('    →', detail); totalFails++; }
}

/* ═══════════════════════════════════════════════════════════════════
   UI Test A) 꿀팁 후보+원고 통합 — 별도 원고 탭 제거
   ═══════════════════════════════════════════════════════════════════ */
console.log('━━━ UI Test A) 꿀팁 후보+원고 통합 ━━━');
assert('탭 버튼 "5 꿀팁" 단일 존재', /goTab\(4\)">5 꿀팁<\/button>/.test(html));
assert('"꿀팁 후보" 탭 버튼 제거', !/>5 꿀팁 후보</.test(html));
assert('"꿀팁 원고" 탭 버튼 제거', !/>6 꿀팁 원고</.test(html));
assert('별도 꿀팁 원고 패널(p5) 제거', !/id="p5"/.test(html));
assert('next5 다음 버튼 제거', !/id="next5"/.test(html));

/* ═══════════════════════════════════════════════════════════════════
   UI Test B) 탭 번호 재정렬
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ UI Test B) 탭 번호 재정렬 ━━━');
assert('6 세무퀴즈(goTab(5))', /goTab\(5\)">6 세무퀴즈/.test(html));
assert('7 오프닝(goTab(6))',   /goTab\(6\)">7 오프닝/.test(html));
assert('8 미리보기(goTab(7))', /goTab\(7\)">8 미리보기/.test(html));
assert('9 제목(goTab(8))',     /goTab\(8\)">9 제목/.test(html));
assert('10 뉴스 브리핑(goTab(9))', /goTab\(9\)">10 뉴스 브리핑/.test(html));
assert('11 아카이브(goTab(10))',   /goTab\(10\)">11 아카이브/.test(html));
assert('탭 12 제거 (goTab(11) 없음)', !/goTab\(11\)/.test(html));
/* 아카이브 진입 인덱스 갱신 */
assert('아카이브 렌더 인덱스 i === 10', /if \(i === 10\) renderArchive\(\)/.test(html));

/* ═══════════════════════════════════════════════════════════════════
   UI Test C) 꿀팁 탭 독립 실행
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ UI Test C) 꿀팁 탭 독립 실행 ━━━');
/* 꿀팁(goTab(4)) 버튼은 locked 클래스가 없어야 함 */
const tipBtnMatch = html.match(/<button class="tb([^"]*)"\s+onclick="goTab\(4\)">5 꿀팁<\/button>/);
assert('꿀팁 탭 버튼 존재', !!tipBtnMatch, '꿀팁 nav 버튼 매칭 실패');
assert('꿀팁 탭 버튼이 locked 아님', !!tipBtnMatch && !/locked/.test(tipBtnMatch[1]), tipBtnMatch ? tipBtnMatch[1] : '');
assert('초기 unlockedTabs = [0, 4, 9, 10]', /unlockedTabs:\s*\[0,\s*4,\s*9,\s*10\]/.test(html));
assert('하드리셋 unlockedTabs = [0, 4, 9, 10]', /unlockedTabs\s*=\s*\[0,\s*4,\s*9,\s*10\]/.test(html));
/* 잠금 적용 시 4·9·10은 제외 */
assert('잠금 제외 조건에 4 포함', /idx !== 4 && idx !== 9 && idx !== 10/.test(html));
/* 주제 없을 때 안내(독립 사용) 문구 */
assert('주제 없이 참고 자료 안내 문구', /참고 자료 기준으로 꿀팁을 만들 수 있습니다/.test(html));
/* callTips 함수 본문만 잘라서 — 하드블록 alert 없이 안내 렌더로 대체됐는지 확인 */
const callTipsBody = (html.match(/async function callTips\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
assert('callTips가 주제 없을 때 alert 하드블록하지 않음', !!callTipsBody && !/alert\(/.test(callTipsBody), 'callTips 내부에 alert 존재');
assert('callTips 주제 없을 때 참고 자료 안내(주제 선정 후 사용 가능)', /주제 선정 후 사용 가능/.test(callTipsBody));

/* ═══════════════════════════════════════════════════════════════════
   UI Test D) 참고 자료 입력 명칭
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ UI Test D) 참고 자료 입력 명칭 ━━━');
assert('생성 버튼 문구 "참고 자료로 꿀팁 만들기"', /참고 자료로 꿀팁 만들기/.test(html));
assert('필드 "참고 URL"', /<div class="fl">참고 URL<\/div>/.test(html));
assert('필드 "참고 PDF"', /<div class="fl">참고 PDF<\/div>/.test(html));
assert('"공고 URL" 명칭 제거', !/\(선택\) 공고 URL/.test(html));
assert('"공고 PDF" 명칭 제거', !/\(선택\) 공고 PDF/.test(html));
assert('"직접 공고 입력" 명칭 제거', !/직접 공고 입력/.test(html));
assert('버튼 "참고 자료로 꿀팁 만들기"', /id="btn-extract-benefit"[^>]*>참고 자료로 꿀팁 만들기/.test(html));
assert('정보성 가이드 안내 문구', /정보성 가이드, 체크리스트, 대처방안도 사용할 수 있습니다/.test(html));

/* ═══════════════════════════════════════════════════════════════════
   UI Test E) 직접 입력 아코디언
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ UI Test E) 직접 입력 아코디언 ━━━');
assert('아코디언 토글 "직접 입력하기"', /toggleBenefitPaste\(\)[\s\S]*?직접 입력하기/.test(html));
assert('toggleBenefitPaste 함수 정의', /function toggleBenefitPaste\(\)/.test(html));
const pasteWrapMatch = html.match(/<div id="t5benefitPasteWrap" style="([^"]*)"/);
assert('t5benefitPasteWrap 기본 접힘(display:none)', !!pasteWrapMatch && /display:none/.test(pasteWrapMatch[1]), pasteWrapMatch ? pasteWrapMatch[1] : '');
assert('직접 입력 설명(대체 입력 의미)', /URL이나 PDF를 읽지 못한 경우, 또는 직접 정리한 내용/.test(html));
assert('직접 입력 placeholder 일반화', /기사\/공고\/가이드\/체크리스트\/대처방안을 붙여넣으세요/.test(html));

/* ═══════════════════════════════════════════════════════════════════
   UI Test F) 한 화면 흐름 (후보→선택→참고자료→원고→다음)
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ UI Test F) 한 화면 흐름 ━━━');
assert('꿀팁 후보 생성 버튼(btn-tips)', /id="btn-tips"/.test(html));
assert('참고 자료 버튼(btn-extract-benefit)', /id="btn-extract-benefit"/.test(html));
assert('원고 생성 버튼(btn-tip-draft)', /id="btn-tip-draft"/.test(html));
assert('원고 영역(t6area) 같은 패널에 존재', /id="t6area"/.test(html));
assert('다음 버튼 next4 → completeTab(4,5)', /id="next4"[^>]*onclick="completeTab\(4,5\)"/.test(html));
/* 다음은 원고 생성 후 활성화 (후보 선택만으로는 비활성) */
assert('원고 생성 후 next4 활성화 복원', /if \(S\.tipDraft\)\s*setBtn\('next4', false\)/.test(html));
assert('후보 선택만으로 next4 활성화하지 않음', !/if \(S\.tip\)\s*setBtn\('next4', false\)/.test(html));

/* ═══════════════════════════════════════════════════════════════════
   UI Test G) 꿀팁 탭 단순화 (상단 메모 삭제 + 직접 만들기 보조 아코디언)
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ UI Test G) 꿀팁 탭 단순화 ━━━');
/* 1) 상단 "참고 뉴스·정책 메모" 입력란 완전 삭제 */
assert('"참고 뉴스·정책 메모" 라벨 제거', !/참고 뉴스·정책 메모/.test(html));
assert('t5newsInput textarea 제거', !/id="t5newsInput"/.test(html));
assert('tipUserNews state 참조 제거', !/tipUserNews/.test(html));
assert('userNewsInput payload 참조 제거', !/userNewsInput/.test(html));
/* 2) 하단 섹션명 → "[선택] 직접 꿀팁 만들기" 토글 */
assert('보조 섹션 토글 "[선택] 직접 꿀팁 만들기"', /toggleBenefitSection\(\)[\s\S]*?\[선택\] 직접 꿀팁 만들기/.test(html));
assert('toggleBenefitSection 함수 정의', /function toggleBenefitSection\(\)/.test(html));
assert('"\\[참고\\] 참고 자료로 꿀팁 만들기" 헤더(ph-title) 제거', !/<span class="ph-title"[^>]*>참고 자료로 꿀팁 만들기<\/span>/.test(html));
/* 3) 직접 만들기 영역 기본 접힘 */
const benefitSectionMatch = html.match(/<div id="t5benefitSection" style="([^"]*)"/);
assert('t5benefitSection 기본 접힘(display:none)', !!benefitSectionMatch && /display:none/.test(benefitSectionMatch[1]), benefitSectionMatch ? benefitSectionMatch[1] : '');
/* 4) 참고 URL/PDF/직접입력/버튼이 보조 섹션 안에 위치 (접힘 시 숨김) */
const sectionBody = (html.match(/<div id="t5benefitSection"[\s\S]*?<div id="t6area"/) || [''])[0];
assert('참고 URL 입력이 보조 섹션 내부', /id="t5benefitUrl"/.test(sectionBody));
assert('참고 PDF 입력이 보조 섹션 내부', /id="t5benefitPdf"/.test(sectionBody));
assert('직접 입력 textarea가 보조 섹션 내부', /id="t5benefitPaste"/.test(sectionBody));
assert('참고 자료 생성 버튼이 보조 섹션 내부', /id="btn-extract-benefit"/.test(sectionBody));
assert('입력 초기화 버튼이 보조 섹션 내부', /resetBenefitInput\(\)/.test(sectionBody));
/* 5) 메인 흐름: t5area(후보) → 보조 토글 → t6area(원고) 순서 */
const idxT5area   = html.indexOf('id="t5area"');
const idxToggle   = html.indexOf('id="btn-benefit-toggle"');
const idxT6area   = html.indexOf('id="t6area"');
assert('순서: 후보(t5area) → 직접만들기 토글 → 원고(t6area)', idxT5area > 0 && idxToggle > idxT5area && idxT6area > idxToggle,
  `t5area=${idxT5area}, toggle=${idxToggle}, t6area=${idxT6area}`);
/* 6) 복원 시 직접 만든 결과 있으면 자동 펼침 / 초기화 시 접힘 */
assert('복원 시 benefitTip 있으면 보조 섹션 펼침', /renderBenefitTip\(\);\s*setBenefitSectionOpen\(true\)/.test(html));
assert('hardReset에서 보조 섹션 접힘', /setBenefitSectionOpen\(false\)/.test(html));

/* ═══════════════════════════════════════════════════════════════════
   API Test A) extract-benefit — 정보성 URL 허용 + 분류
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ API Test A) extract-benefit 정보성 URL 허용 ━━━');
assert('not_official 거부 제거', !/error_type:\s*'not_official'/.test(benefitSrc));
assert('getSourceInfo 도입(차단 안 함)', /function getSourceInfo\(/.test(benefitSrc));
assert('네이버페이 가이드 등 정보성 도메인 허용', /pay\.naver\.com/.test(benefitSrc));
assert('입력 유형 분류(input_type) 프롬프트', /input_type/.test(benefitSrc) && /정보성 가이드형/.test(benefitSrc));
assert('공고로 강제 변환 금지 지시', /지원사업 공고처럼 바꾸지 마세요/.test(benefitSrc));
assert('없는 항목 임의 생성 금지 지시', /임의로 만들지 마세요/.test(benefitSrc));
assert('공고형만 benefit_facts 사용', /isPolicy \? bf : null/.test(benefitSrc));

/* ═══════════════════════════════════════════════════════════════════
   API Test B) extract-benefit — 읽기 실패 안내 + raw_user_input
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ API Test B) 읽기 실패 안내 + 원문 전달 ━━━');
assert('URL 읽기 실패 시 직접 입력 안내', /자동으로 읽지 못했습니다[\s\S]*?직접 입력하기\]에 붙여넣어/.test(benefitSrc));
assert('raw_user_input(원문) 전달', /raw_user_input:\s*\(inputText/.test(benefitSrc));
assert('클라이언트가 raw_user_input 폴백 사용', /paste \|\| S\.benefitTip\.raw_user_input/.test(html));
assert('tip_draft에 tipInputType 전달', /tipInputType:\s*\(S\.tip && S\.tip\.input_type\)/.test(html));

/* ═══════════════════════════════════════════════════════════════════
   API Test C) generate.js tip_draft — 입력 유형별 포맷
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ API Test C) tip_draft 입력 유형별 포맷 ━━━');
assert('DIRECT_FORMATS 맵 도입', /DIRECT_FORMATS\s*=\s*\{/.test(genSrc));
assert('정보성 가이드형 포맷', /'정보성 가이드형':/.test(genSrc) && /핵심 상황/.test(genSrc));
assert('대처방안/체크리스트형 포맷', /'대처방안\/체크리스트형':/.test(genSrc) && /남겨야 할 기록/.test(genSrc) && /반복 피해를 줄이려면/.test(genSrc));
assert('정보성 가이드형 체크리스트 항목', /바로 할 수 있는 체크리스트/.test(genSrc));
assert('p.tipInputType 우선 사용', /p\.tipInputType[\s\S]*?classifyTipInputType\(rawInput\)/.test(genSrc));
assert('공고형이 아니면 원문 보존 모드', /tipInputType !== '지원사업\/공고형'/.test(genSrc));

/* ═══════════════════════════════════════════════════════════════════
   LOGIC Test A) 정보성/대처방안 텍스트는 공고형 아님
   ═══════════════════════════════════════════════════════════════════ */
console.log('');
console.log('━━━ LOGIC Test A) 분류 — 정보성/대처방안은 공고형 아님 ━━━');
const infoGuide = '네이버페이 사업자 회원 노출 순서를 정하는 방법 안내. 노출 기준과 정렬 방식을 설명하고 '
  + '판매자가 직접 확인하고 설정하는 절차를 단계별로 정리했습니다.';
const infoType = classifyTipInputType(infoGuide);
assert('정보성 가이드 텍스트 → 공고형 아님', infoType !== '지원사업/공고형', `type=${infoType}`);

const coping = '악성 환불 민원에 대처하는 방법: 문제 주문 번호와 통화 내용을 장부에 기록하고, '
  + '반복 피해를 방지하기 위해 증빙을 보관하세요. 체크리스트로 확인하세요.';
const copingType = classifyTipInputType(coping);
assert('대처방안 텍스트 → 공고형 아님', copingType !== '지원사업/공고형', `type=${copingType}`);

/* 공고형 텍스트는 여전히 공고형 */
const policy = '지원대상: 소상공인 / 지원내용: 보조금 / 신청기간: 6월 / 신청방법: 온라인 접수 / 모집공고';
assert('공고형 텍스트 → 공고형 유지', classifyTipInputType(policy) === '지원사업/공고형');

/* ═══════════════════════════════════════════════════════════════════ */
console.log('');
if (totalFails === 0) { console.log('✅ 모든 테스트 통과'); process.exit(0); }
else { console.log(`❌ ${totalFails}개 실패`); process.exit(1); }
