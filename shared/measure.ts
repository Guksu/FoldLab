import type { CustomParams } from './custom';
import { computeLayout } from './geometry';
import type { DeviceSpec, DisplayMode, Insets, Layout, Rect } from './types';

/** 실기기에서 /measure 페이지가 잰 값 한 번 */
export interface MeasureSnapshot {
  id: string;
  at: number;
  /** 보안 컨텍스트(https·localhost)가 아니면 자세 API·기기 모델명은 비어 있다 */
  secure: boolean;
  displayMode: string;
  /** navigator.maxTouchPoints. 아이패드처럼 맥 UA를 쓰는 iOS 기기를 가려낼 때 쓴다 */
  touchPoints: number;
  ua: {
    string: string;
    mobile: boolean | null;
    platform: string | null;
    platformVersion: string | null;
    model: string | null;
  };
  dpr: number;
  screen: { width: number; height: number; availWidth: number; availHeight: number; orientation: string | null; angle: number | null };
  /** innerWidth·innerHeight와 스크롤바를 뺀 clientWidth·clientHeight */
  viewport: { width: number; height: number; clientWidth: number; clientHeight: number };
  visual: { width: number; height: number; scale: number; offsetTop: number; offsetLeft: number } | null;
  /** 100svh·100lvh·100dvh를 px로 잰 값(지원하지 않으면 null) */
  units: { svh: number | null; lvh: number | null; dvh: number | null };
  /** viewport-fit=cover에서 잰 env(safe-area-inset-*) */
  safeArea: Insets;
  /** env(safe-area-max-inset-*). 지원하지 않으면 null */
  safeAreaMax: Insets | null;
  /** 뷰포트 세그먼트. 화면이 하나면 빈 배열 */
  segments: Rect[];
  posture: 'continuous' | 'folded' | null;
}

export interface MeasureUrl {
  kind: 'lan' | 'local';
  label: string;
  url: string;
}

const MAX = 20000;

function num(v: unknown, min = 0, max = MAX): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 1000) / 1000 : null;
}

function str(v: unknown, max = 600): string | null {
  return typeof v === 'string' ? v.slice(0, max) : null;
}

function insets(v: unknown): Insets | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const top = num(o.top);
  const right = num(o.right);
  const bottom = num(o.bottom);
  const left = num(o.left);
  return top === null || right === null || bottom === null || left === null ? null : { top, right, bottom, left };
}

function rect(v: unknown): Rect | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const x = num(o.x, -MAX);
  const y = num(o.y, -MAX);
  const w = num(o.w);
  const h = num(o.h);
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}

/** 측정 페이지가 보낸 값을 검사하고 정리한다. 문제가 있으면 오류 문장을 돌려준다. */
export function parseSnapshot(input: unknown): MeasureSnapshot | string {
  if (!input || typeof input !== 'object') return '측정값이 객체가 아닙니다.';
  const o = input as Record<string, any>;
  const dpr = num(o.dpr, 0.5, 8);
  if (dpr === null) return 'dpr 값이 잘못됐습니다.';
  const vw = num(o.viewport?.width, 1);
  const vh = num(o.viewport?.height, 1);
  if (vw === null || vh === null) return '뷰포트 크기가 잘못됐습니다.';
  const safeArea = insets(o.safeArea);
  if (!safeArea) return '안전 영역 값이 잘못됐습니다.';
  const segments = Array.isArray(o.segments) ? o.segments.slice(0, 4).map(rect) : [];
  if (segments.some((s) => !s)) return '세그먼트 값이 잘못됐습니다.';
  const unit = (v: unknown) => (v === null || v === undefined ? null : num(v));
  return {
    id: (str(o.id, 40) ?? '').replace(/[^\w-]/g, '') || Math.random().toString(36).slice(2, 10),
    at: num(o.at, 0, 1e14) ?? Date.now(),
    secure: o.secure === true,
    displayMode: str(o.displayMode, 20) ?? 'browser',
    touchPoints: num(o.touchPoints, 0, 64) ?? 0,
    ua: {
      string: str(o.ua?.string) ?? '',
      mobile: typeof o.ua?.mobile === 'boolean' ? o.ua.mobile : null,
      platform: str(o.ua?.platform, 40),
      platformVersion: str(o.ua?.platformVersion, 40),
      model: str(o.ua?.model, 80),
    },
    dpr,
    screen: {
      width: num(o.screen?.width) ?? 0,
      height: num(o.screen?.height) ?? 0,
      availWidth: num(o.screen?.availWidth) ?? 0,
      availHeight: num(o.screen?.availHeight) ?? 0,
      orientation: str(o.screen?.orientation, 40),
      angle: num(o.screen?.angle, 0, 360),
    },
    viewport: { width: vw, height: vh, clientWidth: num(o.viewport?.clientWidth) ?? vw, clientHeight: num(o.viewport?.clientHeight) ?? vh },
    visual:
      o.visual && num(o.visual.width) !== null
        ? {
            width: num(o.visual.width) ?? vw,
            height: num(o.visual.height) ?? vh,
            scale: num(o.visual.scale, 0, 20) ?? 1,
            offsetTop: num(o.visual.offsetTop, -MAX) ?? 0,
            offsetLeft: num(o.visual.offsetLeft, -MAX) ?? 0,
          }
        : null,
    units: { svh: unit(o.units?.svh), lvh: unit(o.units?.lvh), dvh: unit(o.units?.dvh) },
    safeArea,
    safeAreaMax: insets(o.safeAreaMax),
    segments: segments as Rect[],
    posture: o.posture === 'folded' || o.posture === 'continuous' ? o.posture : null,
  };
}

