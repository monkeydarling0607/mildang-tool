// api/generate.js — Vercel Serverless Function
// OPENAI_API_KEY는 서버 환경변수에서만 관리

const ALLOWED_TYPES = [
  'analyze',       // 1. 직전 회차 분석
  'subjects',      // 2. 주제 후보 생성
  'stories',       // 3. 사연 후보 생성 (선택 주제 기반)
  'story_draft',   // 4. 완성형 사연모음 원고
  'tips',          // 5. 꿀팁 후보 생성
  'tip_draft',     // 6. 완성형 꿀팁 원고
  'quiz',          // 7. 세무퀴즈 생성 (형식·난이도 파라미터)
  'news_draft',    // 8. 사용자 입력 뉴스 → 완성형 브리핑 원고
  'opening',       // 9. 오프닝 후보 생성
  'opening_draft', // 10. 완성형 오프닝 원고
  'remind',        // 11. 리마인드 후보 생성
  'remind_draft',  // 12. 완성형 리마인드 원고
  'titles',        // 13. 카카오 플친 제목 후보
];

// draft 타입은 긴 원고를 생성하므로 토큰을 넉넉히 설정
const MAX_TOKENS = {
  analyze:        1400,
  subjects:       2800,
  stories:        1800,
  story_draft:    2800,
  tips:           2000,
  tip_draft:      2500,
  quiz:           1200,
  news_draft:     2000,
  opening:        2000,
  opening_draft:  1500,
  remind:         1200,
  remind_draft:    800,
  titles:         1800,
};

// ── 프롬프트 빌더 (타입별 개별 함수) ──────────────────

function buildAnalyzePrompt(p) {
  const now = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
  const hasPrevTitle = p.prevTitle && p.prevTitle.trim();

  return `당신은 세무법인 밀당레터 콘텐츠 분석가입니다.
밀당레터는 소상공인·자영업자를 위한 세무법인 뉴스레터입니다.
밀당레터는 시리즈물이 아닙니다. 직전 회차 분석은 중복 소재 회피와 패턴 참고에만 사용합니다.
이번 회차 추천 방향은 직전 회차와 완전히 독립적인 기획안이어야 합니다.

[직전 회차 성과]
CTR: ${p.ctr}%  공유수: ${p.share}건  비고: ${p.note || '없음'}
권장 유형: ${p.recType}
${hasPrevTitle ? `[중요] 직전 회차 제목 (사용자 직접 입력 — 이 값을 title 필드에 그대로 사용하세요): "${p.prevTitle}"` : '직접 입력 제목: (없음 — HTML에서 추출하세요)'}

[직전 회차 본문 텍스트]
${p.bodyText ? p.bodyText.slice(0, 4000) : '(HTML 미제공 — 수치 기반으로만 분석)'}

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "title": "${hasPrevTitle ? p.prevTitle.replace(/"/g, '\\"') : '(HTML에서 추출한 제목 또는 빈 문자열)'}",
  "topic": "직전 회차에서 실제로 다룬 핵심 세무 소재 한 줄. 반드시 직전 회차 제목·본문에서 추출하세요. 이번 회차 기획 내용을 넣으면 절대 안 됩니다. (나쁜 예: '5월 종소세 신고 전 비용처리 항목 TOP 5' ← 이건 미래 기획 / 좋은 예: '포괄양수도와 사업자 변경 시 부가세 리스크', '임대차 계약 갱신 시 세금 리스크')",
  "keywords": ["직전 회차 반복 단어/표현1", "단어2", "단어3"],
  "opening_pattern": "직전 회차 오프닝 패턴",
  "cta_pattern": "직전 회차 CTA 패턴",
  "avoid": ["이번 회차에서 반드시 피해야 할 소재1", "소재2", "소재3"],
  "body_structure": "직전 회차 본문 구조 (섹션 순서·분량)",
  "prev_covered": "직전 회차에서 다룬 소재 (2~3줄 요약 — 이번에 제외할 기준)",
  "avoid_material": "이번 회차에서 제외할 소재. prev_covered에 나온 직전 회차 핵심 세무 소재 키워드만 나열하세요. 이번 회차 기획에 필요한 소재를 여기 넣으면 안 됩니다. 공통 섹션(구독 안내, 인사말, 푸터) 단어도 금지. (나쁜 예: '종소세 신고, 비용항목' ← 이건 이번 회차에 필요한 소재 / 좋은 예: '포괄양수도', '사업자 변경', '가게 인수', '부가세 리스크', '권리금 세무처리')",
  "current_interest": ["현재 시기(${now}) 소상공인 관심사 범주1 (예: 종합소득세)", "범주2 (예: 비용처리)", "범주3", "범주4", "범주5"],
  "direction_hints": "2페이지 주제 선정 시 참고할 방향 힌트 (특정 주제 확정 금지. 직전 소재 제외, 현재 시기·소상공인 관심사 기준으로 고려할 만한 방향 3~4문장)"
}

[직전 회차 분석 기준]
${hasPrevTitle
  ? `- title: 반드시 "${p.prevTitle}" 을 그대로 사용. AI가 재구성하거나 다른 제목을 쓰는 것 절대 금지.`
  : '- title: bodyText 내 제목 태그/패턴 탐색. 없으면 빈 문자열.'}
- topic: 직전 회차 제목·본문에서 실제로 다룬 소재를 추출. 이번 회차 기획(direction)이 아니라 직전 회차의 과거 실제 소재여야 합니다. "소상공인 지원", "경영 관리" 같은 넓은 표현 금지. HTML 없으면 제목만으로 추출.
- avoid_material: prev_covered 기준으로만 추출하세요. direction·current_interest에 필요한 소재는 절대 포함 금지. 구독 안내·인사말·공통 섹션 단어 제외. HTML 없으면 제목에서 유추 가능한 소재만.
- keywords: HTML 없으면 빈 배열. 있으면 3~5개, 실제 반복 단어 위주.
- avoid: 직전 소재 중 이번에 반복하면 식상할 것 3개 이상.
- body_structure: HTML 섹션 기준. 미제공 시 "(본문 미제공)".

[필드 분리 원칙 — 반드시 준수]
- topic · prev_covered · avoid_material · keywords: 직전 회차 실제 내용 기준 (과거)
- current_interest · direction_hints: 현재 시기 참고 자료 (미래 기획의 힌트)
- 이 두 그룹의 내용을 절대 혼용하지 마세요. direction_hints에 쓴 소재가 topic·avoid_material에 들어가면 안 됩니다.

[direction_hints 작성 규칙]
1. 특정 주제를 확정하거나 "~하면 좋겠다"처럼 주제를 결정하지 마세요.
2. 직전 회차 소재(avoid_material)와 겹치지 않는 관심사 범위를 힌트 형태로만 제시하세요.
3. 현재 시기(${now}) 기준 소상공인이 궁금해할 만한 세무 범주를 3~4문장으로 서술하세요.
4. CTR ${p.ctr}% 기반 참고: ${p.ctr >= 4 ? '후킹 구조(제목·오프닝 방식) 유지 권장.' : p.ctr >= 3 ? '제목 훅 강화 권장.' : '제목·오프닝 구조 전환 권장.'}
5. current_interest 배열은 현재 시기상 소상공인 관심사를 범주 단위(단어·짧은 구)로 3~5개 제시하세요. (예: "종합소득세", "비용처리", "인건비·4대보험", "지원금·정책자금")`;
}

