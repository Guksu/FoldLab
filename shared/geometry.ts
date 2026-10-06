import type {
  BarSide,
  Corners,
  Cutout,
  DeviceSpec,
  DisplayFeature,
  DisplayMode,
  FitPolicy,
  Fold,
  Insets,
  Layout,
  Obstruction,
  PostureSpec,
  Rect,
  Rotation,
  ScreenSpec,
  ViewportFit,
  ViewportFold,
} from './types';

/** 크롬 안드로이드 상단 툴바(주소창) 높이 */
export const BROWSER_TOOLBAR = 56;
/** iOS 26+ 사파리 아래쪽 탭 바 높이(홈 인디케이터 위) */
export const IOS_TOOLBAR = 52;
/** 분할 화면 가운데 구분선 폭의 절반 */
export const SPLIT_HALF_DIVIDER = 4;
/** 이어진 주름 양옆 위험 구역: 펼쳤을 때 / 반 접혔을 때(48dp 터치 대상의 절반) */
export const CREASE_TOLERANCE = 12;
export const SEPARATING_TOLERANCE = 24;
export const WIDE_BREAKPOINT = 600;

const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function rectRight(r: Rect): number {
  return r.x + r.w;
}

export function rectBottom(r: Rect): number {
  return r.y + r.h;
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(rectRight(a), rectRight(b));
  const btm = Math.min(rectBottom(a), rectBottom(b));
  if (r <= x || btm <= y) return null;
  return { x, y, w: r - x, h: btm - y };
}