const BROWSERS: [RegExp, string][] = [
  [/SamsungBrowser\/(\d+)/, '삼성 인터넷'],
  [/Whale\/(\d+)/, '웨일'],
  [/CriOS\/(\d+)/, 'iOS 크롬'],
  [/EdgA?\/(\d+)/, '엣지'],
  [/Chrome\/(\d+)/, '크롬'],
  [/Version\/(\d+(?:\.\d+)?).*Safari/, '사파리'],
];

/** UA 문자열로 플랫폼과 브라우저를 짧게 적는다 */
export function describeUa(s: MeasureSnapshot): { platform: 'ios' | 'android' | 'other'; text: string } {
  const ua = s.ua.string;
  // 아이패드(와 데스크톱 UA를 쓰는 iOS 기기)는 맥 UA에 터치 포인트로 가려낸다
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && s.touchPoints > 1);
  const android = /Android/.test(ua);
  const hit = BROWSERS.map(([re, name]) => [re.exec(ua), name] as const).find(([m]) => m);
  const browser = hit ? `${hit[1]} ${hit[0]![1]}` : '알 수 없는 브라우저';
  const os = ios
    ? `iOS ${(/OS (\d+)[_.](\d+)/.exec(ua) ?? []).slice(1, 3).join('.') || ''}`.trim()
    : android
      ? `Android ${s.ua.platformVersion?.split('.')[0] ?? /Android (\d+)/.exec(ua)?.[1] ?? ''}`.trim()
      : s.ua.platform ?? '';
  const model = s.ua.model ? `${s.ua.model} · ` : '';
  return { platform: ios ? 'ios' : android ? 'android' : 'other', text: `${model}${browser}${os ? ` · ${os}` : ''}` };
}

export interface CompareRow {
  label: string;
  expected: string;
  actual: string;
  /** null이면 실기기에서 잴 수 없었던 값 */
  ok: boolean | null;
}

const sizeText = (w: number, h: number) => `${Math.round(w)}×${Math.round(h)}`;
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** 레이아웃이 보여 줄 세그먼트(디스플레이 기능 기준) */
export function expectedSegments(layout: Layout): Rect[] {
  const f = layout.displayFeature;
  const vp = layout.viewport;
  if (!f) return [];
  if (f.orientation === 'vertical') {
    return [
      { x: 0, y: 0, w: f.offset, h: vp.h },
      { x: f.offset + f.maskLength, y: 0, w: vp.w - f.offset - f.maskLength, h: vp.h },
    ];
  }
  return [
    { x: 0, y: 0, w: vp.w, h: f.offset },
    { x: 0, y: f.offset + f.maskLength, w: vp.w, h: vp.h - f.offset - f.maskLength },
  ];
}