function buildSubjectsPrompt(p) {
  const now       = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
  const avoidList = Array.isArray(p.avoid)        ? p.avoid.join(', ')        : (p.avoid || '없음');
  const kwList    = Array.isArray(p.prevKeywords) ? p.prevKeywords.join(', ') : (p.prevKeywords || '없음');

  const archive   = Array.isArray(p.archive) ? p.archive : [];
  const archiveSection = archive.length > 0
    ? `\n[과거 회차 아카이브 — 단어 중복뿐 아니라 구조·소재군·감정 패턴까지 중복 금지]
${archive.map((a, i) => {
  const parts = [];
  if (a.date)             parts.push(`날짜: ${a.date}`);
  if (a.kakaoTitle)       parts.push(`카카오 제목: 「${a.kakaoTitle}」`);
  if (a.topic)            parts.push(`핵심 주제: ${a.topic}`);
  if (a.storySummary)     parts.push(`사연 소재: ${a.storySummary}`);
  if (a.tipSummary)       parts.push(`꿀팁 소재: ${a.tipSummary}`);
  if (a.avoidExpressions) parts.push(`피해야 할 표현·소재: ${a.avoidExpressions}`);
  return `[${i + 1}] ${parts.join(' / ')}`;
}).join('\n')}

중복으로 판단해서 이번 주제에서 반드시 피할 것:
- 위 카카오 제목과 비슷한 리듬·문장 구조 (예: "A 했는데 B 안 된다" 패턴이 이미 있으면 동일 구조 금지)
- 같은 소재군 재사용 (세금 신고/지원금/보험료/비용처리/인건비 등 과거에 쓴 군은 이번에 제외)
- 같은 감정 패턴 반복 ("왜 나만", "끝난 줄 알았는데", "몰랐는데 손해" 등 과거에 쓴 패턴 금지)
- 과거 사연 소재와 유사한 상황\n`
    : '';

  return `당신은 세무법인 밀당레터 콘텐츠 기획자입니다.
밀당레터는 소상공인·자영업자를 대상으로 하는 세무법인 뉴스레터입니다.
매 회차 핵심은 "사장님의 실제 고민 사연"이며, 사연 중심으로 꿀팁·퀴즈·뉴스가 연결됩니다.
${archiveSection}
[직전 회차 중복 회피 자료 — 아래 소재는 이번 주제에서 반드시 제외]
직전 제목: ${p.prevTitle || '없음'}
직전 주제: ${p.prevTopic || '없음'}
반복 키워드: ${kwList}
피해야 할 소재: ${avoidList}
직전 오프닝 패턴: ${p.openingPattern || '없음'}
직전 CTA 패턴: ${p.ctaPattern || '없음'}
위 내용은 중복 회피 목적으로만 참고하세요. 주제 선정의 방향이나 근거로 쓰지 마세요.

[이번 회차 주제 선정 기준 — AI가 현재 시기 기준으로 독립 판단]
현재 시기: ${now}
아래 기준으로 지금 소상공인·자영업자에게 가장 클릭·공유될 주제 5개를 직접 판단하세요.
- 세금 신고·납부 시즌 (소득세, 부가세, 원천세 등)
- 정책·지원금·융자 (신청 기한, 자격 요건, 놓치기 쉬운 항목)
- 노무·인건비·4대보험 (고용 현장 이슈)
- 비용처리·절세 (실무 적용 가능한 포인트)
- 생활경제·금리·임차료 (사장님 재정 부담)
- 사장님 실수·후회담 (경험 기반 공감 유도)
CTR ${p.ctr}% 기준: ${p.ctr >= 4 ? '고클릭 → 후킹 구조 유지, 사연화 가능성 높은 주제 강화' : p.ctr >= 3 ? '평균 → 제목 훅 강화, 공감형 주제 비중 높이기' : '저클릭 → 제목·오프닝 구조 전환, 손해반전형·놓침형 우선'}
권장 유형: ${p.recType}

[title 작성 규칙 — 반드시 준수]
title은 CTR을 끌어올리는 강한 훅이어야 합니다. 22자 이내.

나쁜 예 (절대 사용 금지):
- "종합소득세 신고 방법" → 카테고리형
- "4대보험 가입 안내" → 정보 설명형
- "비용처리 절세 전략" → 강의 제목형
- 질문형(?)만 5개 연속 → 패턴 단조화 금지

title은 아래 4가지 패턴을 섞어서 5개 중 각기 다른 패턴으로 작성하세요.

[패턴1 반전형] 예상과 다른 결과, 놀람
- "끝난 줄 알았는데 또 내랍니다"
- "됩니다 했는데 저는 안 됐네요"
- "이 비용, 그냥 버린 겁니다"

[패턴2 억울형] 나만 손해, 불공평 감정
- "왜 저만 가산세 붙은 걸까요"
- "같은 매출인데 세금이 다릅니다"
- "지원금, 나만 못 받은 이유"

[패턴3 체감형] 수치·결과로 직접 전달
- "월급 올렸더니 남는 게 줄었습니다"
- "카드 매출 늘었는데 돈이 없습니다"
- "대출받았는데 세금도 늘었습니다"

[패턴4 현실 대화형] 사장님이 직접 겪는 장면
- "이건 비용 처리 안 된다고 하네요"
- "직원 한 명인데 벌써 복잡합니다"
- "작년에 산 거, 비용 안 된대요"

title 필수 조건:
1. 실제 사장님 말투 (반말체·구어체 허용)
2. 감정 우선순위: ① 비교 심리 → ② 손해 체감 → ③ 반전 → ④ 억울함
   - 비교 심리: "같이 했는데 저만 안 됐어요", "같은 매출인데 세금이 다릅니다"
   - 손해 체감: "매출은 늘었는데 남는 게 없어요", "월급 올렸더니 오히려 줄었습니다"
   - 반전: "분명 썼는데 비용이 안 된대요", "끝난 줄 알았는데 또 내랍니다"
   - 억울함: "왜 저만 더 나온 걸까요", "나만 못 받은 거였네요"
3. 물음표(?)는 5개 중 최대 2개 — 나머지 3개 이상은 반드시 진술형 자연어
4. 같은 어미 반복 금지 (~요? ~네요 ~습니다 연속 금지)
5. 22자 이내
6. 5개 title이 모두 다른 패턴이어야 함
7. AI가 만든 느낌 금지 — 사람이 실제 말하는 문장처럼

[summary 작성 규칙]
summary는 title의 상황을 조금 더 풀어주는 한 문장으로, 사장님이 실제 겪는 일을 구체적으로 묘사하세요.
- 추상적 요약 금지 ("비용처리 절세 방법 안내" → 사용 불가)
- title이 던진 상황을 받아서 구체화 ("신고 마쳤는데 가산세 고지서가 날아와 당황한 경우" 같은 톤)

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "subjects": [
    {
      "title": "22자 이내, 실제 사장님 말투, 손해·불안·억울함·반전 감정이 느껴지는 강한 훅",
      "summary": "title 상황을 받아서 사장님이 실제 겪는 일 한 문장 (구체적 묘사)",
      "story_potential": "사연화 가능성 (높음/보통/낮음 + 이유 한 줄)",
      "protagonist": "예상 사연 주인공 (업종, 나이대, 상황)",
      "concern": "예상 고민 상황",
      "conflict": "갈등/문제 포인트",
      "tax_question": "세무사에게 물어볼 핵심 질문",
      "reason": "이 주제로 사연모음을 쓰면 좋은 이유",
      "risk": "사연으로 풀기 어려운 리스크",
      "tip_quiz_direction": "예상 꿀팁/퀴즈 연결 방향",
      "hook": "클릭 유도 훅 (22자 이내)",
      "type": "나해당형"
    }
  ]
}

[배열 개수]
subjects: 정확히 5개

[type 분류 — 아래 중 하나]
나해당형 / 손해반전형 / 놓침형 / 헷갈림형 / 현실질문형 / 정책체감형

[기준]
- 직전 주제(${p.prevTopic || '없음'}) 소재 직접 중복 금지
- 피해야 할 소재 회피: ${avoidList}
- 정책·지원금 단순 안내형보다 사장님 실제 고민으로 풀 수 있는 주제 우선
- story_potential이 "높음"인 주제 3개 이상 포함
- hook은 22자 이내, 돈/손해/지원금/반전/내얘기 훅 강화
- 정책·지원금 주제는 최대 1개
- 5개 주제가 서로 다른 type을 갖도록 구성`;
}

