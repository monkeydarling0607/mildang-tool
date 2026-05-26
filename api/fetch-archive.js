// api/fetch-archive.js — 스티비 회차 링크에서 뉴스레터를 섹션별로 분리 추출
// POST /api/fetch-archive  { urls: [...], includeHtml?: boolean }
//
// 반환 필드 (entry):
//   - issueNo, date, url, title, kakaoTitle, topic
//   - storySummary, tipSummary, quizSummary, newsSummary
//   - avoidExpressions
//   - tipTitle, storyTitle, quizTitle  (백워드 호환 — 각 섹션의 첫 문장)
//   - htmlContent, analysisText        (includeHtml=true 일 때만)
//
// 핵심 원칙:
//   섹션 분리에 실패한 필드는 빈 문자열을 반환.
//   섹션 경계 밖 내용이 섞이는 것보다 빈 값이 낫다.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const { urls, includeHtml } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0)
    return res.status(400).json({ error: 'urls 배열이 필요합니다' });
  if (urls.length > 20)
    return res.status(400).json({ error: '한 번에 최대 20개까지 처리 가능합니다' });

  const results = [];
  const errors  = [];

  for (const rawUrl of urls) {
    const url = (rawUrl || '').trim();
    if (!url) continue;
    try {
      const fetchRes = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; MildangBot/1.0; +https://saemmil.co.kr)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
        redirect: 'follow',
      });
      if (!fetchRes.ok) throw new Error('HTTP ' + fetchRes.status);
      const html = await fetchRes.text();
      const entry = extractArchiveEntryFromNewsletter(html, url);
      if (includeHtml) {
        entry.htmlContent  = html;
        entry.analysisText = normalizeNewsletterText(html).slice(0, 4000);
      }
      results.push(entry);
      console.log('[fetch-archive] OK:', url, '→ #' + entry.issueNo, (entry.title || '').slice(0, 40));
    } catch (e) {
      console.error('[fetch-archive] FAIL:', url, e.message);
      errors.push({ url, message: e.message });
    }
  }

  return res.status(200).json({ ok: true, results, errors });
}

/* ══════════════════════════════════════════════════════════════
   1. normalizeNewsletterText — HTML → 구조 보존 plain text
   ══════════════════════════════════════════════════════════════
   기존 stripHtml은 모든 공백을 단일 공백으로 축소해 블록 경계가 사라졌다.
   새 버전은 block-level 태그를 줄바꿈으로 보존해 섹션 분리가 가능하게 함. */
export function normalizeNewsletterText(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    /* CTA/버튼 텍스트 제거 (Stibee 공통 푸터 — 구독 / 수신거부 등) */
    .replace(/<!--[\s\S]*?-->/g, '')
    /* 블록 태그를 줄바꿈으로 변환 */
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|td|h[1-6]|section|article|blockquote|header|footer)>/gi, '\n')
    /* 나머지 태그 제거 */
    .replace(/<[^>]+>/g, ' ')
    /* 엔티티 디코딩 */
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#\d+;/g, '')
    /* 공백 정리 — 줄바꿈은 보존, 공백/탭만 정리 */
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ══════════════════════════════════════════════════════════════
   2. splitNewsletterSections — 마커 위치 기반 섹션 분리
   ══════════════════════════════════════════════════════════════ */

/* 각 섹션의 시작을 알리는 마커. 우선순위 순서로 첫 매칭만 사용 */
const SECTION_MARKERS = [
  { type: 'tip',   patterns: [
    /🍯\s*밀당\s*꿀팁\s*🐝?/,
    /밀당\s*꿀팁/,
    /놓치면\s*손해/,
    /이번\s*꿀팁/
  ]},
  { type: 'quiz',  patterns: [
    /🧠\s*세무내공\s*\+?\s*1?\s*퀴즈/,
    /세무내공\s*\+?\s*1?\s*퀴즈/,
    /세무내공/,
    /세무\s*퀴즈/,
    /OX\s*퀴즈/i,
    /4지선다\s*퀴즈/
  ]},
  { type: 'story', patterns: [
    /📬\s*사연모음\s*Zip/i,
    /사연모음\s*Zip/i,
    /샘밀의?\s*세무사들이?\s*직접\s*답하는[^\n]*사장님들?의?\s*리얼\s*고민\s*상담소/,
    /샘밀의?\s*세무사들이?\s*직접\s*답하는/,
    /사장님들?의?\s*리얼\s*고민\s*상담소/,
    /사연\s*모음/,
    /사연모음/
  ]}
];