/** 측정 페이지는 viewport-fit=cover로 재므로 카탈로그도 cover로 계산해 비교한다 */
export function compareSnapshot(device: DeviceSpec, postureId: string, mode: DisplayMode, s: MeasureSnapshot): CompareRow[] {
  const layout = computeLayout(device, postureId, { mode, fit: 'cover' });
  const vp = layout.viewport;
  const rows: CompareRow[] = [
    {
      label: '뷰포트',
      expected: sizeText(vp.w, vp.h),
      actual: sizeText(s.viewport.width, s.viewport.height),
      ok: close(vp.w, s.viewport.width, 1) && close(vp.h, s.viewport.height, 2),
    },
    {
      label: '화면',
      expected: sizeText(layout.screen.w, layout.screen.h),
      actual: s.screen.width ? sizeText(s.screen.width, s.screen.height) : '—',
      // iOS는 돌려도 screen 값이 세로 기준이라 가로·세로를 구분하지 않고 비교한다
      ok: s.screen.width
        ? close(Math.min(layout.screen.w, layout.screen.h), Math.min(s.screen.width, s.screen.height), 1) &&
          close(Math.max(layout.screen.w, layout.screen.h), Math.max(s.screen.width, s.screen.height), 1)
        : null,
    },
    { label: 'DPR', expected: String(layout.dpr), actual: String(s.dpr), ok: close(layout.dpr, s.dpr, 0.01) },
  ];
  (['top', 'right', 'bottom', 'left'] as const).forEach((edge) => {
    const label = { top: '안전 영역 위', right: '안전 영역 오른쪽', bottom: '안전 영역 아래', left: '안전 영역 왼쪽' }[edge];
    rows.push({
      label,
      expected: String(Math.round(layout.insets[edge])),
      actual: String(Math.round(s.safeArea[edge])),
      ok: close(layout.insets[edge], s.safeArea[edge], 1),
    });
  });
  const segs = expectedSegments(layout);
  rows.push({
    label: '세그먼트',
    expected: segs.length ? segs.map((r) => sizeText(r.w, r.h)).join(' + ') : '1개',
    actual: s.segments.length > 1 ? s.segments.map((r) => sizeText(r.w, r.h)).join(' + ') : '1개',
    ok:
      segs.length === Math.max(0, s.segments.length > 1 ? s.segments.length : 0) &&
      segs.every((r, i) => close(r.w, s.segments[i].w, 1) && close(r.h, s.segments[i].h, 1)),
  });
  rows.push({
    label: '자세',
    expected: layout.devicePosture,
    actual: s.posture ?? (s.secure ? '지원 안 함' : '잴 수 없음(보안 컨텍스트 아님)'),
    ok: s.posture ? s.posture === layout.devicePosture : null,
  });
  return rows;
}

/** 측정값과 가장 비슷한 자세를 고른다(뷰포트 크기 + 세그먼트 수) */
export function closestPosture(device: DeviceSpec, mode: DisplayMode, s: MeasureSnapshot): string {
  let best = device.postures[0].id;
  let bestScore = Infinity;
  for (const p of device.postures) {
    const layout = computeLayout(device, p.id, { mode, fit: 'cover' });
    const segs = expectedSegments(layout).length;
    const score =
      Math.abs(layout.viewport.w - s.viewport.width) +
      Math.abs(layout.viewport.h - s.viewport.height) +
      (segs !== (s.segments.length > 1 ? s.segments.length : 0) ? 400 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = p.id;
    }
  }
  return best;
}

/**
 * screen 값을 지금 보이는 뷰포트 방향에 맞춘다.
 * iOS 사파리는 돌려도 screen이 세로 기준이고, screen.orientation도 브라우저마다 믿기 어려워 뷰포트 비율을 기준으로 삼는다.
 */
function screenSize(s: MeasureSnapshot): { w: number; h: number } {
  const { width, height } = s.screen;
  const landscape = s.viewport.width > s.viewport.height;
  return landscape === width > height ? { w: width, h: height } : { w: height, h: width };
}

function hingeGap(s: MeasureSnapshot): number {
  if (s.segments.length < 2) return 0;
  const [a, b] = s.segments;
  const gap = b.x > a.x + a.w - 1 ? b.x - (a.x + a.w) : b.y - (a.y + a.h);
  return Math.max(0, Math.round(gap));
}

/**
 * 측정값으로 기기 직접 만들기 폼을 채운다.
 * 화면 크기·DPR·플랫폼·힌지 폭만 채우고, 브라우저에서 잴 수 없는 상태 표시줄·카메라·모서리는 기존 값을 둔다.
 */
export function customFromSnapshots(base: CustomParams, picks: { cover?: MeasureSnapshot; main?: MeasureSnapshot }): CustomParams {
  const any = picks.main ?? picks.cover;
  if (!any) return base;
  const next: CustomParams = { ...base, dpr: any.dpr };
  const ua = describeUa(any);
  if (ua.platform === 'ios' || ua.platform === 'android') next.platform = ua.platform;
  if (any.ua.model) next.name = any.ua.model;
  if (picks.cover) {
    const c = screenSize(picks.cover);
    next.coverW = Math.round(c.w);
    next.coverH = Math.round(c.h);
  }
  if (picks.main) {
    const m = screenSize(picks.main);
    next.mainW = Math.round(m.w);
    next.mainH = Math.round(m.h);
    next.hingeGap = hingeGap(picks.main);
  }
  return next;
}
