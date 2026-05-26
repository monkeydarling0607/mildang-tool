// scripts/test-archive-parser.mjs
// 임시 테스트 — api/fetch-archive.js 의 extractArchiveEntryFromNewsletter 를
// 실제 Stibee HTML 파일에 적용한 뒤 섹션 분리 결과를 출력한다.
// 사용:
//   node scripts/test-archive-parser.mjs "<path/to/newsletter.txt>"
// 또는 인자 없이 실행하면 기본 경로(#27)를 사용한다.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { extractArchiveEntryFromNewsletter } from '../api/fetch-archive.js';

const DEFAULT_FILE =
  "c:/Users/user/Desktop/정보경/2. 카카오톡 플친 증대 '밀당레터'/회차별 HTML/[밀당레터 #27] 에어컨 교체비, 최대 160만원 지원.txt";

const filePath = process.argv[2] || DEFAULT_FILE;
if (!fs.existsSync(filePath)) {
  console.error('파일을 찾을 수 없습니다:', filePath);
  process.exit(1);
}

const html = fs.readFileSync(filePath, 'utf8');
console.log('input file:', path.basename(filePath));
console.log('input size:', html.length, 'chars');
console.log('');

// 파일명에서 issueNo 유추 (스티비 URL 시뮬레이션)
//   raw Stibee email export 파일에는 og:title/title 태그가 없어서
//   실 운영에서 fetch 시 들어가는 URL 정보를 시뮬레이션으로 전달
const issueFromName = (path.basename(filePath).match(/#\s*(\d+)/) || [])[1] || '';
const simulatedUrl  = issueFromName ? `https://saemmil.stibee.com/p/${issueFromName}/` : '';
console.log('simulated URL:', simulatedUrl || '(none)');
console.log('');

const entry = extractArchiveEntryFromNewsletter(html, simulatedUrl);

const fields = [
  'issueNo','date','kakaoTitle','topic',
  'storySummary','tipSummary','quizSummary','newsSummary',
  'avoidExpressions','storyTitle','tipTitle','quizTitle'
];

console.log('=== 파싱 결과 ===');
for (const f of fields) {
  const v = entry[f] ?? '';
  console.log((f + ':').padEnd(20), JSON.stringify(v));
}

console.log('');
console.log('=== 섹션별 길이 ===');
['topic','storySummary','tipSummary','quizSummary','newsSummary','avoidExpressions'].forEach(f => {
  console.log((f + ':').padEnd(20), (entry[f] || '').length, 'chars');
});

// ── 오염 검증 ─────────────────────────────────────────
console.log('');
console.log('=== 오염 검증 ===');
const POLLUTION_CHECKS = {
  storySummary: ['세무내공','🍯','밀당 꿀팁','OX','정답:','#','지원대상','신청방법'],
  tipSummary:   ['사연자','세무사 의견','세무내공','🧠','퀴즈','#'],
  quizSummary:  ['🍯','밀당 꿀팁','사연모음','지원대상','신청방법','#'],
  newsSummary:  ['🍯','세무내공','사연모음','샘밀의 세무사']
};
const hashtagBlacklist = { storySummary: true, tipSummary: true, quizSummary: true };

let allPass = true;
const failureNotes = [];
for (const [field, badList] of Object.entries(POLLUTION_CHECKS)) {
  const txt = entry[field] || '';
  if (!txt) {
    console.log(`  ${field.padEnd(14)} : (빈 값 — 검증 스킵)`);
    continue;
  }
  const lower = txt.toLowerCase();
  const hits = [];
  for (const tok of badList) {
    if (tok === '#') {
      const count = (txt.match(/#[ㄱ-힣A-Za-z0-9]+/g) || []).length;
      if (hashtagBlacklist[field] && count >= 1) hits.push(`#태그×${count}`);
      continue;
    }
    if (lower.indexOf(tok.toLowerCase()) !== -1) hits.push(tok);
  }
  if (hits.length) {
    allPass = false;
    failureNotes.push(`${field}: ${hits.join(', ')}`);
    console.log(`  ${field.padEnd(14)} : ✗ 오염 — ${hits.join(', ')}`);
  } else {
    console.log(`  ${field.padEnd(14)} : ✓ 통과`);
  }
}

console.log('');
console.log('=== 최종 ===');
console.log('전체 오염 검증:', allPass ? '✓ 통과' : '✗ 실패');
if (!allPass) {
  console.log('실패 상세:');
  failureNotes.forEach(n => console.log('  - ' + n));
}