/* 메뉴/TOC 영역 끝(menuEnd) 계산.
   1차 시도: "이번주 밀당레터" 헤더 + 메뉴 이모지(🍽 🗓 🍯 📬 🧠 💌) 클러스터로 탐지.
   2차 시도(없으면): 250자 내에 서로 다른 섹션 type 3개 이상 등장하면 메뉴로 간주.
   둘 다 실패하면 -1 (메뉴 없음). */
function detectMenuEndByText(text) {
  const menuHeaderMatch = text.match(/이번\s*주?\s*밀당레터/);
  if (!menuHeaderMatch || menuHeaderMatch.index === undefined) return -1;
  const start = menuHeaderMatch.index;
  /* 메뉴 헤더 직후 400자 내에서 메뉴 이모지의 마지막 등장 위치 + 그 뒤 80자 한 줄 끝까지를 메뉴 영역으로 */
  const re = /[🍽🗓🍯📬🧠💌]/gu;
  re.lastIndex = start;
  let lastEmojiEnd = -1;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index - start > 400) break;
    lastEmojiEnd = m.index + m[0].length;
  }
  if (lastEmojiEnd < 0) return -1;
  /* 마지막 이모지가 가리키는 메뉴 한 줄(다음 \n 또는 80자)까지 포함 */
  const tail = text.slice(lastEmojiEnd, lastEmojiEnd + 100);
  const newlineIdx = tail.search(/\n\n|\n[^\n]/);
  return lastEmojiEnd + (newlineIdx > 0 ? Math.min(newlineIdx + 1, 80) : 60);
}

function detectMenuEnd(allMatches, text) {
  /* 우선: 헤더+이모지 클러스터 기반 */
  const byText = detectMenuEndByText(text);
  if (byText > 0) return byText;
  /* 차선: 250자 내에 서로 다른 type 3개 이상 등장 */
  for (let i = 0; i < allMatches.length; i++) {
    const types = new Set([allMatches[i].type]);
    let j = i;
    while (j + 1 < allMatches.length && allMatches[j + 1].pos - allMatches[i].pos < 250) {
      j++;
      types.add(allMatches[j].type);
    }
    if (types.size >= 3) return allMatches[j].pos + allMatches[j].len;
  }
  return -1;
}

/* 본문 안에서 명시 헤더 없이 등장하는 섹션들을 탐지 (뉴스 브리핑 / 퀴즈)
   - 뉴스: 해시태그 클러스터(2+ 태그 30자 이내 인접)의 첫 위치
   - 퀴즈: 정답 패턴 — 정답은?, (A)/(B), 👇 정답, Q. 등 */
function detectNewsStart(text, fromIdx) {
  const re = /#[ㄱ-힣A-Za-z0-9][^\n#]{0,30}(?:\s*#[ㄱ-힣A-Za-z0-9][^\n#]{0,30}){1,}/g;
  re.lastIndex = Math.max(fromIdx, 0);
  const m = re.exec(text);
  return m ? m.index : -1;
}

function detectQuizStart(text, fromIdx) {
  const slice = text.slice(Math.max(fromIdx, 0));
  const patterns = [
    /정답은?\s*(?:바로\s*아래|\?|:)/,
    /👇\s*정답/,
    /\([AB]\)\s*[OX](?:\s|\n)/,
    /Q\.\s/
  ];
  let best = -1;
  for (const p of patterns) {
    const m = slice.match(p);
    if (m && m.index !== undefined) {
      const pos = Math.max(fromIdx, 0) + m.index;
      if (best < 0 || pos < best) best = pos;
    }
  }
  return best;
}

/* 텍스트를 섹션별 블록으로 분리.
   복합 전략:
   1) 명시적 섹션 헤더 (findSectionMarkers + 메뉴 스킵) — 가장 신뢰도 높음
   2) 메뉴 이후 뉴스 브리핑 시작 (해시태그 클러스터)
   3) 스토리 이후 퀴즈 시작 (정답 패턴)
   4) 메뉴 직후 명시 tip 헤더가 없으면 menu_end를 tip 시작으로 간주
   각 섹션의 본문은 다음 섹션 시작 직전까지 */
