// api/fetch-benefit-detail.js
// 공식 소상공인 지원사업 공고 페이지 내용 추출
// POST /api/fetch-benefit-detail  { url, tipTitle, tipType }
//
// 환경변수:
//   OPENAI_API_KEY — 공고 내용 AI 구조화에 사용
//
// 흐름:
//   1. 도메인 검증 (go.kr / bizinfo.go.kr / sbiz.or.kr / 공공 or.kr)
//   2. HTML fetch
//   3. plain-text 변환 + 첨부파일 제목 추출
//   4. OpenAI로 benefit_facts 구조화
//   5. 구조화된 결과 반환

/* ── 공식 도메인 검증 ──────────────────────────────────────── */
const BLOCKED_HOSTS = new Set([
  'blog.naver.com', 'cafe.naver.com', 'tistory.com', 'brunch.co.kr',
  'dcinside.com', 'clien.net', 'instiz.net', 'fmkorea.com', 'ruliweb.com',
  'reddit.com', 'namu.wiki', 'naver.com', 'daum.net', 'kakao.com',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
]);

const NEWS_PATTERNS = [
  /yna\.co\.kr$/, /yonhapnews\.co\.kr$/, /chosun\.com$/, /joongang\.co\.kr$/,
  /hani\.co\.kr$/, /ohmynews\.com$/, /newsis\.com$/, /newspim\.com$/,
  /etnews\.com$/, /zdnet\.co\.kr$/, /bloter\.net$/, /biz\.chosun\.com$/,
  /hankyung\.com$/, /mk\.co\.kr$/, /sedaily\.com$/, /mediatoday\.co\.kr$/,
];

// 공식 or.kr 도메인 → 기관명 매핑
const KNOWN_OR_KR = {
  'semas.or.kr':  '소상공인시장진흥공단',
  'sbiz.or.kr':   '소상공인24',
  'kibo.or.kr':   '기술보증기금',
  'kodit.co.kr':  '신용보증기금',
  'sgf.or.kr':    '서울신용보증재단',
  'gcf.or.kr':    '경기신용보증재단',
  'bcf.or.kr':    '부산신용보증재단',
  'icgf.or.kr':   '인천신용보증재단',
  'bizinfo.go.kr':'기업마당',
};

// go.kr 서브도메인 → 기관명 매핑 (부분 매칭)
const KNOWN_GO = {
  ydp: '영등포구청',   seoul: '서울시',      busan: '부산시',
  daegu: '대구시',     incheon: '인천시',    gwangju: '광주시',
  daejeon: '대전시',   ulsan: '울산시',      sejong: '세종시',
  gyeonggi: '경기도',  gangwon: '강원도',    jeonbuk: '전북',
  jeonnam: '전남',     gyeongbuk: '경북',    gyeongnam: '경남',
  jeju: '제주도',      gangnam: '강남구청',  seocho: '서초구청',
  mapo: '마포구청',    nowon: '노원구청',    songpa: '송파구청',
  dobong: '도봉구청',  jungnang: '중랑구청', seodaemun: '서대문구청',
  yongsan: '용산구청', jongno: '종로구청',   jung: '중구청',
  seongdong: '성동구청', gwangjin: '광진구청', dongdaemun: '동대문구청',
  mss: '중소벤처기업부', gov: '정부24',       semas: '소상공인시장진흥공단',
  smba: '중소기업청',  moel: '고용노동부',   mohw: '보건복지부',
  moef: '기획재정부',  nts: '국세청',        hometax: '홈택스',
  koreapost: '우정사업본부',
};

function getOfficialDomainInfo(urlStr) {
  let hostname;
  try { hostname = new URL(urlStr).hostname.toLowerCase(); }
  catch { return { isOfficial: false, name: null, reason: 'URL 파싱 실패' }; }

  // 블로그·커뮤니티 차단
  if (BLOCKED_HOSTS.has(hostname) || [...BLOCKED_HOSTS].some(b => hostname.endsWith('.' + b))) {
    return { isOfficial: false, name: null, reason: '블로그·커뮤니티 사이트' };
  }

  // 뉴스 차단
  if (NEWS_PATTERNS.some(p => p.test(hostname))) {
    return { isOfficial: false, name: null, reason: '뉴스 사이트' };
  }

  // 기업마당
  if (hostname === 'bizinfo.go.kr' || hostname.endsWith('.bizinfo.go.kr')) {
    return { isOfficial: true, name: '기업마당' };
  }

  // 소상공인24
  if (hostname === 'sbiz.or.kr' || hostname.endsWith('.sbiz.or.kr')) {
    return { isOfficial: true, name: '소상공인24' };
  }

  // 공식 or.kr 목록
  for (const [domain, name] of Object.entries(KNOWN_OR_KR)) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return { isOfficial: true, name };
    }
  }

  // go.kr 전체 (지자체 포함) — 가장 범위 넓은 공식 기준
  if (hostname.endsWith('.go.kr') || hostname === 'go.kr') {
    // 세부 도메인에서 기관명 추정
    const parts = hostname.replace(/\.go\.kr$/, '').split('.');
    for (const part of parts) {
      if (KNOWN_GO[part]) return { isOfficial: true, name: KNOWN_GO[part] };
    }
    // 알 수 없는 go.kr → 그대로 반환 (정부 기관으로 처리)
    const label = parts[parts.length - 1] || hostname;
    return { isOfficial: true, name: label.toUpperCase() + ' (정부기관)' };
  }

  return {
    isOfficial: false,
    name: null,
    reason: '공식 공고 도메인이 아닙니다. go.kr, bizinfo.go.kr, sbiz.or.kr 등 공식 기관 URL을 사용해주세요.',
  };
}

