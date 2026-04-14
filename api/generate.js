// api/generate.js — Vercel Serverless Function
// ANTHROPIC_API_KEY 는 서버 환경변수에서만 관리

const ALLOWED_TYPES = ['analyze', 'call1', 'call2', 'call3'];

const MAX_TOKENS = { analyze: 800, call1: 2000, call2: 1200, call3: 1200 };

// ── 프롬프트 빌더 ──────────────────────────────────────
function buildPrompt(type, p) {
  if (type === 'analyze') return `당신은 세무법인 밀당레터 콘텐츠 분석가입니다.

[직전 회차 성과]
CTR: ${p.ctr}%  공유수: ${p.share}건  비고: ${p.note || '없음'}
권장 유형: ${p.recType}

[직전 회차 본문 텍스트]
${p.bodyText ? p.bodyText : '(HTML 미제공 — 수치 기반으로만 분석)'}

[지시]
순수 JSON만 출력하세요. 마크다운 없이.

{
  "title": "직전 회차 제목 (추출 불가 시 빈 문자열)",
  "topic": "핵심 주제 한 줄",
  "keywords": ["반복 키워드1", "반복 키워드2", "반복 키워드3"],
  "opening_pattern": "오프닝 첫 문장 패턴 설명",
  "cta_pattern": "CTA 패턴 설명",
  "avoid": ["피해야 할 중복 소재1", "피해야 할 중복 소재2"],
  "direction": "이번 회차 추천 방향 2~3문장"
}

[분석 기준]
- bodyText 없으면 CTR/공유수만으로 direction 작성
- keywords는 3~5개, 실제 반복 단어/표현 위주
- avoid는 직전 회차에서 이번에 피해야 할 소재
- direction: CTR 4% 이상이면 동일 구조 유지 권장, 3% 미만이면 제목·오프닝 전환 권장`;

  if (type === 'call1') return `당신은 세무법인 밀당레터 콘텐츠 기획자입니다.

[직전 회차 성과]
CTR: ${p.ctr}%  공유수: ${p.share}건  비고: ${p.note || '없음'}
직전 제목: ${p.prevTitle || '없음'}
직전 주제: ${p.prevTopic || '없음'}
반복 키워드: ${p.prevKeywords || '없음'}
피해야 할 소재: ${p.avoid || '없음'}
오프닝 패턴: ${p.openingPattern || '없음'}
CTA 패턴: ${p.ctaPattern || '없음'}
권장 유형: ${p.recType}

[지시]
순수 JSON만 출력하세요. 앞뒤 마크다운(\`\`\`), 설명 텍스트 일절 금지.

{
  "subjects": [
    {"title":"주제명","desc":"간략설명","why":"왜 좋음","target":"타깃","type":"유형"}
  ],
  "stories": [
    {"tone":"처음 겪는 상황형","text":"사연 본문"},
    {"tone":"이미 하고 있는데 맞나형","text":"사연 본문"},
    {"tone":"억울함·손해형","text":"사연 본문"}
  ],
  "openings": [
    {"tone":"공감형","text":"오프닝"},
    {"tone":"질문형","text":"오프닝"},
    {"tone":"반전형","text":"오프닝"}
  ],
  "reminds": ["멘트1","멘트2","멘트3"],
  "titles": [
    {"title":"카카오 제목","type":"유형"}
  ]
}

[배열 개수 필수]
subjects: 정확히 5개 / stories: 정확히 3개 / openings: 정확히 3개 / reminds: 정확히 3개 / titles: 정확히 5개

[콘텐츠 기준]
- subjects: CTR ${p.ctr}% 기반 유형 정렬. 직전 주제(${p.topic || '없음'}) 중복 금지. 정책·지원 최대 1개.
  유형: 나해당형/손해반전형/놓침형/헷갈림형/현실질문형/정책체감형
- stories: 소상공인 말투. "이거 내 얘기인데?" 공감형. 세무 포인트 자연스럽게.
- openings: 뉴스앵커·기관 인사 금지. 2~4문장. 사장님 공감 첫 문장.
- reminds: 3줄 이내. "세무법인 샘밀" 직접 언급 금지. "얘네 이런 것도 챙겨주네" 톤.
- titles: 손해/놓침/헷갈림/반전 요소 포함. 22자 이내 권장. 설명형 금지.
  유형: 나해당형/손해형/놓침형/반전형/현실질문형`;

  if (type === 'call2') return `당신은 세무법인 밀당레터 콘텐츠 작가입니다.

[이번 회차 정보]
선택 주제: ${p.subjectTitle}
주제 유형: ${p.subjectType}
선택 사연: ${p.storyText || '미선택'}
CTR: ${p.ctr}%

[지시]
순수 JSON만 출력하세요. 앞뒤 마크다운, 설명 텍스트 일절 금지.

{
  "tips": [
    {"label":"팁1 — 지원·정책 정보","body":"내용"},
    {"label":"팁2 — 사연 주제 실무 팁","body":"내용"},
    {"label":"팁3 — 뉴스 연결 포인트","body":"내용"}
  ],
  "quiz_ox": {
    "question":"OX 문제",
    "answer":"O",
    "explanation":"해설"
  },
  "quiz_mc": {
    "question":"4지선다 문제",
    "options":["보기1","보기2","보기3","보기4"],
    "answer": 0,
    "explanation":"해설"
  }
}

[기준]
- tips 3개 필수. 사장님이 바로 써먹을 수 있게. 딱딱하지 않게.
- quiz_ox answer는 반드시 "O" 또는 "X" 문자열.
- quiz_mc answer는 0부터 시작하는 정수 인덱스.`;

  if (type === 'call3') return `당신은 세무법인 밀당레터 뉴스 큐레이터입니다.

[이번 회차 정보]
선택 주제: ${p.subjectTitle || '미선택'}
주제 유형: ${p.subjectType || '미선택'}

[지시]
순수 JSON만 출력하세요. 앞뒤 마크다운, 설명 텍스트 일절 금지.

{
  "news": [
    {"title":"기사 제목","date":"2026.4.xx","summary":"2~3문장 요약","why":"왜 적합한지"}
  ]
}

[기준]
- news 정확히 10개.
- 세금 변화·소상공인 지원·고용·노무·정책·금융 체감 이슈 우선.
- 거시경제·주식·부동산 제외.
- 선택 주제 연관 기사 앞 배치.
- 최근 3일 내 기사 기준(실제 있을 법한 내용으로 작성).`;

  throw new Error('알 수 없는 type');
}

