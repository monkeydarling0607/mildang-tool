// api/search-benefit.js
// 소상공인 지원사업 공식 공고 검색 (기업마당 / 소상공인24 / 정부24)
// POST /api/search-benefit  { keyword }
//
// 환경변수:
//   GOOGLE_SEARCH_API_KEY  — Google Custom Search API 키
//   GOOGLE_CSE_ID          — Custom Search Engine ID (3개 도메인 제한 설정)
//
// API 키가 없으면 graceful 빈 결과 반환 (혜택형은 참고 메모 링크로 대체됨)

const ALLOWED_DOMAINS = [
  { domain: 'bizinfo.go.kr', name: '기업마당' },
  { domain: 'sbiz.or.kr',    name: '소상공인24' },
  { domain: 'gov.kr',        name: '정부24' },
];

function getDomainInfo(urlStr) {
  try {
    const h = new URL(urlStr).hostname;
    return ALLOWED_DOMAINS.find(d => h === d.domain || h.endsWith('.' + d.domain)) || null;
  } catch { return null; }
}

function scoreConfidence(title, snippet, kwds) {
  const t = (title   || '').toLowerCase();
  const s = (snippet || '').toLowerCase();
  const titleHits   = kwds.filter(k => t.includes(k.toLowerCase()));
  const snippetHits = kwds.filter(k => s.includes(k.toLowerCase()));

  if (titleHits.length >= 2)
    return { level: '높음', reason: `제목에 핵심 키워드 ${titleHits.length}개 포함 (${titleHits.slice(0,2).join(', ')})` };
  if (titleHits.length >= 1 || snippetHits.length >= 2)
    return { level: '보통', reason: '제목·본문에 키워드 일부 포함 — 직접 확인 필요' };
  return { level: '낮음', reason: '키워드 일부만 유사 — 직접 공고 확인 후 사용' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { keyword } = req.body || {};
  const raw = (keyword || '').trim().slice(0, 100);
  if (!raw) return res.status(400).json({ error: 'keyword가 필요합니다' });

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cseId  = process.env.GOOGLE_CSE_ID;

  /* ── API 키 없으면 graceful skip ── */
  if (!apiKey || !cseId) {
    console.log('[search-benefit] 검색 API 미설정 — skip');
    return res.status(200).json({
      ok: true,
      results: [],
      note: '공식 검색 API가 설정되지 않았습니다. 참고 메모에 공식 공고 링크를 직접 입력하면 혜택형 후보가 생성됩니다.',
    });
  }

  /* ── Google Custom Search 호출 ── */
  const siteClause = ALLOWED_DOMAINS.map(d => `site:${d.domain}`).join(' OR ');
  const q = `(${siteClause}) ${raw} 소상공인 지원`;
  const url =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&cx=${encodeURIComponent(cseId)}` +
    `&q=${encodeURIComponent(q)}` +
    `&num=5&lr=lang_ko&gl=kr`;

  console.log('[search-benefit] q=', q.slice(0, 120));

  let items = [];
  try {
    const r    = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await r.json();
    if (data.error) {
      console.warn('[search-benefit] Google API 경고:', data.error.message);
    }
    items = data.items || [];
  } catch (e) {
    console.error('[search-benefit] fetch 오류:', e.message);
    return res.status(200).json({
      ok: true, results: [],
      note: '검색 중 오류가 발생했습니다. 참고 메모에 공식 링크를 직접 입력해주세요.',
    });
  }

  const kwds = raw.split(/\s+/).filter(w => w.length > 1);

  const results = items
    .map(item => {
      const info = getDomainInfo(item.link || '');
      if (!info) return null;                          // 허용 도메인 외 제외
      const conf = scoreConfidence(item.title, item.snippet, kwds);
      return {
        source_name: info.name,
        source_url:  item.link,
        title:       (item.title   || '').slice(0, 100),
        snippet:     (item.snippet || '').slice(0, 200),
        confidence:  conf.level,
        reason:      conf.reason,
      };
    })
    .filter(Boolean);

  console.log(`[search-benefit] 결과 ${results.length}개 — ${results.map(r => r.confidence).join(', ')}`);
  return res.status(200).json({ ok: true, results });
}
