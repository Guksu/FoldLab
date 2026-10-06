import type { DeviceSpec, DisplayMode, Issue, Layout, Severity } from '../../../shared/types';

export const SEVERITY_COLOR: Record<Severity, string> = {
  high: '#e5484d',
  warn: '#f08c00',
  info: '#3e7bfa',
};

export const MODE_LABEL: Record<DisplayMode, string> = {
  browser: '브라우저 탭',
  app: '앱·전체 화면',
};

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

export function viewportLabel(layout: Layout): string {
  return `${layout.viewport.w}×${layout.viewport.h}`;
}

export function postureLabel(device: DeviceSpec, postureId: string): string {
  return device.postures.find((p) => p.id === postureId)?.label ?? postureId;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 이슈 사각형을 현재 스크롤에 맞게 옮긴다(고정 요소는 그대로) */
export function shiftRects(issue: Issue, scroll: { x: number; y: number }, scale = 1) {
  if (issue.fixed) return issue.rects;
  const dx = (scroll.x - issue.scroll.x) * scale;
  const dy = (scroll.y - issue.scroll.y) * scale;
  if (!dx && !dy) return issue.rects;
  return issue.rects.map((r) => ({ ...r, x: r.x - dx, y: r.y - dy }));
}