function buildStoriesPrompt(p) {
  return `당신은 세무법인 밀당레터 사연 기획자입니다.
선택 주제를 기반으로 사연 후보 카드 3개를 생성하세요.
완성형 원고는 불필요합니다. 후보 카드 선택용 정보만 작성하세요.

[선택 주제]
주제명: ${p.subjectTitle}
요약: ${p.subjectSummary || ''}
예상 주인공: ${p.protagonist || ''}
예상 고민: ${p.concern || ''}
세무 핵심 질문: ${p.taxQuestion || ''}

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "stories": [
    {
      "tone": "사연 유형명",
      "industry": "업종 및 상황 (예: 카페 운영 3년차, 직원 2명)",
      "narrator_profile": "사연자 프로필 한 줄 (업종, 나이대, 운영기간)",
      "title": "사연 제목 (사장님이 직접 붙인 제목처럼, 한 줄)",
      "text": "사장님이 직접 말하는 구어체 2~3줄. 상황·감정·고민이 느껴지게. 각 tone에 맞는 말투 사용.",
      "concern": "사장님이 실제로 하는 말투로. 예: '이게 비용처리가 되는 건지 모르겠어서요'",
      "emotion_point": "사장님 속마음을 직접 표현. 예: '억울하기도 하고 제가 뭘 잘못한 건지 모르겠어요'",
      "question": "실제로 세무사에게 보내는 문자 말투. 예: '제가 이 경우에도 환급받을 수 있는 건가요?'",
      "reason": "공감 중심 한 줄. 예: '비슷한 상황인 분들이 꽤 많아서 읽자마자 자기 이야기처럼 느낄 수 있습니다'"
    }
  ]
}

[배열 개수] stories: 정확히 3개

[tone — 반드시 아래 3개를 각 1개씩, 말투가 뚜렷하게 달라야 함]
1. "처음 겪는 상황형" — 담담하고 당혹스러운 말투. "어쩌다 보니 이런 상황이 됐는데요..." 느낌.
2. "이미 하고 있는데 맞나형" — 헷갈리고 불안한 말투. "이렇게 해왔는데 혹시 제가 잘못하고 있는 건 아닌가요?" 느낌.
3. "억울함·손해형" — 억울하고 속상한 말투. "분명히 제가 맞게 한 것 같은데 왜 저만 이렇게 되는 건지..." 느낌.

[text 작성 규칙]
- 설명문·요약문 금지. 사장님이 말하는 장면처럼.
- 나쁜 예: "최근 대출받아 재고 늘리니 세금까지 늘어나더라고요" (요약형)
- 좋은 예: "대출은 받아서 숨통이 트이나 했는데, 세금까지 같이 늘 줄은 몰랐어요" (말하는 장면)
- 3개의 text가 서로 말투·어조·감정이 뚜렷하게 달라야 함

[기준]
- 3개는 서로 다른 업종·나이대로 구성
- concern/emotion_point/question/reason 모두 사장님 말투 또는 공감형 문장으로`;
}

