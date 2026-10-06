/** 모든 좌표와 길이는 CSS px 단위다. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type Severity = 'high' | 'warn' | 'info';

/** 기기를 기본 방향에서 반시계 방향으로 돌린 각도. 90이면 기기 윗변이 왼쪽으로 간다. */
export type Rotation = 0 | 90 | 180 | 270;

/** browser: 모바일 브라우저 탭, app: 웹뷰·PWA처럼 화면 전체를 쓰는 경우 */
export type DisplayMode = 'browser' | 'app';

export type ViewportFit = 'auto' | 'contain' | 'cover';

/** page: 페이지의 viewport 메타를 따른다. auto/cover: 강제로 지정한다. */
export type FitPolicy = 'page' | 'auto' | 'cover';

export type DevicePostureType = 'continuous' | 'folded';

export type FoldAxis = 'vertical' | 'horizontal';

export interface Cutout {
  shape: 'circle' | 'pill' | 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

/**
 * 접히는 부분. crease는 화면이 이어진 주름(갤럭시 폴드), hinge는 화면이 끊긴 물리 힌지(서피스 듀오).
 * at은 접는 선의 중심 위치, gap은 화면이 실제로 없는(가려지는) 폭이다.
 */
export interface Fold {
  axis: FoldAxis;
  at: number;
  gap: number;
  kind: 'crease' | 'hinge';
}

export interface ScreenSpec {
  id: string;
  label: string;
  /** 기본 방향 기준 CSS px 크기 */
  width: number;
  height: number;
  dpr: number;
  /** 화면 모서리 반경 */
  radius: number;
  cutouts: Cutout[];
  folds: Fold[];
  /** 상태 표시줄 높이 */
  statusBar: number;
  /** 제스처 내비게이션 영역(홈 인디케이터) 높이 */
  navBar: number;
  physical?: { width: number; height: number; diagonal: number };
}

export type WindowRegion = 'full' | 'left' | 'right' | 'top' | 'bottom';

export interface PostureSpec {
  id: string;
  label: string;
  hint?: string;
  screen: string;
  rotation: Rotation;
  /** 화면 분할 시 앱이 차지하는 영역 */
  region?: WindowRegion;
  /** Device Posture API 값 */
  posture: DevicePostureType;
  /** 창 안의 접는 선을 Viewport Segments API로 노출할지 여부 */
  segments: boolean;
  /** 그림에 쓰는 힌지 각도 */
  angle?: number;
  /** 비교 시트 기본 선택 여부 */
  sheet?: boolean;
}

export type DeviceKind = 'book' | 'flip' | 'dual' | 'trifold';

export interface DeviceSpec {
  id: string;
  name: string;
  brand: string;
  kind: DeviceKind;
  platform: 'android' | 'ios';
  status: 'released' | 'announced' | 'rumored' | 'custom';
  released?: string;
  userAgent: string;
  /** UA Client Hints */
  uaModel?: string;
  platformVersion?: string;
  screens: ScreenSpec[];
  postures: PostureSpec[];
  frameColor?: string;
  sources?: string[];
  notes?: string;
}

export type ObstructionKind = 'status-bar' | 'nav-bar' | 'cutout' | 'corner' | 'hinge' | 'crease';

export interface Obstruction {
  id: string;
  kind: ObstructionKind;
  shape: 'rect' | 'circle' | 'pill' | 'corner';
  /** 뷰포트 좌표 */
  rect: Rect;
  corner?: 'tl' | 'tr' | 'bl' | 'br';
  radius?: number;
  label: string;
}

export interface ViewportFold {
  axis: FoldAxis;
  /** 뷰포트 좌표의 접는 선 중심 */
  at: number;
  gap: number;
  kind: 'crease' | 'hinge';
  /** 접힌 각도 때문에(반 접힘) 혹은 물리 힌지 때문에 화면이 실제로 둘로 나뉘는지 */
  separating: boolean;
  /** 위험 구역(뷰포트 좌표) */
  zone: Rect;
}

export interface DisplayFeature {
  orientation: FoldAxis;
  offset: number;
  maskLength: number;
}

export interface Layout {
  deviceId: string;
  postureId: string;
  mode: DisplayMode;
  fit: ViewportFit;
  rotation: Rotation;
  dpr: number;
  /** 회전이 반영된 화면 크기 */
  screen: { w: number; h: number; radius: number };
  /** 앱 창(화면 좌표) */
  window: Rect;
  /** 웹 뷰포트(화면 좌표) */
  viewport: Rect;
  /** 페이지에 전달되는 env(safe-area-inset-*) 값 */
  insets: Insets;
  /** viewport-fit=cover였다면 전달됐을 값(실제로 가려지는 깊이) */
  rawInsets: Insets;
  displayFeature: DisplayFeature | null;
  devicePosture: DevicePostureType;
  folds: ViewportFold[];
  obstructions: Obstruction[];
  /** 그리기용(화면 좌표) */
  cutouts: Cutout[];
  screenFolds: Fold[];
  statusBar: Rect | null;
  navBar: Rect | null;
  browserBar: Rect | null;
  /** 분할 화면에서 다른 앱이 차지하는 영역(화면 좌표) */
  otherApp: Rect | null;
  /** 콘텐츠가 그려지지 않는 레터박스 영역(화면 좌표) */
  letterbox: Rect[];
  /** 600px 이상이면 넓은 화면 규칙을 적용한다 */
  wide: boolean;
}

export type RuleId =
  | 'viewport-meta'
  | 'zoom-disabled'
  | 'h-overflow'
  | 'text-cut'
  | 'hinge-hidden'
  | 'fold-straddle'
  | 'fold-text'
  | 'fold-media'
  | 'cutout-overlap'
  | 'status-bar-overlap'
  | 'nav-bar-overlap'
  | 'corner-clip'
  | 'obscured'
  | 'tap-target'
  | 'line-length'
  | 'wide-unused'
  | 'safe-area-unused'
  | 'letterbox'
  | 'segments-unaware';

export interface Issue {
  id: string;
  rule: RuleId;
  severity: Severity;
  title: string;
  detail: string;
  hint?: string;
  selector?: string;
  label?: string;
  /** 뷰포트 좌표(분석 시점) */
  rects: Rect[];
  /** 고정/스티키 요소라 스크롤해도 위치가 그대로인지 */
  fixed: boolean;
  /** 분석 시점의 스크롤 위치 */
  scroll: { x: number; y: number };
  count?: number;
  /** 분석 컨텍스트 안의 요소 참조 번호(위치 보기용) */
  ref?: number;
}

export interface PageEnv {
  url: string;
  title: string;
  innerWidth: number;
  innerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  scrollX: number;
  scrollY: number;
  dpr: number;
  viewportMeta: string | null;
  viewportFit: ViewportFit;
  /** 페이지가 실제로 받는 env() 값 */
  safeArea: Insets;
  segments: Rect[];
  posture: string | null;
  usesSafeArea: boolean;
  usesSegments: boolean;
  usesPosture: boolean;
  unreadableSheets: number;
  /** visualViewport.scale (뷰포트 메타가 없으면 1보다 작다) */
  scale: number;
  media: { horizontalSegments2: boolean; verticalSegments2: boolean; postureFolded: boolean };
}

export interface Analysis {
  postureId: string;
  issues: Issue[];
  counts: Record<Severity, number>;
  env: PageEnv;
  at: number;
  ms: number;
}
