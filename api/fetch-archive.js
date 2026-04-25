// api/fetch-archive.js — 스티비 회차 링크에서 뉴스레터 요약 추출
// POST /api/fetch-archive  { urls: [...], includeHtml?: boolean }

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
      const entry = extractFromHtml(html, url);
      if (includeHtml) {
        entry.htmlContent  = html;                              // t1html 자동 채우기용
        entry.analysisText = stripHtml(html).slice(0, 4000);  // runAnalyze() fallback용
      }
      results.push(entry);
      console.log('[fetch-archive] OK:', url, '→ #' + entry.issueNo, entry.title.slice(0, 40));
    } catch (e) {
      console.error('[fetch-archive] FAIL:', url, e.message);
      errors.push({ url, message: e.message });
    }
  }

  return res.status(200).json({ ok: true, results, errors });
}

/* ── HTML → plain text ─────────────────────────────── */
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
    .replace(/&#\d+;/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ── 메인 추출 함수 ────────────────────────────────── */
function extractFromHtml(html, url) {
  const result = {
    issueNo: '', url, title: '', date: '',
    tipTitle: '', tipSummary: '', storyTitle: '', quizTitle: '',
    kakaoTitle: '', kakaoCtr: '', kakaoClick: '', kakaoSent: '', share: '',
    createdAt: new Date().toISOString(),
  };

  // ── issueNo (URL 우선)
  const urlNumMatch = url.match(/\/p\/(\d+)\//);
  if (urlNumMatch) result.issueNo = urlNumMatch[1];

  // ── title: og:title → <title>
  const ogTitleA = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const ogTitleB = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const ogTitle  = ogTitleA || ogTitleB;
  if (ogTitle) {
    result.title = ogTitle[1].trim();
  } else {
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag) result.title = titleTag[1].trim();
  }

  // ── issueNo from title (# 패턴) — URL에서 못 찾은 경우
  if (!result.issueNo && result.title) {
    const noMatch = result.title.match(/#(\d+)/);
    if (noMatch) result.issueNo = noMatch[1];
  }

  // ── date: "2026. 4. 15." 또는 ISO
  const dateKo  = html.match(/20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}/);
  if (dateKo) {
    result.date = dateKo[0].replace(/\s/g, '');
  } else {
    const dateIso = html.match(/20\d{2}-\d{2}-\d{2}/);
    if (dateIso) result.date = dateIso[0];
  }

  // ── 본문 plain text
  const bodyText = stripHtml(html);

  // ── tipTitle / tipSummary: "밀당 꿀팁" 또는 "🍯" 근처
  const tipIdx = bodyText.search(/밀당\s*꿀팁|🍯/);
  if (tipIdx !== -1) {
    const after = bodyText.slice(tipIdx + 10, tipIdx + 300);
    // 첫 의미있는 줄 = tipTitle
    const lines = after.split(/\.\s+|\n/).map(s => s.trim()).filter(s => s.length > 4);
    if (lines[0] && lines[0].length < 100) result.tipTitle = lines[0];
    // tipSummary: 이후 1200자
    result.tipSummary = bodyText.slice(tipIdx + 10, tipIdx + 1200).trim().slice(0, 1200);
  }

  // ── storyTitle: "사연모음 Zip" 또는 "사연모음"
  const storyIdx = bodyText.search(/사연모음/);
  if (storyIdx !== -1) {
    const after = bodyText.slice(storyIdx + 10, storyIdx + 200);
    const lines = after.split(/\.\s+|\n/).map(s => s.trim()).filter(s => s.length > 4);
    if (lines[0] && lines[0].length < 100) result.storyTitle = lines[0];
  }

  // ── quizTitle: "세무내공" 또는 "Q."
  const quizKo = bodyText.match(/세무내공[^\n]{0,20}\n?\s*([^\n]{5,100})/);
  if (quizKo) {
    result.quizTitle = quizKo[1].trim().slice(0, 100);
  } else {
    const qMatch = bodyText.match(/Q\.\s*([^\.!?\n]{10,120})/);
    if (qMatch) result.quizTitle = qMatch[1].trim();
  }

  return result;
}