function buildStoryDraftPrompt(p) {
  const toneGuide =
    p.storyTone && p.storyTone.includes('억울') ?
      '억울형: 감정 표현 강하게. 속상함·억울함이 문장 곳곳에 배어나오게. "왜 저만", "분명히 맞게 한 것 같은데" 허용.' :
    p.storyTone && p.storyTone.includes('맞나') ?
      '헷갈림형: 불안하고 확신이 없는 말투. 질문이 많음. "이게 맞나 싶더라고요", "혹시 제가 잘못하고 있는 건 아닌지" 허용.' :
      '담담형: 차분하고 사실 위주. 감정은 잔잔하게. "어쩌다 보니", "그게 문제가 될 줄은 몰랐어요" 허용.';

  return `당신은 세무법인 밀당레터 사연모음 작가입니다.
사장님이 세무 상담 신청 글이나 카톡으로 보낸 것처럼 써야 합니다.
정리된 글이 아닌, 말하다 보니 이렇게 됐다는 느낌의 원고.

[선택 정보]
주제: ${p.subjectTitle}
사연 유형: ${p.storyTone}
사연 미리보기: ${p.storyText}
사연자 프로필: ${p.narratorProfile || ''}
세무 핵심 질문: ${p.taxQuestion || ''}
갈등/문제: ${p.conflict || ''}

[말투 방향]
${toneGuide}

[body 작성 기준]
- 권장 350~500자, 절대 500자 초과 금지
- 3~5문단, 문단 길이 불균형 허용 (짧은 문단 섞기)
- 파트 제목(도입/본문/감정 등) 절대 표시 금지
- 아래 흐름으로 자연스럽게 연결:
  ① 상황 시작 — 첫 문장이 핵심. 설명형 금지.
    나쁜 예: "저는 카페를 운영하고 있는데요" / "제가 온라인 쇼핑몰을 운영 중입니다"
    좋은 예: "요즘 자금이 자꾸 꼬여서 대출까지 받게 됐어요" / "비용 처리 되는 줄 알고 썼는데 아니라고 하더라고요"
  ② 실제 문제 — 상황 구체화, 금액·날짜·행동이 느껴지게
  ③ 감정/헷갈림 — 짧고 강하게 1~2문장
  ④ 세무사에게 묻는 질문 — 실제 말투 그대로
  ⑤ 마무리 — 1문장, 다음 섹션(꿀팁)으로 자연 연결. 설명으로 끝내지 말 것

[절대 금지 표현 — body에 사용 금지]
결국 / 따라서 / 즉 / 한편 / 이에 따라 / 정리하자면 / 현재 상황에서 / 가장 고민되는 부분은

[허용 표현 예시]
"이게 맞나 싶더라고요" / "좀 이상했어요" / "괜히 불안하더라고요"
"이럴 땐 제가 뭘 먼저 봐야 하는 걸까요?" / "처음엔 그냥 그런가 했는데요"

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "title": "사장님이 직접 붙인 것 같은 제목 (한 줄)",
  "narrator": "사연자 설정 한 줄 (예: 올해 초 카페 오픈한 38살 사장님, 직원 1명)",
  "body": "350~500자. 3~5문단. \\n\\n으로 문단 구분. 말하듯 써 내려간 사장님 사연.",
  "expert_opinions": [
    "의견1 — 180~280자. 왜 이런 문제가 생기는지. 쉬운 말로, 예시 중심.",
    "의견2 — 180~280자. 사장님들이 많이 헷갈리는 포인트. 구체적으로.",
    "의견3 — 180~280자. 지금 바로 확인해야 할 것. 행동 가능하게."
  ]
}

[expert_opinions 작성 규칙]
- 반드시 3개, 의견1(원인) / 의견2(헷갈리는포인트) / 의견3(대응) 순서 고정
- 각 의견 180~280자
- 세 의견에서 같은 단어·내용 반복 절대 금지
- body와 겹치지 말 것 — body는 사장님 경험, opinions는 전문가 해석

[expert_opinions 말투 규칙 — 반드시 준수]
나쁜 예 (절대 사용 금지):
- "비용의 발생 시점과 사용 목적" → 법조문 말투
- "세법상 인정 여부" → 딱딱한 용어
- "사업의 필요성 입증" → 보고서 말투
- "이에 따라 / 따라서 / 즉" → 접속사 나열

좋은 예 (이 톤으로):
- "비용 처리는 '돈을 썼다'만으로 되는 건 아닙니다. 중요한 건 이 돈이 정말 사업 때문에 나간 돈인지예요."
- "광고비는 사장님들이 많이 헷갈려하는 항목입니다. 같은 광고비라도 어디에 썼는지에 따라 판단이 달라질 수 있어요."
- "지금은 먼저 최근에 쓴 내역을 모아보는 게 좋습니다. 카드내역, 세금계산서처럼 '사업용으로 쓴 돈'이라는 걸 보여줄 자료가 있으면 판단이 쉬워집니다."

규칙:
- 전문가답되 친구가 설명하듯 쉽게
- 문장 짧게, 어려운 세무 용어는 쉬운 말로 풀기
- "그래서 뭘 보면 되는지"가 바로 보여야 함
- 의견마다 관점이 뚜렷하게 달라야 함`;
}

