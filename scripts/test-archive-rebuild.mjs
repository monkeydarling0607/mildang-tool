// scripts/test-archive-rebuild.mjs — 임시 시뮬레이션
// rebuildArchive 의 클라이언트 로직(파일 분류 → 서버 파싱 → dedup → atomic 교체)을
// node 에서 재현해 결과를 검증한다.
import fs from 'node:fs';
import path from 'node:path';
import { extractArchiveEntryFromNewsletter } from '../api/fetch-archive.js';

const FILES = [
  "c:/Users/user/Desktop/정보경/2. 카카오톡 플친 증대 '밀당레터'/회차별 HTML/[밀당레터 #27] 에어컨 교체비, 최대 160만원 지원.txt",
  "c:/Users/user/Desktop/정보경/2. 카카오톡 플친 증대 '밀당레터'/회차별 HTML/[밀당레터 #26] 사장님만 바뀌는 ‘포괄양수도’, 이거 모르면 생돈 수백만 원 날립니다 2026. 4. 15.txt",
  "c:/Users/user/Desktop/정보경/2. 카카오톡 플친 증대 '밀당레터'/회차별 HTML/[밀당레터 #25] 서울시 소상공인 사장님, 안심통장 확인해보세요. 2026. 4. 1.txt",
  "c:/Users/user/Desktop/정보경/2. 카카오톡 플친 증대 '밀당레터'/회차별 HTML/[밀당레터 #24] 같이하는 소상공인, 최대 3억원까지 지원 2026. 3. 18.txt"
];

const parsedEntries = [];
for (const f of FILES) {
  const html = fs.readFileSync(f, 'utf8');
  const name = path.basename(f);
  const entry = extractArchiveEntryFromNewsletter(html, name);
  parsedEntries.push(entry);
}

// archiveItemKey — index.html과 동일
function normText(v) {
  return String(v == null ? '' : v)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[‘’'`"\[\]【】#·•|]/g, '')
    .replace(/[^\wㄱ-ㅎ가-힣\s.-]/g, '')
    .trim();
}
function archiveItemKey(a) {
  if (!a) return null;
  const issueNo = String(a.issueNo == null ? '' : a.issueNo).trim();
  if (issueNo) return 'issue:' + issueNo;
  const title = normText(a.kakaoTitle || a.title || '');
  const date = normText(a.date || '');
  if (title && date) return 'td:' + date + '::' + title;
  if (title) return 'title:' + title;
  return null;
}

// dedup + 표준 archive item 변환
const seen = new Set();
const duplicates = [];
const newArchive = [];
parsedEntries.forEach(p => {
  const candidate = {
    issueNo: p.issueNo || '',
    date: p.date || '',
    kakaoTitle: p.kakaoTitle || p.title || '',
    topic: p.topic || '',
    storySummary: p.storySummary || '',
    tipSummary: p.tipSummary || '',
    quizSummary: p.quizSummary || '',
    newsSummary: p.newsSummary || '',
    avoidExpressions: p.avoidExpressions || ''
  };
  const k = archiveItemKey(candidate);
  if (k && seen.has(k)) { duplicates.push(candidate.kakaoTitle || candidate.issueNo); return; }
  if (k) seen.add(k);
  newArchive.push(candidate);
});

console.log('=== rebuild 시뮬레이션 결과 ===');
console.log('선택 파일:', FILES.length);
console.log('파싱 성공:', parsedEntries.length);
console.log('등록 예정:', newArchive.length);
console.log('중복 제외:', duplicates.length);
console.log('날짜 없음:', newArchive.filter(a => !a.date).length);
console.log('');

console.log('=== 항목별 요약 ===');
newArchive.forEach(a => {
  console.log(`#${a.issueNo} | ${(a.date || '(no date)').padEnd(10)} | topic: ${(a.topic || '').slice(0, 50)}`);
  console.log(`       story: ${(a.storySummary || '').slice(0, 70)}`);
  console.log(`       tip  : ${(a.tipSummary   || '').slice(0, 70)}`);
  console.log(`       quiz : ${(a.quizSummary  || '').slice(0, 70)}`);
  console.log(`       news : ${(a.newsSummary  || '').slice(0, 70)}`);
});

console.log('');
console.log('=== duplicate 테스트 (#27 두 번 선택) ===');
const extra = extractArchiveEntryFromNewsletter(fs.readFileSync(FILES[0], 'utf8'), path.basename(FILES[0]));
const extraKey = archiveItemKey({ issueNo: extra.issueNo, kakaoTitle: extra.kakaoTitle, date: extra.date });
console.log(`extra key: ${extraKey} / 이미 있나? ${seen.has(extraKey) ? '✓ YES (중복 제외)' : '✗ NO (잘못 등록됨)'}`);

console.log('');
console.log('=== empty/invalid 파일 처리 ===');
const empty = extractArchiveEntryFromNewsletter('', 'empty.txt');
console.log('빈 html 결과:', { issueNo: empty.issueNo, title: empty.title, story: empty.storySummary, tip: empty.tipSummary });
console.log('→ 사용자 input으로 보낼 때 API의 length<50 체크에 걸려 errors로 분류됩니다.');
