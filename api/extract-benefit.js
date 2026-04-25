// api/extract-benefit.js
// 사용자가 직접 제공한 공고 자료(붙여넣기 / PDF / URL)에서 혜택형 꿀팁 생성
// POST /api/extract-benefit
// Body: { pastedText?, officialUrl?, fileBase64?, fileName? }
//
// 처리 우선순위: pastedText > fileBase64(PDF) > officialUrl
//
// 환경변수:
//   OPENAI_API_KEY — 공고 내용 AI 구조화 및 꿀팁 생성에 사용

/* ── caution 정규화 ── */
const EMPTY_CAUTION_VALUES = ['없음', '해당 없음', 'n/a', 'na', '-', ''];
const DEFAULT_CAUTION_TEXT = '신청 전 공고문과 접수처의 세부 조건을 반드시 확인해주세요.';

function normalizeCaution(val) {
  const v = (val || '').trim().toLowerCase();
  return EMPTY_CAUTION_VALUES.includes(v) ? DEFAULT_CAUTION_TEXT : (val || '').trim();
}

/* ── 공식 도메인 검증 (URL 입력 시) ───────────────────── */
const BLOCKED_HOSTS = new Set([
  'blog.naver.com', 'cafe.naver.com', 'tistory.com', 'brunch.co.kr',
  'dcinside.com', 'clien.net', 'instiz.net', 'fmkorea.com', 'ruliweb.com',
  'reddit.com', 'namu.wiki', 'naver.com', 'daum.net', 'kakao.com',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com',
]);

const NEWS_PATTERNS = [
  /yna\.co\.kr$/, /yonhapnews\.co\.kr$/, /chosun\.com$/, /joongang\.co\.kr$/,
  /hani\.co\.kr$/, /ohmynews\.com$/, /newsis\.com$/, /newspim\.com$/,
  /etnews\.com$/, /zdnet\.co\.kr$/, /bloter\.net$/, /hankyung\.com$/,
  /mk\.co\.kr$/, /sedaily\.com$/, /mediatoday\.co\.kr$/,
];

const KNOWN_OR_KR = {
  'semas.or.kr':  '소상공인시장진흥공단',
  'sbiz.or.kr':   '소상공인24',
  'kibo.or.kr':   '기술보증기금',
  'kodit.co.kr':  '신용보증기금',
  'sgf.or.kr':    '서울신용보증재단',
  'gcf.or.kr':    '경기신용보증재단',
  'bizinfo.go.kr':'기업마당',
};

const KNOWN_GO = {
  ydp: '영등포구청',   seoul: '서울시',      busan: '부산시',
  daegu: '대구시',     incheon: '인천시',    gwangju: '광주시',
  daejeon: '대전시',   ulsan: '울산시',      sejong: '세종시',
  gyeonggi: '경기도',  gangwon: '강원도',    jeonbuk: '전북',
  jeonnam: '전남',     gyeongbuk: '경북',    gyeongnam: '경남',
  jeju: '제주도',
  mss: '중소벤처기업부', gov: '정부24',       semas: '소상공인시장진흥공단',
  smba: '중소기업청',  moel: '고용노동부',   mohw: '보건복지부',
  moef: '기획재정부',  nts: '국세청',        hometax: '홈택스',
};