/* ── HTML → plain text ──────────────────────────────────── */
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

/* ── 첨부파일 목록 추출 ─────────────────────────────────── */
function extractAttachments(html) {
  const found = new Set();

  // <a href="...pdf"> ... </a> 패턴
  const linkRe = /<a[^>]+href=["'][^"']*\.(?:pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const inner = stripHtml(m[1]).trim().replace(/\s+/g, ' ');
    if (inner.length > 4 && inner.length < 200) found.add(inner);
  }

  // 파일명 패턴 — href 속성이나 data-* 속성에 있는 한글 파일명
  const fnRe = /["']([가-힣a-zA-Z0-9][가-힣a-zA-Z0-9\s\-_()\[\]·]+\.(?:pdf|hwp|hwpx|docx?|xlsx?|pptx?))["']/gi;
  while ((m = fnRe.exec(html)) !== null) {
    const name = m[1].trim();
    if (name.length > 5 && name.length < 200) found.add(name);
  }

  // 첨부 목록 텍스트 패턴 (예: "다운로드" 버튼 근처)
  const dlRe = /다운로드[^<]{0,20}<\/[a-z]+>\s*([가-힣a-zA-Z0-9][가-힣a-zA-Z0-9\s\-_().]{4,100})/gi;
  while ((m = dlRe.exec(html)) !== null) {
    const name = m[1].trim();
    if (name.length > 5 && name.length < 150) found.add(name);
  }

  return [...found].slice(0, 20);
}

/* ── OpenAI로 공고 내용 구조화 ─────────────────────────── */
async function extractWithAI(bodyText, attachments, url, tipTitle, apiKey) {
  const attachStr = attachments.length > 0
    ? `\n\n[첨부파일 목록]\n${attachments.map((a, i) => `  [${i + 1}] ${a}`).join('\n')}`
    : '';

  const prompt = `당신은 소상공인 지원사업 공고문 분석 전문가입니다.

아래는 공식 기관 공고 페이지에서 추출한 텍스트입니다.
페이지 URL: ${url}
사용자가 찾던 내용: ${tipTitle || '소상공인 지원사업'}${attachStr}

[공고 본문]
${bodyText.slice(0, 3500)}

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.
⚠ 본문에 없는 내용은 절대 임의로 생성하지 마세요.
⚠ 확인되지 않은 항목은 반드시 "공고문 확인 필요"로 표시하세요.
⚠ 여러 지원사업이 묶인 패키지형 공고이면:
   - support_name에 사업명을 모두 나열 (쉼표 구분)
   - target / benefit / period / method는 "사업별 상이 — 첨부 공고문 확인 필요"로 표시
   - needs_verification에 "사업별 공고문을 첨부파일에서 확인하세요" 포함

{
  "fetched_title": "공고 제목 (본문 또는 og:title에서 추출, 없으면 빈 문자열)",
  "fetched_date": "작성일 또는 게시일 (YYYY.MM.DD 형식, 없으면 빈 문자열)",
  "organization": "기관명 또는 부서명 (본문에서 추출)",
  "benefit_facts": {
    "support_name": "지원사업명 (여러 개면 쉼표 구분)",
    "target": "지원대상 (본문에서 추출, 없으면 '공고문 확인 필요')",
    "benefit": "지원내용/금액 (본문에서 추출, 없으면 '공고문 확인 필요')",
    "period": "신청기간 (본문에서 추출, 없으면 '공고문 확인 필요')",
    "method": "신청방법 (본문에서 추출, 없으면 '공고문 확인 필요')",
    "contact": "문의처 전화·이메일 (본문에서 추출, 없으면 빈 문자열)",
    "caution": "주의사항 (본문에서 추출, 없으면 빈 문자열)",
    "confirmed_facts": "원고에 바로 사용 가능한 확정 사실 (본문 근거 있는 것만, 2~4줄)",
    "needs_verification": "첨부 공고문 또는 담당자 확인이 필요한 항목 (1~2줄)"
  },
  "fetched_body_summary": "공고 핵심 내용 요약 3~5줄 (본문에서 직접 추출, 임의 생성 금지)",
  "confidence": "높음 (지원대상·금액·기간·방법 중 3개 이상 확인) | 보통 (1~2개 확인) | 낮음 (핵심 정보 부족)",
  "warning": "첨부 공고문 확인 필요 (여러 사업 묶음이거나 핵심 정보 부족) | 빈 문자열 (모든 정보 확인됨)"
}`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1500,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resp.ok) throw new Error('OpenAI API 오류 ' + resp.status);
  const data = await resp.json();
  const content = (data.choices?.[0]?.message?.content || '').trim();

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON 파싱 실패 — 모델 응답: ' + content.slice(0, 200));
  return JSON.parse(jsonMatch[0]);
}