function buildTipsPrompt(p) {
  return `당신은 세무법인 밀당레터 꿀팁 기획자입니다.

[이번 회차 정보]
주제: ${p.subjectTitle}
주제 유형: ${p.subjectType || ''}
사연 요약: ${p.storyText || '미선택'}
CTR: ${p.ctr}%
사용자 입력 뉴스/정책 메모: ${p.userNewsInput || '없음'}

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "tips": [
    {
      "type": "꿀팁 유형",
      "title": "꿀팁 제목",
      "reason": "이 주제/사연과 연결되는 이유",
      "benefit": "사장님 실익 (구체적으로)",
      "direction": "원고 방향 (어떻게 쓸지 한 줄)",
      "caution": "주의할 점"
    }
  ]
}

[배열 개수]
tips: 정확히 4개 (서로 다른 유형)

[꿀팁 유형 목록]
- 정책/지원금/정부혜택
- 세무 체크리스트
- 비용처리/증빙 실무팁
- 부가세/종소세/인건비 주의사항
- 사업자변경/포괄양수도/계약 체크사항
- 뉴스이슈 연결 실무팁

[기준]
- 사용자 입력 뉴스/정책 메모가 있으면 우선 반영하여 꿀팁 구성
- 주제/사연과 직접 연결되는 꿀팁 우선
- benefit은 "사장님이 이 꿀팁으로 당장 할 수 있는 것" 중심으로 구체적으로
- 4개가 서로 다른 유형을 갖도록 구성`;
}

function buildTipDraftPrompt(p) {
  return `당신은 세무법인 밀당레터 꿀팁 작가입니다.

[선택 꿀팁 정보]
주제: ${p.subjectTitle}
꿀팁 유형: ${p.tipType}
꿀팁 제목: ${p.tipTitle}
원고 방향: ${p.tipDirection || ''}
사연 요약: ${p.storyText || '없음'}
주의할 점: ${p.tipCaution || '없음'}

[밀당레터 꿀팁 원고 형식]
- 헤드라인: 사장님이 바로 관심 갖는 한 줄
- 도입부: 왜 이 꿀팁이 필요한지 공감형 1~2문장
- 본문: 실무 정보를 3~5개 항목 또는 자연스러운 문단 (• 기호 또는 번호 목록 활용)
- CTA: 다음 행동 유도 한 문장
- 한 줄 요약: 독자가 기억할 핵심 포인트

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "headline": "꿀팁 헤드라인",
  "intro": "도입부 1~2문장",
  "body": "본문 전체 (\\n\\n으로 문단/항목 구분, • 또는 번호 목록 활용, 최소 200자)",
  "cta": "CTA 문장",
  "summary": "한 줄 요약"
}

[기준]
- 딱딱하지 않게. 사장님이 바로 써먹을 수 있는 표현
- 전문 용어는 괄호로 쉽게 풀어서
- 지원금/정책 꿀팁이면 신청 기한·방법 구체적으로
- body 최소 200자 이상`;
}

function buildQuizPrompt(p) {
  const isOX      = (p.format || 'ox') === 'ox';
  const diffLabel = p.difficulty === 'easy' ? '쉬움' : p.difficulty === 'hard' ? '어려움' : '보통';

  const outputFormat = isOX
    ? `{
  "quiz_title": "퀴즈 제목",
  "question": "O/X 문제 (사장님이 헷갈릴 법한 세무 상식)",
  "answer": "O",
  "explanation": "정답 해설 (2~4문장, 실무 근거 포함)",
  "key_point": "사장님이 기억해야 할 한 줄 포인트"
}`
    : `{
  "quiz_title": "퀴즈 제목",
  "question": "4지선다 문제",
  "options": ["보기1", "보기2", "보기3", "보기4"],
  "answer": 0,
  "explanation": "정답 해설 (2~4문장, 실무 근거 포함)",
  "key_point": "사장님이 기억해야 할 한 줄 포인트"
}`;

  return `당신은 세무법인 밀당레터 세무퀴즈 출제자입니다.

[이번 회차 정보]
주제: ${p.subjectTitle}
사연 요약: ${p.storyText || '없음'}
꿀팁 제목: ${p.tipTitle || '없음'}
퀴즈 형식: ${isOX ? 'O/X 퀴즈' : '4지선다 퀴즈'}
난이도: ${diffLabel}

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

${outputFormat}

[기준]
- 주제·사연·꿀팁과 연결된 세무 상식 문제
- 쉬움: 대부분 알지만 한 번 더 확인하면 좋은 내용
- 보통: 헷갈리기 쉬운 실무 상식
- 어려움: 실무에서 자주 틀리는 세부 규정
${isOX
  ? '- answer는 반드시 "O" 또는 "X" 문자열만 사용'
  : '- answer는 0~3 사이 정수 인덱스 (options 배열 기준)'
}
- key_point는 한 문장, 독자가 카톡으로 공유하고 싶을 포인트`;
}