function getOfficialDomainInfo(urlStr) {
  let hostname;
  try { hostname = new URL(urlStr).hostname.toLowerCase(); }
  catch { return { isOfficial: false, name: null, reason: 'URL 파싱 실패' }; }

  if (BLOCKED_HOSTS.has(hostname) || [...BLOCKED_HOSTS].some(b => hostname.endsWith('.' + b))) {
    return { isOfficial: false, name: null, reason: '블로그·커뮤니티 사이트는 공식 공고가 아닙니다.' };
  }
  if (NEWS_PATTERNS.some(p => p.test(hostname))) {
    return { isOfficial: false, name: null, reason: '뉴스 기사 링크는 공식 공고가 아닙니다.' };
  }
  if (hostname === 'bizinfo.go.kr' || hostname.endsWith('.bizinfo.go.kr')) {
    return { isOfficial: true, name: '기업마당' };
  }
  if (hostname === 'sbiz.or.kr' || hostname.endsWith('.sbiz.or.kr')) {
    return { isOfficial: true, name: '소상공인24' };
  }
  for (const [domain, name] of Object.entries(KNOWN_OR_KR)) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return { isOfficial: true, name };
    }
  }
  if (hostname.endsWith('.go.kr') || hostname === 'go.kr') {
    const parts = hostname.replace(/\.go\.kr$/, '').split('.');
    for (const part of parts) {
      if (KNOWN_GO[part]) return { isOfficial: true, name: KNOWN_GO[part] };
    }
    const label = parts[parts.length - 1] || hostname;
    return { isOfficial: true, name: label.toUpperCase() + ' (정부기관)' };
  }
  return {
    isOfficial: false,
    name: null,
    reason: '공식 공고 도메인이 아닙니다 (go.kr / bizinfo.go.kr / sbiz.or.kr 등 공식 URL을 사용해주세요).',
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
  const linkRe = /<a[^>]+href=["'][^"']*\.(?:pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const inner = stripHtml(m[1]).trim().replace(/\s+/g, ' ');
    if (inner.length > 4 && inner.length < 200) found.add(inner);
  }
  const fnRe = /["']([가-힣a-zA-Z0-9][가-힣a-zA-Z0-9\s\-_()\[\]·]+\.(?:pdf|hwp|hwpx|docx?|xlsx?|pptx?))["']/gi;
  while ((m = fnRe.exec(html)) !== null) {
    const name = m[1].trim();
    if (name.length > 5 && name.length < 200) found.add(name);
  }
  return [...found].slice(0, 20);
}

/* ── OpenAI로 공고 내용 분석 + 혜택형 꿀팁 생성 ──────── */
async function extractAndGenerateTip(inputText, source, apiKey) {
  const prompt = `당신은 소상공인 지원사업 공고문 분석 전문가이자 밀당레터 꿀팁 기획자입니다.

아래 공고 내용을 분석해서 혜택형 꿀팁 데이터를 생성하세요.
공고 출처: ${source.name || '제공된 자료'}
공고 URL: ${source.url || '없음'}

[공고 내용]
${inputText.slice(0, 4000)}

[지시]
1. 공고 본문에 있는 내용만 사용하세요. 없는 내용은 임의로 생성하지 마세요.
2. 여러 지원사업이 묶인 경우 가장 핵심 사업을 기준으로 작성하세요.
3. 순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "fetched_title": "공고 제목 (본문에서 추출, 없으면 빈 문자열)",
  "fetched_date": "작성일 또는 게시일 (YYYY.MM.DD 형식, 없으면 빈 문자열)",
  "organization": "기관명 또는 부서명 (본문에서 추출)",
  "benefit_facts": {
    "support_name": "지원사업명 (여러 개면 쉼표 구분)",
    "target": "지원대상 — 공고에 적힌 모든 조건을 원문 그대로 보존하세요 (절대 뭉개기 금지)\n      ⚠ 반드시 포함:\n        • 지역 조건 (예: '강원특별자치도 소재', '서울특별시 소재')\n        • 추가 자격 조건 (예: 'BuyKorea 등록 기업', '수출실적 보유 기업', '현지 파트너 보유')\n        • 업종·규모 조건 (예: '소상공인', '중소기업', '제조업')\n      ⚠ 금지: '중소기업'처럼 넓게 뭉개기\n        나쁜 예: '중소기업'\n        좋은 예: '강원특별자치도 소재 중소기업 중 BuyKorea 플랫폼 등록 기업'\n      (조건을 모를 경우 '공고문 확인 필요')",
    "benefit": "지원내용/금액 (본문에서 추출, 없으면 '공고문 확인 필요')",
    "period": "신청기간 (본문에서 추출, 없으면 '공고문 확인 필요')",
    "method": "신청방법 — 구체적인 신청 포털명·사이트명·기관명을 반드시 포함하세요\n      좋은 예: '무역투자24 홈페이지에서 온라인 신청'\n      좋은 예: '기업마당 공고에서 접수'\n      나쁜 예: '온라인 신청' (사이트명 없이 방법만)\n      (없으면 '공고문 확인 필요')",
    "contact": "문의처 전화·이메일 (본문에서 추출, 없으면 빈 문자열)",
    "caution": "주의사항 (본문에서 추출 / 없으면 빈 문자열 — '없음' 작성 금지, 그냥 비워두세요)",
    "confirmed_facts": "원고에 바로 사용 가능한 확정 사실 (본문 근거 있는 것만, 2~4줄)",
    "needs_verification": "추가 확인이 필요한 항목 (1~2줄, 없으면 빈 문자열)"
  },
  "tip_title": "밀당레터 꿀팁 제목 — 사장님 상황이 먼저 보이는 자연스러운 문장 (25자 이내)\n  규칙:\n  × 공고 제목 그대로 복붙 절대 금지\n  × '참여기업 모집', '신청하세요' 등 공고문식 표현 금지\n  × 공고에 없는 금액·대상 임의 추가 금지\n  ✅ '누가/어떤 상황이면 → 확인해보세요/챙겨보세요' 흐름으로 작성\n  ✅ 지역 조건이 명확한 공고(예: '[강원]', '강원특별자치도 소재')라면 → 제목에 지역을 자연스럽게 반영\n     예: '강원 소재 기업이라면, 호주 유통망 입점 지원사업도 챙겨보세요'\n     예: '강원에서 해외 진출 준비 중이라면, 유통망 입점 지원도 확인해보세요'\n  좋은 예: '온라인 판매로 해외 진출 중이라면, 물류비 지원사업도 챙겨보세요'\n  좋은 예: '수출 물류비 부담된다면, 이 지원사업 확인해보세요'\n  좋은 예: '폐업을 고민 중이라면, 지원사업 먼저 확인해보세요'\n  나쁜 예: '2026년 온라인수출 중소기업 물류 지원 사업(추경포함) 참여기업 모집 공고'",
  "tip_background": "왜 지금 이 혜택인가 — 시기·배경 1~2줄",
  "tip_target": "이런 사장님 대상 — 업종·규모·상황 구체적으로 (공고에 있는 내용만)",
  "tip_benefit": "직접 혜택 내용 (확인된 금액·기간·내용만 — 공고에 없는 내용 임의 생성 금지)",
  "tip_check_now": "지금 당장 확인할 것 3~4가지 (번호 매기기, 공고에 근거한 것만)",
  "tip_caution": "주의사항 (공고에서 추출 / 없으면 '신청 전 공고문과 접수처의 세부 조건을 반드시 확인해주세요.' 사용 / '없음' 작성 금지)",
  "confidence": "높음 (지원대상·금액·기간·방법 중 3개 이상 확인) | 보통 (1~2개 확인) | 낮음 (핵심 정보 부족)",
  "warning": "주의가 필요한 경우 메시지 | 빈 문자열"
}`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1800,
      temperature: 0.2,
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

/* ── PDF 업로드 → 텍스트 추출 via OpenAI Files API ──── */
async function extractPdfText(fileBase64, fileName, apiKey) {
  // OpenAI Files API에 PDF 업로드
  const binaryStr = atob(fileBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'application/pdf' });

  const formData = new FormData();
  formData.append('file', blob, fileName || 'document.pdf');
  formData.append('purpose', 'assistants');

  const uploadResp = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  if (!uploadResp.ok) {
    const err = await uploadResp.text();
    throw new Error('PDF 업로드 실패: ' + err.slice(0, 200));
  }
  const uploadData = await uploadResp.json();
  const fileId = uploadData.id;
  console.log('[extract-benefit] PDF uploaded, file_id:', fileId);

  // gpt-4o-mini로 PDF 내용 요청 (file_id 참조)
  const extractResp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 3000,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: '이 PDF 공고문의 전체 텍스트를 그대로 추출해서 출력하세요. 형식 변환 없이 원문 그대로 출력하세요.',
          },
          {
            type: 'file',
            file: { file_id: fileId },
          },
        ],
      }],
    }),
  });

  // 파일 삭제 (비동기, 결과 무시)
  fetch('https://api.openai.com/v1/files/' + fileId, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  }).catch(() => {});

  if (!extractResp.ok) throw new Error('PDF 텍스트 추출 실패: ' + extractResp.status);
  const extractData = await extractResp.json();
  return (extractData.choices?.[0]?.message?.content || '').trim();
}