export function translate(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

/** 기본 방향 좌표를 회전된 화면 좌표로 바꾼다. W, H는 기본 방향 화면 크기. */
export function rotatePoint(x: number, y: number, W: number, H: number, rot: Rotation): [number, number] {
  switch (rot) {
    case 0:
      return [x, y];
    case 90:
      return [y, W - x];
    case 180:
      return [W - x, H - y];
    case 270:
      return [H - y, x];
  }
}

export function rotateRect(r: Rect, W: number, H: number, rot: Rotation): Rect {
  const [x1, y1] = rotatePoint(r.x, r.y, W, H, rot);
  const [x2, y2] = rotatePoint(r.x + r.w, r.y + r.h, W, H, rot);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function rotateFold(f: Fold, W: number, H: number, rot: Rotation): Fold {
  if (rot === 0) return { ...f };
  if (rot === 180) return { ...f, at: f.axis === 'vertical' ? W - f.at : H - f.at };
  if (f.axis === 'vertical') {
    // 세로 접는 선 x=at → 가로 접는 선
    return { ...f, axis: 'horizontal', at: rot === 90 ? W - f.at : f.at };
  }
  // 가로 접는 선 y=at → 세로 접는 선
  return { ...f, axis: 'vertical', at: rot === 90 ? f.at : H - f.at };
}

/** 기기를 반시계로 90° 돌리면 오른쪽 위 모서리가 왼쪽 위로 온다 */
export function rotateCorners(c: Corners, rot: Rotation): Corners {
  switch (rot) {
    case 0:
      return { ...c };
    case 90:
      return { tl: c.tr, tr: c.br, br: c.bl, bl: c.tl };
    case 180:
      return { tl: c.br, tr: c.bl, br: c.tl, bl: c.tr };
    case 270:
      return { tl: c.bl, tr: c.tl, br: c.tr, bl: c.br };
  }
}

export function rotatedSize(screen: ScreenSpec, rot: Rotation): { w: number; h: number } {
  return rot % 180 === 0 ? { w: screen.width, h: screen.height } : { w: screen.height, h: screen.width };
}

export function findPosture(device: DeviceSpec, postureId: string): PostureSpec {
  return device.postures.find((p) => p.id === postureId) ?? device.postures[0];
}

export function findScreen(device: DeviceSpec, screenId: string): ScreenSpec {
  const screen = device.screens.find((s) => s.id === screenId);
  if (!screen) throw new Error(`화면 '${screenId}'을(를) ${device.name}에서 찾을 수 없습니다.`);
  return screen;
}

function windowFor(posture: PostureSpec, W: number, H: number, folds: Fold[]): Rect {
  const region = posture.region ?? 'full';
  if (region === 'full') return { x: 0, y: 0, w: W, h: H };
  const vertical = region === 'left' || region === 'right';
  const fold = folds.find((f) => f.axis === (vertical ? 'vertical' : 'horizontal'));
  const at = fold ? fold.at : (vertical ? W : H) / 2;
  const half = (fold ? fold.gap / 2 : 0) + SPLIT_HALF_DIVIDER;
  switch (region) {
    case 'left':
      return { x: 0, y: 0, w: at - half, h: H };
    case 'right':
      return { x: at + half, y: 0, w: W - at - half, h: H };
    case 'top':
      return { x: 0, y: 0, w: W, h: at - half };
    case 'bottom':
      return { x: 0, y: at + half, w: W, h: H - at - half };
  }
}

function statusBarRect(side: BarSide, size: number, W: number, H: number): Rect | null {
  if (size <= 0) return null;
  switch (side) {
    case 'top':
      return { x: 0, y: 0, w: W, h: size };
    case 'left':
      return { x: 0, y: 0, w: size, h: H };
    case 'right':
      return { x: W - size, y: 0, w: size, h: H };
  }
}

type Edge = keyof Insets;

/**
 * 장애물이 창 가장자리에서 파고드는 깊이(안드로이드 DisplayCutout safe inset과 같은 방식).
 * 시스템 바는 붙는 가장자리가 정해져 있고, 카메라는 가장 가까운 가장자리에 붙인다.
 */
function edgeInsets(win: Rect, bars: Array<{ rect: Rect; edge: Edge }>, cutouts: Cutout[]): Insets {
  const ins: Insets = { ...ZERO };
  const depthFrom = (r: Rect, edge: Edge) =>
    edge === 'top' ? rectBottom(r) - win.y : edge === 'bottom' ? rectBottom(win) - r.y : edge === 'left' ? rectRight(r) - win.x : rectRight(win) - r.x;
  for (const b of bars) {
    const r = intersect(b.rect, win);
    if (r) ins[b.edge] = Math.max(ins[b.edge], depthFrom(r, b.edge));
  }
  for (const c of cutouts) {
    const r = intersect(c, win);
    if (!r) continue;
    const dist: Record<Edge, number> = {
      top: r.y - win.y,
      bottom: rectBottom(win) - rectBottom(r),
      left: r.x - win.x,
      right: rectRight(win) - rectRight(r),
    };
    // 거리가 같으면 그 가장자리를 따라 더 길게 걸친 쪽을 고른다
    const extent = (e: Edge) => (e === 'top' || e === 'bottom' ? r.w : r.h);
    const edge = (Object.keys(dist) as Edge[]).reduce((a, b) =>
      dist[b] < dist[a] - 0.5 || (Math.abs(dist[b] - dist[a]) <= 0.5 && extent(b) > extent(a)) ? b : a,
    );
    ins[edge] = Math.max(ins[edge], depthFrom(r, edge));
  }
  for (const k of Object.keys(ins) as Edge[]) ins[k] = Math.max(0, Math.ceil(ins[k]));
  return ins;
}

function shrink(r: Rect, ins: Insets): Rect {
  return { x: r.x + ins.left, y: r.y + ins.top, w: r.w - ins.left - ins.right, h: r.h - ins.top - ins.bottom };
}

/** a에서 b를 뺀 나머지를 최대 4개의 사각형으로 */
function subtract(a: Rect, b: Rect): Rect[] {
  const i = intersect(a, b);
  if (!i) return [a];
  const out: Rect[] = [];
  if (i.y > a.y) out.push({ x: a.x, y: a.y, w: a.w, h: i.y - a.y });
  if (rectBottom(i) < rectBottom(a)) out.push({ x: a.x, y: rectBottom(i), w: a.w, h: rectBottom(a) - rectBottom(i) });
  if (i.x > a.x) out.push({ x: a.x, y: i.y, w: i.x - a.x, h: i.h });
  if (rectRight(i) < rectRight(a)) out.push({ x: rectRight(i), y: i.y, w: rectRight(a) - rectRight(i), h: i.h });
  return out.filter((r) => r.w > 0.5 && r.h > 0.5);
}

const pick = (ins: Insets, keys: (keyof Insets)[]): Insets => {
  const out = { ...ZERO };
  for (const k of keys) out[k] = ins[k];
  return out;
};

const maxOf = (a: Insets, b: Insets): Insets => ({
  top: Math.max(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
  left: Math.max(a.left, b.left),
});

export interface LayoutOptions {
  mode: DisplayMode;
  /** 실제로 적용되는 viewport-fit */
  fit: ViewportFit;
}

export function computeLayout(device: DeviceSpec, postureId: string, opts: LayoutOptions): Layout {
  const posture = findPosture(device, postureId);
  const screen = findScreen(device, posture.screen);
  const rot = posture.rotation;
  const W0 = screen.width;
  const H0 = screen.height;
  const { w: W, h: H } = rotatedSize(screen, rot);
  const ios = device.platform === 'ios';
  const browserPlacement = device.browserBar ?? (ios ? 'bottom' : 'top');

  const cutouts: Cutout[] = screen.cutouts.map((c) => ({ ...c, ...rotateRect(c, W0, H0, rot) }));
  const screenFolds = screen.folds.map((f) => rotateFold(f, W0, H0, rot));
  const win = windowFor(posture, W, H, screenFolds);
  const corners = rotateCorners(screen.corners ?? { tl: screen.radius, tr: screen.radius, br: screen.radius, bl: screen.radius }, rot);

  const sbSide = posture.statusBarSide ?? screen.statusBarSide ?? 'top';
  const statusBar = statusBarRect(sbSide, posture.statusBar ?? screen.statusBar, W, H);
  const navSize = posture.navBar ?? screen.navBar;
  const navBar = navSize > 0 ? { x: 0, y: H - navSize, w: W, h: navSize } : null;
  // OS가 알려 주는 카메라 중 시스템 바 안에 들어간 것은 바의 안전 영역에 이미 포함된다
  const inside = (outer: Rect | null, r: Rect) =>
    !!outer && r.x >= outer.x - 0.5 && r.y >= outer.y - 0.5 && rectRight(r) <= rectRight(outer) + 0.5 && rectBottom(r) <= rectBottom(outer) + 0.5;
  const reportedCutouts = cutouts.filter((c) => c.reported !== false && !inside(statusBar, c) && !inside(navBar, c));

  // 분할 화면이면 반대편 창이 다른 앱이다
  const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
  const otherApp: Rect | null =
    posture.region && posture.region !== 'full' ? windowFor({ ...posture, region: OPPOSITE[posture.region] }, W, H, screenFolds) : null;

  const statusBars = statusBar ? [{ rect: statusBar, edge: sbSide as Edge }] : [];
  const navBars = navBar ? [{ rect: navBar, edge: 'bottom' as Edge }] : [];
  // 실제로 가려지는 깊이(시스템 바 + OS가 알려 주는 카메라)
  const raw = edgeInsets(win, [...statusBars, ...navBars], reportedCutouts);
  const statusIns = edgeInsets(win, statusBars, []);
  const navIns = edgeInsets(win, navBars, []);
  const cutIns = edgeInsets(win, [], reportedCutouts);
  const cover = opts.fit === 'cover';
  let viewport: Rect;
  let insets: Insets;
  let maxIns: Insets;
  let browserBar: Rect | null = null;

  if (opts.mode === 'app') {
    // 앱 웹뷰·전체 화면: cover면 화면 끝까지 그리고 가려지는 깊이를 안전 영역으로 준다
    if (cover) {
      viewport = { ...win };
      insets = { ...raw };
    } else {
      viewport = shrink(win, raw);
      insets = { ...ZERO };
    }
    maxIns = { ...insets };
  } else if (ios) {
    // 사파리 탭: 위쪽 상태 표시줄은 브라우저 UI가 차지한다.
    // 옆으로 붙은 상태 막대(아이폰 듀오)·카메라는 가로 모드 노치처럼 cover일 때만 안전 영역이 되고 아니면 비운다.
    const top = sbSide === 'top' ? statusIns.top : 0;
    let content: Rect = { x: win.x, y: win.y + top, w: win.w, h: win.h - top };
    if (browserPlacement === 'bottom') {
      browserBar = { x: win.x, y: rectBottom(win) - navIns.bottom - IOS_TOOLBAR, w: win.w, h: IOS_TOOLBAR };
      content = { ...content, h: content.h - navIns.bottom - IOS_TOOLBAR };
    } else if (browserPlacement === 'top') {
      browserBar = { x: win.x, y: content.y, w: win.w, h: IOS_TOOLBAR };
      content = { ...content, y: content.y + IOS_TOOLBAR, h: content.h - IOS_TOOLBAR };
    }
    const sideIns = maxOf(pick(statusIns, ['left', 'right']), pick(cutIns, ['left', 'right']));
    // 탭 바가 아래에 없으면 홈 인디케이터도 cover일 때 안전 영역이 된다
    const bottom = browserPlacement === 'bottom' ? 0 : navIns.bottom;
    const edges: Insets = { top: 0, right: sideIns.right, bottom, left: sideIns.left };
    if (cover) {
      viewport = content;
      insets = edges;
    } else {
      viewport = shrink(content, edges);
      insets = { ...ZERO };
    }
    maxIns = { ...insets };
  } else {
    // 크롬 안드로이드 탭: 상태 표시줄 아래 주소창, 그 아래가 웹 콘텐츠.
    // 탭에서는 카메라(노치) 아래로 그리지 않고 그만큼 뷰포트를 줄인다(좌우 안전 영역은 늘 0).
    // 아래쪽은 크롬 135+ 엣지 투 엣지: cover면 제스처 영역 아래까지 그리고, 아니면 처음엔 chin이 있어 그 위까지만 그린다.
    const top = statusIns.top;
    browserBar = { x: win.x, y: win.y + top, w: win.w, h: BROWSER_TOOLBAR };
    const content: Rect = { x: win.x, y: win.y + top + BROWSER_TOOLBAR, w: win.w, h: win.h - top - BROWSER_TOOLBAR };
    const letter: Insets = {
      top: 0,
      left: Math.max(cutIns.left, statusIns.left),
      right: Math.max(cutIns.right, statusIns.right),
      bottom: cutIns.bottom,
    };
    const gesture = Math.max(0, navIns.bottom - cutIns.bottom);
    if (cover) {
      viewport = shrink(content, letter);
      insets = { top: 0, right: 0, bottom: gesture, left: 0 };
    } else {
      viewport = shrink(content, { ...letter, bottom: letter.bottom + gesture });
      insets = { ...ZERO };
    }
    maxIns = { top: 0, right: 0, bottom: gesture, left: 0 };
  }

  viewport = {
    x: Math.round(viewport.x),
    y: Math.round(viewport.y),
    w: Math.round(viewport.w),
    h: Math.round(viewport.h),
  };

  // 콘텐츠가 그려지지 않는 빈 띠(브라우저 UI는 따로 그린다)
  const letterbox = subtract(win, viewport).filter((r) => !(browserBar && intersect(r, browserBar) && r.h <= browserBar.h + 0.5));

  // 뷰포트 안의 접는 선
  const folds: ViewportFold[] = [];
  for (const f of screenFolds) {
    const vertical = f.axis === 'vertical';
    const start = vertical ? viewport.x : viewport.y;
    const len = vertical ? viewport.w : viewport.h;
    const at = f.at - start;
    if (at <= 0 || at >= len) continue;
    // 물리적으로 반 접혔거나 화면이 끊긴 힌지면 실제로 둘로 나뉜다(페이지에 API로 알려 주는지와는 별개)
    const separating = posture.posture === 'folded' || f.gap > 0;
    const half = f.gap > 0 ? f.gap / 2 : separating ? (f.band ?? SEPARATING_TOLERANCE * 2) / 2 : CREASE_TOLERANCE;
    const zone: Rect = vertical ? { x: at - half, y: 0, w: half * 2, h: viewport.h } : { x: 0, y: at - half, w: viewport.w, h: half * 2 };
    folds.push({ axis: f.axis, at, gap: f.gap, kind: f.kind, separating, zone });
  }

  // 사파리처럼 폴더블 API를 지원하지 않는 브라우저는 세그먼트·자세를 알려 주지 않는다
  const foldApis = device.foldApis !== false;
  let displayFeature: DisplayFeature | null = null;
  if (foldApis && posture.segments && folds.length > 0) {
    // 크롬은 디스플레이 기능을 하나만 받는다. 가장 가운데에 가까운 접는 선을 고른다.
    const center = (f: ViewportFold) => Math.abs(f.at - (f.axis === 'vertical' ? viewport.w : viewport.h) / 2);
    const f = [...folds].sort((a, b) => center(a) - center(b))[0];
    displayFeature = { orientation: f.axis, offset: Math.round(f.at - f.gap / 2), maskLength: Math.round(f.gap) };
  }

  const obstructions = collectObstructions({ viewport, screenW: W, screenH: H, corners, statusBar, navBar, cutouts, folds });

  return {
    deviceId: device.id,
    postureId: posture.id,
    mode: opts.mode,
    fit: opts.fit,
    rotation: rot,
    dpr: screen.dpr,
    screen: { w: W, h: H, radius: Math.max(corners.tl, corners.tr, corners.br, corners.bl), corners },
    window: win,
    viewport,
    insets,
    maxInsets: maxIns,
    rawInsets: raw,
    displayFeature,
    devicePosture: foldApis ? posture.posture : 'continuous',
    halfOpen: posture.posture === 'folded',
    folds,
    obstructions,
    cutouts,
    screenFolds,
    statusBar,
    navBar,
    browserBar,
    otherApp,
    letterbox,
    wide: viewport.w >= WIDE_BREAKPOINT,
  };
}

function collectObstructions(a: {
  viewport: Rect;
  screenW: number;
  screenH: number;
  corners: Corners;
  statusBar: Rect | null;
  navBar: Rect | null;
  cutouts: Cutout[];
  folds: ViewportFold[];
}): Obstruction[] {
  const out: Obstruction[] = [];
  const vp = a.viewport;
  const toVp = (r: Rect) => translate(r, -vp.x, -vp.y);
  const push = (o: Obstruction) => {
    if (intersect(o.rect, { x: 0, y: 0, w: vp.w, h: vp.h })) out.push(o);
  };

  if (a.statusBar) push({ id: 'status-bar', kind: 'status-bar', shape: 'rect', rect: toVp(a.statusBar), label: '상태 표시줄' });
  if (a.navBar) push({ id: 'nav-bar', kind: 'nav-bar', shape: 'rect', rect: toVp(a.navBar), label: '제스처 영역' });
  a.cutouts.forEach((c, i) =>
    push({
      id: `cutout-${i}`,
      kind: 'cutout',
      shape: c.shape,
      rect: toVp(c),
      label: (c.label ?? '카메라') + (c.reported === false ? '(안전 영역 미보고)' : ''),
    }),
  );
  const { corners: c, screenW: W, screenH: H } = a;
  const list: Array<[NonNullable<Obstruction['corner']>, number, Rect]> = [
    ['tl', c.tl, { x: 0, y: 0, w: c.tl, h: c.tl }],
    ['tr', c.tr, { x: W - c.tr, y: 0, w: c.tr, h: c.tr }],
    ['bl', c.bl, { x: 0, y: H - c.bl, w: c.bl, h: c.bl }],
    ['br', c.br, { x: W - c.br, y: H - c.br, w: c.br, h: c.br }],
  ];
  for (const [corner, r, rect] of list) {
    if (r < 8) continue; // 반경이 아주 작으면 의미가 없다
    push({ id: `corner-${corner}`, kind: 'corner', shape: 'corner', corner, radius: r, rect: toVp(rect), label: '둥근 모서리' });
  }
  a.folds.forEach((f, i) =>
    push({
      id: `fold-${i}`,
      kind: f.gap > 0 ? 'hinge' : 'crease',
      shape: 'rect',
      rect: f.zone,
      label: f.gap > 0 ? `힌지 ${f.gap}px` : '접는 선',
    }),
  );
  return out;
}

/** CDP Emulation.setDeviceMetricsOverride의 screenOrientation 값 */
export function screenOrientation(rot: Rotation, naturalPortrait: boolean): { type: string; angle: number } {
  const portrait = (rot % 180 === 0) === naturalPortrait;
  switch (rot) {
    case 0:
      return { type: portrait ? 'portraitPrimary' : 'landscapePrimary', angle: 0 };
    case 90:
      return { type: portrait ? 'portraitPrimary' : 'landscapePrimary', angle: 90 };
    case 180:
      return { type: portrait ? 'portraitSecondary' : 'landscapeSecondary', angle: 180 };
    case 270:
      return { type: portrait ? 'portraitSecondary' : 'landscapeSecondary', angle: 270 };
  }
}

export function sameInsets(a: Insets, b: Insets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

export function parseViewportFit(content: string | null | undefined): ViewportFit {
  if (!content) return 'auto';
  const m = /viewport-fit\s*=\s*([a-z]+)/i.exec(content);
  const v = m?.[1]?.toLowerCase();
  return v === 'cover' || v === 'contain' ? v : 'auto';
}

/**
 * 실제로 적용할 viewport-fit.
 * 안드로이드 웹뷰(M136+)는 화면 전체를 채우면 viewport-fit과 상관없이 시스템 바·카메라 영역을 안전 영역으로 주므로 cover처럼 동작한다.
 */
export function resolveFit(device: DeviceSpec, mode: DisplayMode, policy: FitPolicy, pageFit: ViewportFit): ViewportFit {
  if (policy !== 'page') return policy;
  if (mode === 'app' && device.platform === 'android') return 'cover';
  return pageFit;
}