function buildNewsDraftPrompt(p) {
  const newsBlock = (p.selectedNews || []).map((n, i) =>
    `[뉴스${i + 1}]
제목: ${n.title || '없음'}
발행일: ${n.date || '없음'}
출처/언론사: ${n.source || '없음'}
원문 링크: ${n.link || '없음'}
요약/메모: ${n.summary || '없음'}`
  ).join('\n\n');

  const newsCount = (p.selectedNews || []).length;

  return `당신은 세무법인 밀당레터 뉴스 한입 브리핑 작가입니다.
밀당레터 뉴스 한입 브리핑은 사장님/소상공인에게 실질적으로 도움이 되는 뉴스를 짧고 임팩트 있게 정리하는 섹션입니다.

[이번 회차 정보]
이번 회차 주제: ${p.subjectTitle || '미선택'}

[사용자 입력 뉴스 (${newsCount}개)]
${newsBlock || '(입력된 뉴스 없음)'}

[뉴스 브리핑 선별 기준]
1순위: 사장님/소상공인/자영업자/사업자에게 실질적으로 도움이 되는 뉴스
2순위: 대한민국 국민이라면 알아두면 좋은 생활·경제·정책 뉴스
제외: 정치적·논쟁적 뉴스. 돈/세금/생활비/지원금/금융/노무/소비자피해/정책변화 중심.
딱딱한 기사 요약 금지. "사장님 관점에서 왜 중요한지" 중심 해설.

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "briefing": [
    {
      "headline": "뉴스 헤드라인 (원제목 그대로 또는 약간 다듬기)",
      "date_label": "발행일 표시 (예: 4월 22일)",
      "source": "출처/언론사",
      "link": "원문 링크 (없으면 빈 문자열)",
      "body": "사장님 관점 브리핑 본문 (2~3문장, 왜 중요한지 중심)",
      "ceo_point": "사장님이 기억해야 할 포인트 한 줄"
    }
  ]
}

[기준]
- briefing 배열 개수 = 입력 뉴스 개수 (${newsCount}개)
- 원문 링크·출처·발행일은 입력값 그대로 보존 (임의 수정 금지)
- body는 기사 내용 요약이 아닌 "사장님 관점 해설"로 작성
- ceo_point는 "이것만 기억하면 OK" 한 줄`;
}

function buildOpeningPrompt(p) {
  const newsTitlesStr = Array.isArray(p.newsTitles) ? p.newsTitles.join(', ') : (p.newsTitles || '없음');

  return `당신은 세무법인 밀당레터 오프닝 멘트 작가입니다.
밀당레터 오프닝은 뉴스레터 상단에 위치하며, 독자가 본문으로 자연스럽게 유입되게 하는 도입부입니다.

[이번 회차 정보]
주제: ${p.subjectTitle}
사연 요약: ${p.storyText || '없음'}
꿀팁 제목: ${p.tipTitle || '없음'}
뉴스 헤드라인: ${newsTitlesStr}
CTR: ${p.ctr}%

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "openings": [
    {
      "tone": "오프닝 유형명",
      "preview": "첫 문장 예시 (한 줄)",
      "reason": "이번 주제와 맞는 이유",
      "reader_reaction": "예상 독자 반응",
      "text": "오프닝 미리보기 2~4문장"
    }
  ]
}

[배열 개수]
openings: 정확히 3개

[tone 유형 — 반드시 아래 3개를 각 1개씩 사용]
1. "공감형": 사장님 일상/감정에서 시작
2. "질문형": 날카로운 질문으로 시작
3. "반전형": 예상 외의 사실이나 반전 상황으로 시작

[기준]
- 뉴스앵커 어투·기관 인사말 절대 금지
- 첫 문장에서 독자를 붙잡아야 함
- 이번 주제/사연/꿀팁/뉴스와 자연스럽게 연결
- 본문(사연모음)으로 유도하는 흐름
- 생활감 있는 이슈나 사장님 공감 상황으로 시작`;
}

function buildOpeningDraftPrompt(p) {
  return `당신은 세무법인 밀당레터 오프닝 멘트 작가입니다.

[선택 오프닝 정보]
주제: ${p.subjectTitle}
오프닝 유형: ${p.openingTone}
오프닝 미리보기: ${p.openingText}
사연 요약: ${p.storyText || '없음'}
꿀팁 제목: ${p.tipTitle || '없음'}
뉴스 헤드라인: ${Array.isArray(p.newsTitles) ? p.newsTitles.join(', ') : (p.newsTitles || '없음')}

[밀당레터 오프닝 원고 형식]
- 총 3~5문장
- 첫 문장: 독자를 바로 붙잡는 훅 (선택한 유형 반영)
- 중간: 이번 호 핵심 내용 자연스럽게 예고
- 마지막: 본문으로 유도

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "full_text": "완성형 오프닝 멘트 전체 (문단 구분은 \\n\\n)"
}

[기준]
- 뉴스앵커 어투·기관 인사말 절대 금지
- 사장님 공감 첫 문장 필수
- 이번 회차 내용(주제/사연/꿀팁/뉴스)을 자연스럽게 예고
- 3~5문장, 간결하고 임팩트 있게`;
}