export function splitNewsletterSections(text) {
  const result = { story: '', tip: '', quiz: '', news: '' };
  if (!text) return result;

  /* 1. 명시 헤더 후보 모두 수집 */
  const allMatches = [];
  for (const marker of SECTION_MARKERS) {
    for (const pattern of marker.patterns) {
      const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
      const re = new RegExp(pattern.source, flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        allMatches.push({ type: marker.type, pos: m.index, len: m[0].length });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }
  allMatches.sort((a, b) => a.pos - b.pos);

  /* 2. 메뉴 영역 끝 */
  const menuEnd = detectMenuEnd(allMatches, text);

  /* 3. 각 type별로 menuEnd 이후 첫 명시 헤더 */
  const realMarkers = {};
  for (const m of allMatches) {
    if (menuEnd >= 0 && m.pos < menuEnd) continue;
    if (!realMarkers[m.type]) realMarkers[m.type] = m;
  }

  /* 4. 메뉴 없는 경우 — 명시 헤더만으로 가는 단순 케이스 */
  if (menuEnd < 0) {
    for (const m of allMatches) {
      if (!realMarkers[m.type]) realMarkers[m.type] = m;
    }
    /* 첫 명시 섹션 이전 prefix가 뉴스 시그널을 가지면 뉴스로 */
    const positions = Object.values(realMarkers).sort((a,b) => a.pos - b.pos);
    if (positions.length) {
      const preface = text.slice(0, positions[0].pos).trim();
      const hashCount = (preface.match(/#[ㄱ-힣A-Za-z0-9]+/g) || []).length;
      const hasNewsLabel = /(브리핑|뉴스|기사|보도|발표)/.test(preface);
      if ((hashCount >= 2 || hasNewsLabel) && preface) {
        result.news = preface;
      }
    }
    for (let i = 0; i < positions.length; i++) {
      const cur = positions[i];
      const next = positions[i + 1];
      const startIdx = cur.pos + cur.len;
      const endIdx = next ? next.pos : text.length;
      result[cur.type] = text.slice(startIdx, endIdx).trim();
    }
    return result;
  }

  /* 5. 메뉴가 있는 표준 케이스 — 본문 안 시그널까지 종합 */
  const storyPos = realMarkers.story ? realMarkers.story.pos : -1;
  const newsPos  = detectNewsStart(text, menuEnd);
  const quizSearchFrom = storyPos >= 0 ? storyPos + 100 : menuEnd;
  let quizPos = detectQuizStart(text, quizSearchFrom);
  /* 명시적 퀴즈 헤더가 있고 menuEnd 이후라면 그 위치를 우선 */
  if (realMarkers.quiz && realMarkers.quiz.pos < quizPos) quizPos = realMarkers.quiz.pos;
  else if (quizPos < 0 && realMarkers.quiz) quizPos = realMarkers.quiz.pos;

  /* 6. 섹션 시작 후보 정리 */
  const starts = [];
  /* tip — 명시 헤더 우선, 없으면 menuEnd */
  if (realMarkers.tip) {
    starts.push({ type: 'tip', pos: realMarkers.tip.pos, len: realMarkers.tip.len });
  } else {
    starts.push({ type: 'tip', pos: menuEnd, len: 0 });
  }
  if (newsPos >= 0)        starts.push({ type: 'news',  pos: newsPos, len: 0 });
  if (realMarkers.story)   starts.push({ type: 'story', pos: storyPos, len: realMarkers.story.len });
  if (quizPos >= 0)        starts.push({ type: 'quiz',  pos: quizPos,  len: 0 });

  starts.sort((a, b) => a.pos - b.pos);

  /* 7. 같은 type이 여러 번 잡혀도 첫 등장만 사용 + 본문 슬라이스 */
  const used = new Set();
  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i];
    if (used.has(cur.type)) continue;
    used.add(cur.type);
    const next = starts[i + 1];
    const startIdx = cur.pos + cur.len;
    const endIdx = next ? next.pos : text.length;
    result[cur.type] = text.slice(startIdx, endIdx).trim();
  }

  return result;
}

/* ══════════════════════════════════════════════════════════════
   3. cleanSectionText — 섹션 텍스트 정리
   ══════════════════════════════════════════════════════════════ */

const MAX_LEN = { topic: 80, story: 400, tip: 400, quiz: 200, news: 300, title: 100 };

/* 섹션 본문에 나타나면 그 앞에서 잘라야 하는 "타 섹션 마커" */
const FOREIGN_BOUNDARY = {
  story: [/🍯\s*밀당\s*꿀팁/, /밀당\s*꿀팁/, /🧠\s*세무내공/, /세무내공\s*\+?\s*1?\s*퀴즈/, /OX\s*퀴즈/i],
  tip:   [/🧠\s*세무내공/, /세무내공\s*\+?\s*1?\s*퀴즈/, /사연모음/, /샘밀의?\s*세무사들이?/, /OX\s*퀴즈/i],
  quiz:  [/🍯\s*밀당\s*꿀팁/, /밀당\s*꿀팁/, /사연모음/, /샘밀의?\s*세무사들이?/],
  news:  [/🍯\s*밀당\s*꿀팁/, /밀당\s*꿀팁/, /사연모음/, /샘밀의?\s*세무사들이?/, /세무내공/]
};

export function cleanSectionText(raw, type) {
  if (!raw) return '';
  let s = String(raw)
    /* URL 제거 */
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&#?\w+;/g, ' ')
    /* 줄바꿈을 공백으로 (섹션 내부는 단일 문자열로 보관) */
    .replace(/\n+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  /* 다른 섹션 라벨이 등장하면 그 앞에서 자름 — 마커 누락으로 본문이 다음 섹션까지 흘러간 경우의 안전망 */
  const boundaries = FOREIGN_BOUNDARY[type] || [];
  for (const re of boundaries) {
    const m = s.match(re);
    if (m && m.index !== undefined && m.index > 0) {
      s = s.slice(0, m.index).trim();
    }
  }

  /* 해시태그 클러스터 제거 (뉴스 섹션은 보존 — 뉴스 본문 특성상 해시태그 사용) */
  if (type !== 'news') {
    s = s.replace(/(?:#[ㄱ-힣A-Za-z0-9]+\s*){2,}/g, ' ').trim();
  }

  /* 공백/구두점 정리 */
  s = s.replace(/[ \t]+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();

  /* 길이 제한 — 문장 단위 절단을 시도하되, 너무 짧으면 hard truncate.
     불릿 위주(🔸 ...) 콘텐츠는 마침표가 거의 없어 문장 단위 누적이 너무 일찍 멈추는 문제 회피 */
  const max = MAX_LEN[type] || 300;
  if (s.length > max) {
    const sentences = s.match(/[^.!?。]+[.!?。]?/g) || [s];
    let out = '';
    for (const sent of sentences) {
      if ((out + sent).length > max) break;
      out += sent;
    }
    let candidate = out.trim();
    /* 문장 단위 결과가 max의 60% 미만이면 hard truncate로 정보 손실 줄임 */
    if (candidate.length < Math.floor(max * 0.6)) {
      candidate = s.slice(0, max).trim();
    }
    s = candidate;
    if (s.length >= max && !/[.!?。…]$/.test(s)) s += '…';
  }
  return s;
}

/* ══════════════════════════════════════════════════════════════
   4. validateSection — 섹션 어울리지 않으면 빈 문자열
   ══════════════════════════════════════════════════════════════ */

const SECTION_FOREIGN_TOKENS = {
  story: ['세무내공', '🍯', 'ox 퀴즈', '4지선다', '정답:'],
  tip:   ['사연자', '세무사 의견', '세무내공', '🧠'],
  quiz:  ['🍯', '밀당 꿀팁', '사연모음'],
  news:  ['🍯', '세무내공', '사연모음']
};
const QUIZ_OWN_VOCAB = ['퀴즈','정답','ox','o/x','4지선다','세무내공','문제','맞춰','맞나요','일까요','맞을까','풀어','보세요'];

export function validateSection(text, type) {
  if (!text) return '';
  const trimmed = String(text).trim();
  if (trimmed.length < 5) return '';

  const lower = trimmed.toLowerCase();

  /* 타 섹션 토큰이 2개 이상 → 폐기 */
  let hits = 0;
  for (const tok of (SECTION_FOREIGN_TOKENS[type] || [])) {
    if (lower.indexOf(tok.toLowerCase()) !== -1) {
      hits++;
      if (hits >= 2) return '';
    }
  }

  /* 퀴즈는 자체 어휘가 없으면 의심 (뉴스/사연 본문이 잘못 들어왔을 가능성 높음) */
  if (type === 'quiz') {
    const hasOwn = QUIZ_OWN_VOCAB.some(v => lower.indexOf(v) !== -1);
    if (!hasOwn) return '';
  }

  /* 뉴스는 자체 시그널이 있어야 — 해시태그 또는 뉴스 어휘 */
  if (type === 'news') {
    const hashCount = (trimmed.match(/#[ㄱ-힣A-Za-z0-9]+/g) || []).length;
    const hasNewsVocab = /(브리핑|뉴스|기사|보도|발표|시행|정부|국세청|중기부|금융위|은행)/.test(trimmed);
    if (hashCount < 2 && !hasNewsVocab) return '';
  }

  return trimmed;
}

/* ══════════════════════════════════════════════════════════════
   5. 기타 유틸 — 해시태그 / 토픽 / 첫 문장
   ══════════════════════════════════════════════════════════════ */

export function extractHashtags(text, max = 8) {
  if (!text) return [];
  const matches = String(text).match(/#[ㄱ-힣A-Za-z0-9]{2,}/g) || [];
  const seen = new Set();
  const out = [];
  for (const h of matches) {
    const k = h.replace(/^#/, '');
    if (k.length < 2 || k.length > 18) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

export function extractTopicFromTitle(title) {
  if (!title) return '';
  let t = String(title)
    /* [밀당레터 #N] 또는 [밀당레터#N] 접두 제거 */
    .replace(/^\s*\[?\s*밀당레터\s*#?\s*\d*\s*\]?\s*/, '')
    /* 단순 #N 접두 제거 */
    .replace(/^\s*\[?\s*#\s*\d+\s*\]?\s*/, '')
    .trim();
  if (t.length > MAX_LEN.topic) {
    /* 문장 단위 절단 */
    const m = t.match(/^[^.!?。]{0,80}[.!?。]?/);
    t = (m ? m[0] : t.slice(0, MAX_LEN.topic)).trim();
    if (t.length >= MAX_LEN.topic && !/[.!?。]$/.test(t)) t += '…';
  }
  return t;
}

function firstSentence(s, maxLen = 100) {
  if (!s) return '';
  /* 약어 마침표(Q., A. 등)에 잘못 잘리지 않도록 — 너무 짧으면 다음 문장 경계까지 확장 */
  const text = String(s);
  let buf = '';
  const parts = text.split(/([.!?。])/);
  for (let i = 0; i < parts.length; i += 2) {
    const seg = (parts[i] || '') + (parts[i + 1] || '');
    buf += seg;
    if (buf.trim().length >= 8) break;
  }
  let v = buf.trim();
  if (!v) v = text.trim();
  if (v.length > maxLen) v = v.slice(0, maxLen).trim() + '…';
  return v;
}

/* ══════════════════════════════════════════════════════════════
   6. extractArchiveEntryFromNewsletter — 최종 entry 조립
   ══════════════════════════════════════════════════════════════ */

export function extractArchiveEntryFromNewsletter(html, url = '') {
  const entry = {
    issueNo: '', url, title: '', kakaoTitle: '', date: '',
    topic: '',
    storySummary: '', tipSummary: '', quizSummary: '', newsSummary: '',
    avoidExpressions: '',
    /* 백워드 호환 — 각 섹션의 첫 문장 */
    tipTitle: '', storyTitle: '', quizTitle: '',
    /* 미사용 필드 — 기존 컨슈머 호환 */
    kakaoCtr: '', kakaoClick: '', kakaoSent: '', share: '',
    createdAt: new Date().toISOString()
  };

  /* issueNo (URL 우선) */
  const urlNumMatch = String(url).match(/\/p\/(\d+)\//);
  if (urlNumMatch) entry.issueNo = urlNumMatch[1];

  /* title — 우선순위: og:title → <title> → 본문 안의 [밀당레터 #N] 패턴 fallback.
     Stibee가 발송한 회차별 HTML 파일에는 og:title/<title>이 없는 경우가 있음. */
  const ogTitleA = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogTitleB = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const ogTitle  = ogTitleA || ogTitleB;
  if (ogTitle) {
    entry.title = ogTitle[1].trim();
  } else {
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag) entry.title = titleTag[1].trim();
  }
  if (!entry.title) {
    /* 본문에서 [밀당레터 #N] ... 첫 줄 추출 */
    const plain = normalizeNewsletterText(html);
    const bracketTitle = plain.match(/\[?\s*밀당레터\s*#\s*\d+\s*\][^\n]{0,80}/);
    if (bracketTitle) {
      entry.title = bracketTitle[0].replace(/\s+/g, ' ').trim();
    } else {
      /* Fallback — Stibee 메일 export(raw)에는 og:title/<title>이 없을 때가 있음.
         "이번주 밀당레터" 메뉴의 첫 🍯 항목이 회차 핵심 토픽이므로 그것을 제목으로 사용.
         🍽️ 한입 브리핑, 🗓️ 세금 캘린더 같은 다른 메뉴 줄이 🍯 앞에 있을 수 있으므로 허용. */
      const menuMatch = plain.match(/이번\s*주?\s*밀당레터[\s\S]{0,400}?🍯[^\n🍽🗓📬🧠💡🐝]{4,80}/);
      if (menuMatch) {
        const titleCore = menuMatch[0].split('🍯').pop().trim().replace(/\s+/g, ' ');
        const issueLabel = entry.issueNo ? `[밀당레터 #${entry.issueNo}] ` : '';
        entry.title = (issueLabel + titleCore).slice(0, 100);
      }
    }
  }
  entry.kakaoTitle = entry.title;
  entry.topic      = extractTopicFromTitle(entry.title);

  if (!entry.issueNo && entry.title) {
    const noMatch = entry.title.match(/#\s*(\d+)/);
    if (noMatch) entry.issueNo = noMatch[1];
  }
  /* issueNo 최후 fallback — 본문 안의 [밀당레터 #N] */
  if (!entry.issueNo) {
    const plain = normalizeNewsletterText(html);
    const inBody = plain.match(/밀당레터\s*#\s*(\d+)/);
    if (inBody) entry.issueNo = inBody[1];
  }

  /* date — 우선순위: "YYYY.M.D" → "YYYY-MM-DD" → "YYYY년 M월 D일"
     Stibee 발송일 표기가 회차마다 다름 (#21~#26: dot, #27: 년월일) */
  {
    const dateKo  = html.match(/20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}/);
    const dateIso = html.match(/20\d{2}-\d{2}-\d{2}/);
    const dateKor = html.match(/20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/);
    if (dateKo) {
      entry.date = dateKo[0].replace(/\s/g, '');
    } else if (dateIso) {
      entry.date = dateIso[0];
    } else if (dateKor) {
      /* "2026년 1월 1일" → "2026.1.1" 로 정규화 (다른 회차와 표기 통일) */
      const m = dateKor[0].match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
      if (m) entry.date = `${m[1]}.${parseInt(m[2], 10)}.${parseInt(m[3], 10)}`;
    }
  }

  /* 본문 구조 보존 텍스트 → 섹션 분리 → 정리 → 검증 */
  const text     = normalizeNewsletterText(html);
  const sections = splitNewsletterSections(text);

  const cleanedStory = validateSection(cleanSectionText(sections.story, 'story'), 'story');
  const cleanedTip   = validateSection(cleanSectionText(sections.tip,   'tip'),   'tip');
  const cleanedQuiz  = validateSection(cleanSectionText(sections.quiz,  'quiz'),  'quiz');
  const cleanedNews  = validateSection(cleanSectionText(sections.news,  'news'),  'news');

  entry.storySummary = cleanedStory;
  entry.tipSummary   = cleanedTip;
  entry.quizSummary  = cleanedQuiz;
  entry.newsSummary  = cleanedNews;

  /* 백워드 호환 — 각 섹션 첫 문장을 *Title로 노출 */
  entry.storyTitle = firstSentence(cleanedStory);
  entry.tipTitle   = firstSentence(cleanedTip);
  entry.quizTitle  = firstSentence(cleanedQuiz);

  /* 해시태그 → avoidExpressions (뉴스 섹션 우선, 없으면 전체 본문에서) */
  const tags = extractHashtags(sections.news || text, 8);
  if (tags.length) entry.avoidExpressions = tags.join(', ');

  return entry;
}
