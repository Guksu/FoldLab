import type {
  Cutout,
  DeviceSpec,
  DisplayFeature,
  DisplayMode,
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
/** 분할 화면 가운데 구분선 폭의 절반 */
export const SPLIT_HALF_DIVIDER = 4;
/** 이어진 주름(crease) 양옆으로 위험하다고 보는 폭 */
export const CREASE_TOLERANCE = 12;
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

/** 창 가장자리에서 장애물이 파고드는 깊이(안드로이드 DisplayCutout safe inset과 같은 방식) */
function edgeInsets(win: Rect, statusBar: Rect | null, navBar: Rect | null, cutouts: Cutout[]): Insets {
  const ins: Insets = { ...ZERO };
  if (statusBar && intersect(statusBar, win)) ins.top = Math.max(ins.top, rectBottom(statusBar) - win.y);
  if (navBar && intersect(navBar, win)) ins.bottom = Math.max(ins.bottom, rectBottom(win) - navBar.y);
  for (const c of cutouts) {
    if (!intersect(c, win)) continue;
    const dist = {
      top: c.y - win.y,
      bottom: rectBottom(win) - rectBottom(c),
      left: c.x - win.x,
      right: rectRight(win) - rectRight(c),
    };
    const edge = (Object.keys(dist) as (keyof Insets)[]).reduce((a, b) => (dist[a] <= dist[b] ? a : b));
    const depth =
      edge === 'top'
        ? rectBottom(c) - win.y
        : edge === 'bottom'
          ? rectBottom(win) - c.y
          : edge === 'left'
            ? rectRight(c) - win.x
            : rectRight(win) - c.x;
    ins[edge] = Math.max(ins[edge], depth);
  }
  for (const k of Object.keys(ins) as (keyof Insets)[]) ins[k] = Math.max(0, Math.ceil(ins[k]));
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

  const cutouts: Cutout[] = screen.cutouts.map((c) => ({ ...c, ...rotateRect(c, W0, H0, rot) }));
  const screenFolds = screen.folds.map((f) => rotateFold(f, W0, H0, rot));
  const win = windowFor(posture, W, H, screenFolds);

  const statusBar = screen.statusBar > 0 ? { x: 0, y: 0, w: W, h: screen.statusBar } : null;
  const navBar = screen.navBar > 0 ? { x: 0, y: H - screen.navBar, w: W, h: screen.navBar } : null;

  // 분할 화면이면 반대편 창이 다른 앱이다
  const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
  const otherApp: Rect | null =
    posture.region && posture.region !== 'full'
      ? windowFor({ ...posture, region: OPPOSITE[posture.region] }, W, H, screenFolds)
      : null;

  const raw = edgeInsets(win, statusBar, navBar, cutouts);
  const cover = opts.fit === 'cover';
  let viewport: Rect;
  let insets: Insets;
  let browserBar: Rect | null = null;

  if (opts.mode === 'app') {
    if (cover) {
      viewport = { ...win };
      insets = { ...raw };
    } else {
      viewport = shrink(win, raw);
      insets = { ...ZERO };
    }
  } else {
    // 모바일 브라우저 탭: 상태 표시줄 아래에 주소창, 그 아래가 웹 콘텐츠
    const statusDepth = statusBar && intersect(statusBar, win) ? rectBottom(statusBar) - win.y : 0;
    const top = Math.max(statusDepth, 0);
    browserBar = { x: win.x, y: win.y + top, w: win.w, h: BROWSER_TOOLBAR };
    const content: Rect = { x: win.x, y: win.y + top + BROWSER_TOOLBAR, w: win.w, h: win.h - top - BROWSER_TOOLBAR };
    // 가로 모드 등에서 양옆으로 파고드는 카메라 홀
    const side: Insets = { top: 0, bottom: 0, left: raw.left, right: raw.right };
    // 엣지 투 엣지(viewport-fit=cover)면 제스처 영역 아래까지 그린다
    const bottomDepth = navBar && intersect(navBar, content) ? rectBottom(content) - navBar.y : 0;
    if (cover) {
      viewport = content;
      insets = { top: 0, right: side.right, bottom: bottomDepth, left: side.left };
    } else {
      viewport = shrink(content, { top: 0, right: side.right, bottom: bottomDepth, left: side.left });
      insets = { ...ZERO };
    }
  }

  viewport = {
    x: Math.round(viewport.x),
    y: Math.round(viewport.y),
    w: Math.round(viewport.w),
    h: Math.round(viewport.h),
  };

  const letterbox = opts.mode === 'app' && !cover ? subtract(win, viewport) : [];

  // 뷰포트 안의 접는 선
  const folds: ViewportFold[] = [];
  for (const f of screenFolds) {
    const vertical = f.axis === 'vertical';
    const start = vertical ? viewport.x : viewport.y;
    const len = vertical ? viewport.w : viewport.h;
    const at = f.at - start;
    if (at <= 0 || at >= len) continue;
    const separating = posture.posture === 'folded' || f.gap > 0;
    const half = f.gap > 0 ? f.gap / 2 : CREASE_TOLERANCE;
    const zone: Rect = vertical
      ? { x: at - half, y: 0, w: half * 2, h: viewport.h }
      : { x: 0, y: at - half, w: viewport.w, h: half * 2 };
    folds.push({ axis: f.axis, at, gap: f.gap, kind: f.kind, separating, zone });
  }

  let displayFeature: DisplayFeature | null = null;
  if (posture.segments && folds.length > 0) {
    // 크롬은 디스플레이 기능을 하나만 받는다. 가장 가운데에 가까운 접는 선을 고른다.
    const center = (f: ViewportFold) => Math.abs(f.at - (f.axis === 'vertical' ? viewport.w : viewport.h) / 2);
    const f = [...folds].sort((a, b) => center(a) - center(b))[0];
    displayFeature = { orientation: f.axis, offset: Math.round(f.at - f.gap / 2), maskLength: Math.round(f.gap) };
  }

  const obstructions = collectObstructions({
    viewport,
    screenW: W,
    screenH: H,
    radius: screen.radius,
    statusBar,
    navBar,
    cutouts,
    folds,
    mode: opts.mode,
  });

  return {
    deviceId: device.id,
    postureId: posture.id,
    mode: opts.mode,
    fit: opts.fit,
    rotation: rot,
    dpr: screen.dpr,
    screen: { w: W, h: H, radius: screen.radius },
    window: win,
    viewport,
    insets,
    rawInsets: raw,
    displayFeature,
    devicePosture: posture.posture,
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
  radius: number;
  statusBar: Rect | null;
  navBar: Rect | null;
  cutouts: Cutout[];
  folds: ViewportFold[];
  mode: DisplayMode;
}): Obstruction[] {
  const out: Obstruction[] = [];
  const vp = a.viewport;
  const toVp = (r: Rect) => translate(r, -vp.x, -vp.y);
  const push = (o: Omit<Obstruction, 'rect'> & { rect: Rect }) => {
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
      label: c.label ?? '카메라',
    }),
  );
  if (a.radius > 0) {
    const r = a.radius;
    const corners: Array<[Obstruction['corner'], Rect]> = [
      ['tl', { x: 0, y: 0, w: r, h: r }],
      ['tr', { x: a.screenW - r, y: 0, w: r, h: r }],
      ['bl', { x: 0, y: a.screenH - r, w: r, h: r }],
      ['br', { x: a.screenW - r, y: a.screenH - r, w: r, h: r }],
    ];
    for (const [corner, rect] of corners) {
      push({ id: `corner-${corner}`, kind: 'corner', shape: 'corner', corner, radius: r, rect: toVp(rect), label: '둥근 모서리' });
    }
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
