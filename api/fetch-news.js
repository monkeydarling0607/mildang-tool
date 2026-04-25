// api/fetch-news.js — Vercel Serverless Function
// 뉴스 링크 자동 읽기 + 300자 이내 한입 브리핑 생성
// POST /api/fetch-news  { url, memo }
//
// 환경변수:
//   OPENAI_API_KEY
//
// 흐름:
//   1. URL fetch (없으면 memo 기반으로만 생성)
//   2. HTML에서 og:title / 발행일 / 언론사 / 본문 추출
//   3. OpenAI로 300자 요약 + 키워드 3개 생성
//   4. 구조화된 결과 반환

/* ── HTML 파싱 유틸 ─────────────────────────────────────── */
function stripHtml(s) {
  return (s || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractMeta(html, property) {
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i'
  );
  return (html.match(re1) || html.match(re2) || [])[1] || '';
}

function extractArticleBody(html) {
  const bodyPatterns = [
    // 네이버 뉴스
    /<div[^>]+id=["']dic_area["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*newsct_article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // 다음 뉴스
    /<div[^>]+class=["'][^"']*article_view[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // article 태그
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    // article-body 패턴
    /<div[^>]+class=["'][^"']*\barticle[-_]?(?:body|content|text|view)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+id=["'][^"']*\barticle[-_]?(?:body|content|text|view)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // 조선/중앙/동아
    /<div[^>]+class=["'][^"']*\barticleView\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]+class=["'][^"']*\bview_cont\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // 한경
    /<div[^>]+class=["'][^"']*\binner-article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // 뉴스핌/연합
    /<div[^>]+class=["'][^"']*\bcontent[-_]?body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // 헤럴드/파이낸셜
    /<div[^>]+class=["'][^"']*\bnews[-_]?text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // 이데일리/머니투데이
    /<div[^>]+class=["'][^"']*\bnewscontent[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const re of bodyPatterns) {
    const m = html.match(re);
    if (m) {
      const txt = stripHtml(m[1]);
      if (txt.length > 80) return txt.slice(0, 4000);
    }
  }
  return '';
}

function extractPublishedAt(html) {
  const ogTime = extractMeta(html, 'article:published_time') || extractMeta(html, 'og:article:published_time');
  if (ogTime) {
    const m = ogTime.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  }
  const dateM = html.match(
    /<meta[^>]+(?:name|property)=["'](?:date|pubdate|publishdate|article:published)["'][^>]+content=["']([^"']+)["']/i
  ) || html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:date|pubdate|publishdate|article:published)["']/i
  );
  if (dateM) {
    const m = dateM[1].match(/(\d{4})[-.\s\/](\d{2})[-.\s\/](\d{2})/);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  }
  const bodyM = html.match(/(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})/);
  if (bodyM) return `${bodyM[1]}.${bodyM[2]}.${bodyM[3]}`;
  return '';
}

function extractSource(html, urlStr) {
  const ogSite = extractMeta(html, 'og:site_name');
  if (ogSite && ogSite.length < 40) return ogSite;
  try {
    const hostname = new URL(urlStr).hostname.replace(/^www\./, '');
    const MAP = {
      'yna.co.kr':'연합뉴스','yonhapnews.co.kr':'연합뉴스',
      'chosun.com':'조선일보','biz.chosun.com':'조선비즈',
      'joongang.co.kr':'중앙일보','joins.com':'중앙일보',
      'hani.co.kr':'한겨레','ohmynews.com':'오마이뉴스',
      'newsis.com':'뉴시스','newspim.com':'뉴스핌',
      'etnews.com':'전자신문','zdnet.co.kr':'ZDNet Korea',
      'bloter.net':'블로터','hankyung.com':'한국경제',
      'mk.co.kr':'매일경제','sedaily.com':'서울경제',
      'mediatoday.co.kr':'미디어오늘','donga.com':'동아일보',
      'hankookilbo.com':'한국일보','munhwa.com':'문화일보',
      'kbs.co.kr':'KBS','mbc.co.kr':'MBC','sbs.co.kr':'SBS',
      'jtbc.co.kr':'JTBC','tvchosun.com':'TV조선','mbn.co.kr':'MBN',
      'ytn.co.kr':'YTN','cbs.co.kr':'CBS',
      'mt.co.kr':'머니투데이','edaily.co.kr':'이데일리',
      'fnnews.com':'파이낸셜뉴스','inews24.com':'아이뉴스24',
      'asiae.co.kr':'아시아경제','ajunews.com':'아주경제',
      'biz.heraldcorp.com':'헤럴드경제','heraldcorp.com':'헤럴드경제',
    };
    if (MAP[hostname]) return MAP[hostname];
    const base = hostname.split('.').slice(-2).join('.');
    if (MAP[base]) return MAP[base];
    return hostname;
  } catch { return ''; }
}

/* ── OpenAI 브리핑 생성 ─────────────────────────────────── */
async function generateBriefing({ originalTitle, source, publishedAt, articleText, memo, url, readStatus }, apiKey) {

  const contentSource = articleText.length > 100
    ? `[기사 본문]\n${articleText.slice(0, 3500)}`
    : memo
    ? `[메모 / 붙여넣기 본문]\n${memo.slice(0, 3500)}`
    : '';

  const prompt = `당신은 세무법인 밀당레터 뉴스 한입 브리핑 작성자입니다.
밀당레터는 소상공인·자영업자·사업자 사장님을 독자로 하는 뉴스레터입니다.

[기사 정보]
제목: ${originalTitle || '(제목 추출 불가)'}
출처: ${source || '(추출 불가)'}
발행일: ${publishedAt || '(추출 불가)'}
URL: ${url}
${memo && articleText.length <= 100 ? `작성자 메모/붙여넣기: ${memo}` : ''}

${contentSource}

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "original_title": "기사 원제목 (위 제목 그대로 보존, 없으면 본문에서 추출)",
  "source": "언론사명 (위 출처 그대로 보존, 없으면 URL에서 추정)",
  "published_at": "발행일 YYYY.MM.DD (없으면 빈 문자열)",
  "briefing_title": "브리핑 제목 — 핵심 키워드가 바로 보이는 짧은 제목 (15~25자, 기사에 있는 사실만)",
  "briefing_text": "뉴스 한입 브리핑 요약 (300자 이내, 사장님이 읽기 쉬운 말, 딱딱한 기사체 금지, 기사에 없는 수치·정책명·대상·기간 생성 절대 금지)",
  "keywords": ["핵심키워드1", "핵심키워드2", "핵심키워드3"]
}

[브리핑_text 작성 기준]
✅ 기사 내용을 단순하고 정확하게 요약
✅ 사장님이 이해하기 쉬운 말로 정리
✅ 짧고 쉽게, 핵심만
❌ 기사에 없는 내용 생성 금지
❌ 기사에 없는 수치/정책명/대상/기간 생성 금지
❌ "관계 부처는~", "향후 시장의 유동성~" 류 딱딱한 기사체 금지
❌ 과장 금지
❌ 본문을 못 읽었는데 읽은 것처럼 작성 금지

[키워드 작성 기준]
✅ 기사 핵심 주제 중심 3개만 (예: "가산세", "종합소득세", "납부기한")
❌ "뉴스", "이슈", "경제" 등 너무 넓은 키워드 금지`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 700,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) throw new Error('OpenAI API 오류 ' + resp.status);
  const data = await resp.json();
  const content = (data.choices?.[0]?.message?.content || '').trim();
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON 파싱 실패: ' + content.slice(0, 200));
  const parsed = JSON.parse(jsonMatch[0]);

  // keywords 정규화
  if (!Array.isArray(parsed.keywords)) parsed.keywords = [];
  parsed.keywords = parsed.keywords.slice(0, 3).map(k => String(k).replace(/^#/, ''));

  return parsed;
}

/* ── Handler ────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { url, memo } = req.body || {};
  const cleanUrl = (url || '').trim();
  const cleanMemo = (memo || '').trim();

  if (!cleanUrl) return res.status(400).json({ ok: false, error: 'url이 필요합니다' });
  try { new URL(cleanUrl); } catch {
    return res.status(200).json({ ok: false, error: '올바른 URL 형식이 아닙니다' });
  }
  if (!/^https?:\/\//i.test(cleanUrl)) {
    return res.status(200).json({ ok: false, error: 'http 또는 https URL을 입력해주세요' });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  /* ── 1. HTML fetch ── */
  let html = '';
  let fetchFailed = false;
  try {
    const fetchRes = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    if (!fetchRes.ok) throw new Error('HTTP ' + fetchRes.status);
    html = await fetchRes.text();
    console.log('[fetch-news] fetch OK:', cleanUrl.slice(0, 80), '| len:', html.length);
  } catch (e) {
    console.warn('[fetch-news] fetch 실패:', e.message);
    fetchFailed = true;
  }

  /* ── 2. 메타데이터 + 본문 추출 ── */
  const originalTitle = html ? (extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title') || '') : '';
  const publishedAt   = html ? extractPublishedAt(html) : '';
  const source        = html ? extractSource(html, cleanUrl) : '';
  const articleText   = html ? (extractArticleBody(html) || stripHtml(extractMeta(html, 'og:description') || '')) : '';

  console.log('[fetch-news] title:', originalTitle.slice(0, 60), '| textLen:', articleText.length, '| memoLen:', cleanMemo.length);

  /* ── 3. 요약 가능 여부 판단 ── */
  const hasContent = articleText.length > 100 || cleanMemo.length > 50;
  const readStatus = !hasContent ? 'failed'
    : articleText.length > 100   ? 'success'
    : 'memo_only';

  // 본문도 메모도 없으면 에러
  if (readStatus === 'failed') {
    return res.status(200).json({
      ok: false,
      read_status: 'failed',
      error: '기사 내용을 자동으로 읽지 못했습니다.\n메모칸에 기사 본문이나 핵심 내용을 붙여넣으면 브리핑 원고를 만들 수 있습니다.',
      original_title: originalTitle,
      source,
      published_at: publishedAt,
      url: cleanUrl,
    });
  }

  /* ── 4. API 키 없으면 메타만 반환 ── */
  if (!apiKey) {
    return res.status(200).json({
      ok: true,
      url: cleanUrl,
      original_title: originalTitle,
      source,
      published_at: publishedAt,
      briefing_title: originalTitle,
      briefing_text: (articleText || cleanMemo).slice(0, 300),
      keywords: [],
      read_status: 'no_ai',
    });
  }

  /* ── 5. OpenAI 브리핑 생성 ── */
  let aiResult;
  try {
    aiResult = await generateBriefing({
      originalTitle, source, publishedAt, articleText, memo: cleanMemo, url: cleanUrl, readStatus,
    }, apiKey);
  } catch (e) {
    console.error('[fetch-news] AI 오류:', e.message);
    return res.status(200).json({
      ok: false,
      error: '브리핑 생성 중 오류가 발생했습니다. (' + e.message + ')',
    });
  }

  return res.status(200).json({
    ok: true,
    url: cleanUrl,
    original_title:  aiResult.original_title  || originalTitle,
    source:          aiResult.source           || source,
    published_at:    aiResult.published_at     || publishedAt,
    briefing_title:  aiResult.briefing_title   || '',
    briefing_text:   aiResult.briefing_text    || '',
    keywords:        aiResult.keywords         || [],
    read_status:     readStatus,
  });
}