/* ── Handler ────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { url, tipTitle, tipType } = req.body || {};
  const cleanUrl = (url || '').trim();
  if (!cleanUrl) return res.status(400).json({ ok: false, error: 'url이 필요합니다' });

  const apiKey = process.env.OPENAI_API_KEY;

  /* ── 1. 도메인 검증 ── */
  const domainInfo = getOfficialDomainInfo(cleanUrl);
  if (!domainInfo.isOfficial) {
    console.log('[fetch-benefit] 비공식 도메인:', cleanUrl.slice(0, 80), '|', domainInfo.reason);
    return res.status(200).json({
      ok: false,
      error_type: 'not_official',
      message: domainInfo.reason || '공식 공고 링크가 아닙니다.',
    });
  }

  /* ── 2. HTML fetch ── */
  let html = '';
  try {
    const fetchRes = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MildangBot/1.0; +https://saemmil.co.kr)',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      redirect: 'follow',
    });
    if (!fetchRes.ok) throw new Error('HTTP ' + fetchRes.status);
    html = await fetchRes.text();
    console.log('[fetch-benefit] fetch OK:', cleanUrl.slice(0, 80), '| len:', html.length);
  } catch (e) {
    console.error('[fetch-benefit] fetch 실패:', e.message);
    return res.status(200).json({
      ok: false,
      error_type: 'fetch_failed',
      message: '공고 페이지를 읽지 못했습니다. (' + e.message + ')\n링크 주소를 다시 확인하거나 잠시 후 다시 시도해주세요.',
    });
  }

  /* ── 3. 텍스트 + 첨부파일 추출 ── */
  const bodyText    = stripHtml(html);
  const attachments = extractAttachments(html);
  console.log('[fetch-benefit] textLen:', bodyText.length, '| attachments:', attachments.length);

  /* ── 4. AI 구조화 ── */
  if (!apiKey) {
    // API 키 미설정 → raw 요약만 반환
    return res.status(200).json({
      ok: true,
      source_verified: true,
      source_name:     domainInfo.name,
      source_url:      cleanUrl,
      fetched_title:   '',
      fetched_date:    '',
      fetched_body_summary: bodyText.slice(0, 600),
      benefit_facts: {
        attachments,
        confirmed_facts:     '',
        needs_verification:  '공고문 직접 확인 필요 (AI 분석 미설정)',
      },
      confidence: '낮음',
      warning:    'AI 분석이 설정되지 않았습니다. 공고문을 직접 확인해주세요.',
    });
  }

  let extracted;
  try {
    extracted = await extractWithAI(bodyText, attachments, cleanUrl, tipTitle || '', apiKey);

    // 직접 추출한 첨부파일로 보충
    if (
      attachments.length > 0 &&
      extracted.benefit_facts &&
      (!extracted.benefit_facts.attachments || !extracted.benefit_facts.attachments.length)
    ) {
      extracted.benefit_facts.attachments = attachments;
    }
  } catch (e) {
    console.error('[fetch-benefit] AI 추출 실패:', e.message);
    // AI 실패 → graceful fallback
    return res.status(200).json({
      ok: true,
      source_verified: true,
      source_name:     domainInfo.name,
      source_url:      cleanUrl,
      fetched_title:   '',
      fetched_date:    '',
      fetched_body_summary: bodyText.slice(0, 600),
      benefit_facts: {
        attachments,
        confirmed_facts:    '',
        needs_verification: '공고문 직접 확인 필요 (AI 분석 실패: ' + e.message.slice(0, 80) + ')',
      },
      confidence: '낮음',
      warning:    'AI 분석 실패 — 공고문을 직접 확인해주세요.',
    });
  }

  console.log(
    '[fetch-benefit] 추출 완료:',
    extracted.fetched_title?.slice(0, 50),
    '| confidence:', extracted.confidence,
    '| attachments:', (extracted.benefit_facts?.attachments || attachments).length,
  );

  return res.status(200).json({
    ok:              true,
    source_verified: true,
    source_name:     extracted.organization || domainInfo.name,
    source_url:      cleanUrl,
    fetched_title:        extracted.fetched_title        || '',
    fetched_date:         extracted.fetched_date         || '',
    fetched_body_summary: extracted.fetched_body_summary || bodyText.slice(0, 500),
    benefit_facts:        extracted.benefit_facts        || { attachments },
    confidence:           extracted.confidence           || '보통',
    warning:              extracted.warning              || '',
  });
}