function buildRemindPrompt(p) {
  return `당신은 세무법인 밀당레터 리마인드 멘트 작가입니다.
리마인드 멘트는 뉴스레터 하단의 클릭 유도 문구로, 실제 카카오/문자로 공유할 수 있어야 합니다.

[이번 회차 정보]
주제: ${p.subjectTitle}
꿀팁 제목: ${p.tipTitle || '없음'}
CTR: ${p.ctr}%

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "reminds": [
    {
      "type": "리마인드 유형명",
      "text": "리마인드 멘트 전체 (3줄 이내)"
    }
  ]
}

[배열 개수]
reminds: 정확히 5개 (아래 유형 중 5개를 중복 없이 선택)

[리마인드 유형 목록]
손해방지형 / 지원금·혜택강조형 / 사장님공감형 / 체크리스트유도형 / 마감·기한압박형 / 세금불안자극형 / 내얘기인가궁금증형

[기준]
- "세무법인 샘밀" 직접 언급 금지
- "얘네 이런 것도 챙겨주네" 톤 유지
- 3줄 이내, 임팩트 있게
- 실제 카카오·문자로 공유될 수 있는 문구
- 5개가 서로 다른 유형`;
}

function buildRemindDraftPrompt(p) {
  return `당신은 세무법인 밀당레터 리마인드 멘트 작가입니다.

[선택 리마인드 정보]
주제: ${p.subjectTitle}
리마인드 유형: ${p.remindType}
미리보기: ${p.remindText}
꿀팁 제목: ${p.tipTitle || '없음'}

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "full_text": "완성형 리마인드 멘트 전체 (줄 구분은 \\n)"
}

[기준]
- "세무법인 샘밀" 직접 언급 금지
- 3줄 이내, 실제 카카오/문자로 보낼 수 있는 길이
- 선택한 유형(${p.remindType})의 훅을 극대화
- 마지막 줄에 클릭 유도 행동 촉구 문구 포함`;
}

function buildTitlesPrompt(p) {
  return `당신은 세무법인 밀당레터 카카오 플친 제목 전문가입니다.
카카오 플친 제목은 CTR을 결정하는 가장 중요한 요소입니다.

[이번 회차 정보]
주제: ${p.subjectTitle}
꿀팁 제목: ${p.tipTitle || '없음'}
오프닝 첫 문장: ${p.openingPreview || '없음'}
CTR: ${p.ctr}%
직전 제목: ${p.prevTitle || '없음'}
직전 주제: ${p.prevTopic || '없음'}
권장 유형: ${p.recType}

[지시]
순수 JSON 객체만 출력하세요. 마크다운, 설명 텍스트 일절 금지.

{
  "titles": [
    {
      "title": "카카오 플친 제목",
      "length": 0,
      "hook_type": "후킹 유형",
      "click_point": "예상 클릭 포인트 한 줄",
      "novelty_reason": "과거 회차와 겹치지 않는 이유 한 줄",
      "score": "상"
    }
  ]
}

[배열 개수]
titles: 정확히 7개

[hook_type 분류 — 아래 중 하나]
나해당형 / 손해형 / 놓침형 / 반전형 / 현실질문형 / 지원금형 / 억울함형

[기준]
- 22자 이내 강력 권장 (초과 시 score 낮춤)
- 직전 제목(${p.prevTitle || '없음'}) 소재·표현 직접 중복 금지
- 돈/손해/지원금/억울함/반전/내얘기 훅 강화
- 설명형 제목 절대 금지 ("~에 대해 알아봅니다" 류)
- length에 실제 제목 글자 수 입력 (공백 포함)
- score 기준: 22자 이내 + 강한 훅 → 상 / 22자 이내 보통 훅 → 중 / 22자 초과 → 하
- 7개가 서로 다른 hook_type을 갖도록 구성`;
}

// ── 진입점 라우터 ──────────────────────────────────────
function buildPrompt(type, p) {
  switch (type) {
    case 'analyze':       return buildAnalyzePrompt(p);
    case 'subjects':      return buildSubjectsPrompt(p);
    case 'stories':       return buildStoriesPrompt(p);
    case 'story_draft':   return buildStoryDraftPrompt(p);
    case 'tips':          return buildTipsPrompt(p);
    case 'tip_draft':     return buildTipDraftPrompt(p);
    case 'quiz':          return buildQuizPrompt(p);
    case 'news_draft':    return buildNewsDraftPrompt(p);
    case 'opening':       return buildOpeningPrompt(p);
    case 'opening_draft': return buildOpeningDraftPrompt(p);
    case 'remind':        return buildRemindPrompt(p);
    case 'remind_draft':  return buildRemindDraftPrompt(p);
    case 'titles':        return buildTitlesPrompt(p);
    default: throw new Error('알 수 없는 type: ' + type);
  }
}

// ── JSON 파싱 — 다단계 안전 처리 ──────────────────────
function safeParseJSON(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('빈 응답');

  let cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try { return JSON.parse(cleaned); } catch (_) {}

  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const extracted = cleaned.slice(start, end + 1);
    try { return JSON.parse(extracted); } catch (_) {}
  }

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }

  throw new Error('JSON 파싱 실패 — 원본: ' + cleaned.slice(0, 300));
}

