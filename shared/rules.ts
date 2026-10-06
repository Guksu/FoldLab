import type { RuleId, Severity } from './types';

export interface RuleMeta {
  id: RuleId;
  name: string;
  description: string;
  hint: string;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: '높음',
  warn: '주의',
  info: '참고',
};

export const SEVERITY_ORDER: Severity[] = ['high', 'warn', 'info'];

export const RULES: Record<RuleId, RuleMeta> = {
  'viewport-meta': {
    id: 'viewport-meta',
    name: '뷰포트 메타 누락',
    description: 'width=device-width가 없어 980px 데스크톱 폭으로 그린 뒤 축소해 보여 줍니다.',
    hint: '<meta name="viewport" content="width=device-width, initial-scale=1">을 추가하세요.',
  },
  'zoom-disabled': {
    id: 'zoom-disabled',
    name: '확대 막힘',
    description: 'user-scalable=no 또는 maximum-scale 때문에 작은 커버 화면에서 확대할 수 없습니다.',
    hint: 'user-scalable=no와 maximum-scale을 빼세요(WCAG 1.4.4).',
  },
  'h-overflow': {
    id: 'h-overflow',
    name: '가로 스크롤',
    description: '문서가 화면보다 넓어 가로로 밀립니다. 좁은 커버 화면과 분할 화면에서 자주 생깁니다.',
    hint: '고정 폭(min-width, width: 400px 등)을 max-width: 100%나 minmax()로 바꾸세요.',
  },
  'text-cut': {
    id: 'text-cut',
    name: '잘린 텍스트',
    description: '텍스트가 화면 가장자리 밖으로 나가 잘립니다.',
    hint: 'overflow-wrap: anywhere, 유연한 폭, 말줄임 처리를 검토하세요.',
  },
  'hinge-hidden': {
    id: 'hinge-hidden',
    name: '힌지에 가려짐',
    description: '물리 힌지 아래는 화면이 없어 이 부분이 보이지 않고 누를 수도 없습니다.',
    hint: '@media (horizontal-viewport-segments: 2)에서 env(viewport-segment-*)로 두 화면에 나눠 배치하세요.',
  },
  'fold-straddle': {
    id: 'fold-straddle',
    name: '접는 선 위 조작 요소',
    description: '버튼·입력 등이 접는 선에 걸쳐 있어 반쯤 접으면 둘로 갈라지고 누르기 어렵습니다.',
    hint: '접는 선을 피해 한쪽 세그먼트 안에 두거나, 세그먼트 기준 그리드로 배치하세요.',
  },
  'fold-text': {
    id: 'fold-text',
    name: '접는 선을 가로지르는 텍스트',
    description: '반쯤 접힌 자세에서 문단이 두 면으로 나뉘어 읽기 어렵습니다.',
    hint: '두 세그먼트를 열(column)로 쓰거나 텍스트를 한쪽 세그먼트에 두세요.',
  },
  'fold-media': {
    id: 'fold-media',
    name: '접는 선을 가로지르는 미디어',
    description: '이미지·영상이 접힌 각도 때문에 꺾여 보입니다.',
    hint: '테이블탑 자세에서는 영상을 위쪽 세그먼트에, 조작부를 아래쪽에 두세요.',
  },
  'cutout-overlap': {
    id: 'cutout-overlap',
    name: '카메라 홀에 가려짐',
    description: '전면 카메라 구멍이 요소를 덮습니다.',
    hint: 'padding: env(safe-area-inset-*)로 안전 영역 안쪽에 배치하세요.',
  },
  'status-bar-overlap': {
    id: 'status-bar-overlap',
    name: '상태 표시줄과 겹침',
    description: '시계·배터리 아이콘과 겹쳐 보이고 누르기 어렵습니다.',
    hint: '상단 고정 영역에 padding-top: env(safe-area-inset-top)을 더하세요.',
  },
  'nav-bar-overlap': {
    id: 'nav-bar-overlap',
    name: '제스처 영역과 겹침',
    description: '하단 홈 인디케이터 영역은 스와이프 제스처와 충돌합니다.',
    hint: '하단 고정 바에 padding-bottom: env(safe-area-inset-bottom)을 더하세요.',
  },
  'corner-clip': {
    id: 'corner-clip',
    name: '둥근 모서리에 잘림',
    description: '화면 모서리 곡선 바깥으로 나가 일부가 보이지 않습니다.',
    hint: '모서리 근처 요소에 여백을 주세요.',
  },
  obscured: {
    id: 'obscured',
    name: '다른 요소에 가려짐',
    description: '고정 헤더·하단 바·오버레이가 덮고 있어 스크롤해도 누를 수 없습니다.',
    hint: '고정 바 높이만큼 스크롤 영역에 여백(scroll-padding, padding-bottom)을 주세요.',
  },
  'tap-target': {
    id: 'tap-target',
    name: '작은 터치 영역',
    description: '24×24px보다 작은 터치 대상이 주변 대상과 붙어 있습니다(WCAG 2.5.8).',
    hint: 'min-width/min-height 44px 또는 패딩으로 터치 영역을 넓히세요.',
  },
  'line-length': {
    id: 'line-length',
    name: '너무 긴 줄',
    description: '넓게 펼친 화면에서 한 줄이 지나치게 길어 읽기 어렵습니다.',
    hint: 'max-inline-size: 40em 안팎으로 제한하거나 다단 레이아웃을 쓰세요.',
  },
  'wide-unused': {
    id: 'wide-unused',
    name: '넓은 화면 미활용',
    description: '펼친 화면에서도 휴대폰 레이아웃이 가운데 좁게 남아 있습니다.',
    hint: '600px·840px 이상에서 목록-상세, 2단 그리드 같은 레이아웃을 제공하세요.',
  },
  'safe-area-unused': {
    id: 'safe-area-unused',
    name: '안전 영역 미사용',
    description: 'viewport-fit=cover로 화면 끝까지 그리지만 env(safe-area-inset-*)를 쓰지 않습니다.',
    hint: '가장자리에 붙는 요소에 env(safe-area-inset-*) 여백을 주세요.',
  },
  letterbox: {
    id: 'letterbox',
    name: '레터박스',
    description: 'viewport-fit=cover가 없어 카메라·시스템 바 쪽 가장자리가 빈 띠로 남습니다.',
    hint: '화면 끝까지 쓰려면 viewport-fit=cover와 safe-area 여백을 함께 쓰세요.',
  },
  'segments-unaware': {
    id: 'segments-unaware',
    name: '접힘 대응 코드 없음',
    description: '두 세그먼트 자세인데 Viewport Segments·Device Posture를 쓰는 CSS/JS가 보이지 않습니다.',
    hint: '@media (horizontal-viewport-segments: 2), (device-posture: folded)로 자세별 레이아웃을 주세요.',
  },
};