/* ── Handler ────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { pastedText, officialUrl, fileBase64, fileName } = req.body || {};
  const apiKey = process.env.OPENAI_API_KEY;

  const hasPaste = !!(pastedText && pastedText.trim());
  const hasPdf   = !!(fileBase64 && fileBase64.trim());
  const hasUrl   = !!(officialUrl && officialUrl.trim());

  if (!hasPaste && !hasPdf && !hasUrl) {
    return res.status(400).json({ ok: false, message: '공고 URL, PDF 파일, 또는 붙여넣기 내용 중 하나가 필요합니다.' });
  }

  let inputText = '';
  let source = { name: '직접 입력', url: '' };

  /* ── 우선순위 1: 붙여넣기 텍스트 ── */
  if (hasPaste) {
    inputText = pastedText.trim().slice(0, 8000);
    source = { name: '붙여넣기 자료', url: officialUrl ? officialUrl.trim() : '' };
    console.log('[extract-benefit] mode: pastedText, len:', inputText.length);
  }
  /* ── 우선순위 2: PDF 파일 ── */
  else if (hasPdf) {
    if (!apiKey) {
      return res.status(200).json({ ok: false, message: 'PDF 처리에는 OpenAI API 키가 필요합니다.' });
    }
    try {
      console.log('[extract-benefit] mode: PDF, fileName:', fileName);
      inputText = await extractPdfText(fileBase64, fileName || 'document.pdf', apiKey);
      source = { name: fileName ? fileName.replace(/\.pdf$/i, '') : 'PDF 공고문', url: officialUrl ? officialUrl.trim() : '' };
      console.log('[extract-benefit] PDF text extracted, len:', inputText.length);
    } catch (e) {
      console.error('[extract-benefit] PDF 처리 실패:', e.message);
      return res.status(200).json({ ok: false, message: 'PDF 내용을 읽지 못했습니다: ' + e.message });
    }
  }
  /* ── 우선순위 3: 공식 URL ── */
  else if (hasUrl) {
    const cleanUrl = officialUrl.trim();

    // 도메인 검증
    const domainInfo = getOfficialDomainInfo(cleanUrl);
    if (!domainInfo.isOfficial) {
      console.log('[extract-benefit] 비공식 도메인:', cleanUrl.slice(0, 80), '|', domainInfo.reason);
      return res.status(200).json({
        ok: false,
        error_type: 'not_official',
        message: domainInfo.reason || '공식 공고 링크가 아닙니다.',
      });
    }

    // HTML fetch
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
      const html = await fetchRes.text();
      const attachments = extractAttachments(html);
      inputText = stripHtml(html).slice(0, 5000);
      if (attachments.length > 0) {
        inputText += '\n\n[첨부파일 목록]\n' + attachments.map((a, i) => '  [' + (i + 1) + '] ' + a).join('\n');
      }
      source = { name: domainInfo.name || '공식 공고', url: cleanUrl };
      console.log('[extract-benefit] mode: URL, domain:', domainInfo.name, ', textLen:', inputText.length);
    } catch (e) {
      console.error('[extract-benefit] fetch 실패:', e.message);
      return res.status(200).json({
        ok: false,
        error_type: 'fetch_failed',
        message: '공고 페이지를 읽지 못했습니다. (' + e.message + ')\n공고 내용을 복사해서 붙여넣기 방식을 이용해주세요.',
      });
    }
  }

  if (!inputText.trim()) {
    return res.status(200).json({ ok: false, message: '공고 내용을 읽지 못했습니다.' });
  }

  /* ── AI 분석 + 꿀팁 생성 ── */
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      message: 'OpenAI API 키가 설정되지 않았습니다.',
    });
  }

  let extracted;
  try {
    extracted = await extractAndGenerateTip(inputText, source, apiKey);
    console.log('[extract-benefit] AI 완료 — fetched_title:', (extracted.fetched_title || '').slice(0, 60));
  } catch (e) {
    console.error('[extract-benefit] AI 분석 실패:', e.message);
    return res.status(200).json({
      ok: false,
      message: '공고 내용 분석 중 오류가 발생했습니다: ' + e.message,
    });
  }

  /* ── 혜택형 tip 객체 구성 ── */
  const bf = extracted.benefit_facts || {};

  /* tipTitle: 밀당레터 톤 제목 (사장님 상황 중심) */
  const tipTitle = extracted.tip_title
    || (bf.support_name ? bf.support_name.slice(0, 40) : '');

  /* caution 정규화: 빈 값 / "없음" / "해당 없음" → 기본 안내 문구로 대체 */
  const tipCaution = normalizeCaution(extracted.tip_caution || bf.caution || '');
  if (bf.caution !== undefined) bf.caution = normalizeCaution(bf.caution);

  const tip = {
    type:             '혜택형',
    /* title: 밀당레터 톤 제목 → 카드 + 원고 headline의 기준 */
    title:            tipTitle,
    background:       extracted.tip_background  || '',
    target:           extracted.tip_target      || bf.target     || '',
    benefit:          extracted.tip_benefit     || bf.benefit    || '',
    check_now:        extracted.tip_check_now   || '',
    caution:          tipCaution,
    duplicate_check:  '신규',
    similar_issues:   '없음',
    source_name:      source.name               || '',
    source_url:       source.url                || '',
    source_verified:  true,
    /* 공식 공고 fetch 데이터 */
    fetched_title:        extracted.fetched_title        || '',
    fetched_date:         extracted.fetched_date         || '',
    fetched_body_summary: '',
    benefit_facts:        bf,
    source_confidence:    extracted.confidence  || '보통',
    source_warning:       extracted.warning     || '',
    source_locked:        true,
    source_locked_title:  extracted.fetched_title || '',
    /* display_title: 카드 표시용 — 밀당레터 톤 제목 우선, 공고명은 fetched_title에 별도 보관 */
    display_title: tipTitle || extracted.fetched_title || bf.support_name || '',
    /* 직접 입력 여부 플래그 */
    is_user_provided: true,
  };

  return res.status(200).json({ ok: true, tip });
}