// ── 응답 구조 검증 + 정규화 ──────────────────────────
function validateResult(type, result) {
  const errors = [];

  switch (type) {
    case 'analyze':
      if (!result.direction_hints)   errors.push('direction_hints 누락');
      if (!Array.isArray(result.keywords))       result.keywords = [];
      if (!Array.isArray(result.avoid))          result.avoid = [];
      if (!Array.isArray(result.current_interest)) result.current_interest = [];
      if (!result.prev_covered)      result.prev_covered = '';
      if (!result.avoid_material)    result.avoid_material = '';
      break;

    case 'subjects':
      if (!Array.isArray(result.subjects) || result.subjects.length < 3)
        errors.push(`subjects 부족 (${Array.isArray(result.subjects) ? result.subjects.length : 0}개)`);
      break;

    case 'stories':
      if (!Array.isArray(result.stories) || result.stories.length < 3)
        errors.push(`stories 부족 (${Array.isArray(result.stories) ? result.stories.length : 0}개)`);
      break;

    case 'story_draft':
      if (!result.title)  errors.push('title 누락');
      if (!result.body)   errors.push('body 누락');
      if (!result.narrator) result.narrator = '';
      if (!Array.isArray(result.expert_opinions) || result.expert_opinions.length < 2)
        errors.push(`expert_opinions 부족 (${Array.isArray(result.expert_opinions) ? result.expert_opinions.length : 0}개)`);
      if (!Array.isArray(result.expert_opinions)) result.expert_opinions = [];
      break;

    case 'tips':
      if (!Array.isArray(result.tips) || result.tips.length < 3)
        errors.push(`tips 부족 (${Array.isArray(result.tips) ? result.tips.length : 0}개)`);
      break;

    case 'tip_draft':
      if (!result.headline) errors.push('headline 누락');
      if (!result.body)     errors.push('body 누락');
      if (!result.intro)    result.intro = '';
      if (!result.cta)      result.cta = '';
      if (!result.summary)  result.summary = '';
      break;

    case 'quiz':
      if (!result.question)    errors.push('question 누락');
      if (!result.explanation) errors.push('explanation 누락');
      // answer 정규화
      if (result.answer !== undefined && result.answer !== null) {
        if (typeof result.answer === 'string') {
          const up = result.answer.trim().toUpperCase();
          result.answer = (up === 'O' || up === 'X') ? up : (parseInt(result.answer) || 0);
        }
      } else {
        errors.push('answer 누락');
      }
      if (result.options && !Array.isArray(result.options)) {
        errors.push('options 형식 오류');
      }
      if (!result.key_point) result.key_point = '';
      break;

    case 'news_draft':
      if (!Array.isArray(result.briefing) || result.briefing.length < 1)
        errors.push('briefing 누락 또는 빈 배열');
      break;

    case 'opening':
      if (!Array.isArray(result.openings) || result.openings.length < 3)
        errors.push(`openings 부족 (${Array.isArray(result.openings) ? result.openings.length : 0}개)`);
      break;

    case 'opening_draft':
      if (!result.full_text) errors.push('full_text 누락');
      break;

    case 'remind':
      if (!Array.isArray(result.reminds) || result.reminds.length < 3)
        errors.push(`reminds 부족 (${Array.isArray(result.reminds) ? result.reminds.length : 0}개)`);
      break;

    case 'remind_draft':
      if (!result.full_text) errors.push('full_text 누락');
      break;

    case 'titles':
      if (!Array.isArray(result.titles) || result.titles.length < 5)
        errors.push(`titles 부족 (${Array.isArray(result.titles) ? result.titles.length : 0}개)`);
      // length 자동 보정 (AI가 잘못 계산할 수 있으므로 서버에서 재계산)
      if (Array.isArray(result.titles)) {
        result.titles = result.titles.map(t => ({
          ...t,
          length: (t.title || '').length,
        }));
      }
      break;
  }

  return errors;
}

// ── OpenAI 응답에서 텍스트 추출 ──────────────────────
function extractTextFromOpenAIResponse(data) {
  if (data.choices && data.choices[0]) {
    return data.choices[0].message?.content || '';
  }
  if (data.output_text) return data.output_text;
  if (Array.isArray(data.output)) {
    return data.output
      .map(item => (item.content || []).map(c => c.text || '').join(''))
      .join('');
  }
  return '';
}

// ── 핸들러 ──────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[밀당레터] OPENAI_API_KEY 환경변수 없음');
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

  let prompt;
  try {
    prompt = buildPrompt(type, payload || {});
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const startTime = Date.now();

  let openaiRes;
  try {
    openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              '당신은 JSON만 출력하는 어시스턴트입니다. ' +
              '마크다운 코드펜스(```), 설명 문장, 인사말, 주석 일절 없이 ' +
              '순수 JSON 객체만 반환합니다.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: MAX_TOKENS[type],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    console.error('[밀당레터] OpenAI 네트워크 오류:', e.message);
    return res.status(502).json({ error: 'OpenAI API 연결 실패: ' + e.message });
  }

  if (!openaiRes.ok) {
    const errBody = await openaiRes.text();
    console.error('[밀당레터] OpenAI HTTP 오류', openaiRes.status, errBody);
    return res.status(502).json({
      error: 'OpenAI API 오류 ' + openaiRes.status,
      detail: errBody.slice(0, 300),
    });
  }

  let raw;
  try {
    const data = await openaiRes.json();
    raw = extractTextFromOpenAIResponse(data);
    if (!raw) {
      console.error('[밀당레터] 빈 응답 data:', JSON.stringify(data).slice(0, 300));
    }
  } catch (e) {
    console.error('[밀당레터] OpenAI 응답 파싱 오류:', e.message);
    return res.status(502).json({ error: '응답 파싱 오류' });
  }

  let result;
  try {
    result = safeParseJSON(raw);
  } catch (e) {
    console.error('[밀당레터] JSON 파싱 실패 type=' + type + ' — ' + e.message);
    console.error('[밀당레터] 원본 응답 전체 (' + (raw?.length || 0) + '자):', raw?.slice(0, 800));
    return res.status(422).json({
      error: 'AI 응답 형식 오류 (type=' + type + '). 재시도해주세요.',
      detail: e.message + ' | 원본 앞 200자: ' + (raw?.slice(0, 200) || ''),
    });
  }

  const validationErrors = validateResult(type, result);
  if (validationErrors.length > 0) {
    console.warn('[밀당레터] 응답 구조 경고 type=' + type, validationErrors);
  }

  // analyze: prevTitle이 있으면 AI 응답과 무관하게 서버에서 강제 적용
  if (type === 'analyze' && payload && payload.prevTitle && payload.prevTitle.trim()) {
    result.title = payload.prevTitle.trim();
  }

  const elapsed = Date.now() - startTime;
  console.log(`[밀당레터] type=${type} 완료 ${elapsed}ms`);

  return res.status(200).json({ result });
}