// ── JSON 파싱 — 다단계 안전 처리 ──────────────────────
function safeParseJSON(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('빈 응답');

  // 1단계: 마크다운 코드펜스 제거
  let cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  // 2단계: 직접 파싱 시도
  try { return JSON.parse(cleaned); } catch (_) {}

  // 3단계: 첫 { ... } 블록 추출 후 파싱
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }

  // 4단계: 실패 상세 로그 후 에러
  throw new Error('JSON 파싱 실패 — 원본: ' + cleaned.slice(0, 200));
}

// ── 응답 구조 검증 ──────────────────────────────────
function validateResult(type, result) {
  const errors = [];
  if (type === 'call1') {
    if (!Array.isArray(result.subjects) || result.subjects.length < 3)
      errors.push('subjects 누락 또는 부족');
    if (!Array.isArray(result.stories) || result.stories.length < 3)
      errors.push('stories 누락 또는 부족');
    if (!Array.isArray(result.openings) || result.openings.length < 3)
      errors.push('openings 누락 또는 부족');
    if (!Array.isArray(result.reminds) || result.reminds.length < 3)
      errors.push('reminds 누락 또는 부족');
    if (!Array.isArray(result.titles) || result.titles.length < 3)
      errors.push('titles 누락 또는 부족');
  }
  if (type === 'call2') {
    if (!Array.isArray(result.tips) || result.tips.length < 3)
      errors.push('tips 누락');
    if (!result.quiz_ox || !result.quiz_ox.question)
      errors.push('quiz_ox 누락');
    if (!result.quiz_mc || !result.quiz_mc.question)
      errors.push('quiz_mc 누락');
    // answer 타입 보정
    if (result.quiz_mc && typeof result.quiz_mc.answer === 'string')
      result.quiz_mc.answer = parseInt(result.quiz_mc.answer) || 0;
    if (result.quiz_ox && !['O','X'].includes(result.quiz_ox.answer))
      result.quiz_ox.answer = 'X'; // fallback
  }
  if (type === 'call3') {
    if (!Array.isArray(result.news) || result.news.length < 5)
      errors.push('news 부족');
  }
  return errors;
}

// ── 핸들러 ──────────────────────────────────────────
export default async function handler(req, res) {
  // CORS (필요 시)
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[밀당레터] ANTHROPIC_API_KEY 환경변수 없음');
    return res.status(500).json({ error: '서버 설정 오류: API 키 없음' });
  }

  let type, payload;
  try {
    ({ type, payload } = req.body);
  } catch (e) {
    return res.status(400).json({ error: '잘못된 요청 형식' });
  }

  if (!ALLOWED_TYPES.includes(type))
    return res.status(400).json({ error: '알 수 없는 호출 타입: ' + type });

  const prompt = buildPrompt(type, payload || {});
  const startTime = Date.now();

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: MAX_TOKENS[type],
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (e) {
    console.error('[밀당레터] Anthropic 네트워크 오류:', e.message);
    return res.status(502).json({ error: 'Anthropic API 연결 실패: ' + e.message });
  }

  if (!anthropicRes.ok) {
    const errBody = await anthropicRes.text();
    console.error('[밀당레터] Anthropic HTTP 오류', anthropicRes.status, errBody);
    return res.status(502).json({
      error: 'Anthropic API 오류 ' + anthropicRes.status,
      detail: errBody.slice(0, 300)
    });
  }

  let raw;
  try {
    const data = await anthropicRes.json();
    raw = data.content?.[0]?.text || '';
  } catch (e) {
    console.error('[밀당레터] Anthropic 응답 파싱 오류:', e.message);
    return res.status(502).json({ error: '응답 파싱 오류' });
  }

  let result;
  try {
    result = safeParseJSON(raw);
  } catch (e) {
    console.error('[밀당레터] JSON 파싱 실패 type=' + type, e.message, '원본:', raw.slice(0, 500));
    return res.status(422).json({
      error: 'AI 응답 형식 오류. 재시도해주세요.',
      detail: e.message
    });
  }

  const validationErrors = validateResult(type, result);
  if (validationErrors.length > 0) {
    console.warn('[밀당레터] 응답 구조 경고 type=' + type, validationErrors);
    // 경고만 로깅, 결과는 그대로 반환 (부분 데이터라도 사용 가능하게)
  }

  const elapsed = Date.now() - startTime;
  console.log('[밀당레터] type=' + type + ' 완료 ' + elapsed + 'ms');

  return res.status(200).json({ result });
}
