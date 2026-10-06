import type { ReactNode } from 'react';
import type { Analysis, DeviceSpec, Insets, Issue, Layout, Rect } from '../../../shared/types';
import { SEVERITY_COLOR, hostOf } from '../lib/format';

/** 화면 좌표(CSS px) 기준으로 기기 그림을 그린다. 바깥 svg의 viewBox는 frameBox()를 쓴다. */

export function bezelOf(device: DeviceSpec): number {
  return device.kind === 'dual' ? 14 : 11;
}

export function frameBox(device: DeviceSpec, layout: Layout) {
  const b = bezelOf(device);
  return { x: -b, y: -b, w: layout.screen.w + b * 2, h: layout.screen.h + b * 2, b };
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return (
    `M${x + rr},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h - rr}` +
    `A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}H${x + rr}A${rr},${rr} 0 0 1 ${x},${y + h - rr}V${y + rr}` +
    `A${rr},${rr} 0 0 1 ${x + rr},${y}Z`
  );
}

function within(a: Rect | null, b: Rect): boolean {
  if (!a) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function DeviceDefs({ uid }: { uid: string }) {
  return (
    <defs>
      <pattern id={`${uid}-hatch-amber`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" fill="rgba(240,140,0,0.10)" />
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(240,140,0,0.65)" strokeWidth="2" />
      </pattern>
      <pattern id={`${uid}-hatch-red`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="7" height="7" fill="rgba(229,72,77,0.12)" />
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(229,72,77,0.7)" strokeWidth="2" />
      </pattern>
      <pattern id={`${uid}-stripes`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="10" height="10" fill="#e6e8ec" />
        <line x1="0" y1="0" x2="0" y2="10" stroke="#d9dce2" strokeWidth="4" />
      </pattern>
      <linearGradient id={`${uid}-crease-v`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="0.42" stopColor="#000" stopOpacity="0.10" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0.22" />
        <stop offset="0.58" stopColor="#000" stopOpacity="0.10" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${uid}-crease-h`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="0.42" stopColor="#000" stopOpacity="0.10" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0.22" />
        <stop offset="0.58" stopColor="#000" stopOpacity="0.10" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${uid}-fold-v`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="0.5" stopColor="#000" stopOpacity="0.28" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${uid}-fold-h`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="0.5" stopColor="#000" stopOpacity="0.28" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </linearGradient>
    </defs>
  );
}

function StatusIcons({ bar, dark }: { bar: Rect; dark: boolean }) {
  const color = dark ? '#111' : '#fff';
  const halo = dark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.4)';
  const cy = bar.y + bar.h / 2;
  const right = bar.x + bar.w - 16;
  const fs = Math.min(14, bar.h * 0.42);
  return (
    <g pointerEvents="none">
      <text
        x={bar.x + 18}
        y={cy}
        dominantBaseline="central"
        fontSize={fs}
        fontWeight={600}
        fill={color}
        stroke={halo}
        strokeWidth={2.5}
        paintOrder="stroke"
        fontFamily="Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif"
      >
        9:41
      </text>
      {/* 배터리 */}
      <rect x={right - 22} y={cy - 5} width={20} height={10} rx={2.5} fill="none" stroke={color} strokeWidth={1.4} opacity={0.9} />
      <rect x={right - 20} y={cy - 3} width={14} height={6} rx={1} fill={color} />
      <rect x={right - 1.5} y={cy - 2} width={2} height={4} rx={1} fill={color} opacity={0.8} />
      {/* 와이파이 */}
      <path
        d={`M${right - 40},${cy + 3} l4,4 l4,-4 M${right - 43},${cy} a8,8 0 0 1 14,0`}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      {/* 신호 */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={right - 64 + i * 4.5} y={cy + 4 - (i + 1) * 2.4} width={3} height={(i + 1) * 2.4} rx={0.8} fill={color} />
      ))}
    </g>
  );
}

function BrowserBar({ bar, url }: { bar: Rect; url: string }) {
  const pillX = bar.x + 12;
  const pillW = Math.max(60, bar.w - 12 - 76);
  const cy = bar.y + bar.h / 2;
  const host = hostOf(url) || '주소';
  return (
    <g pointerEvents="none">
      <rect x={bar.x} y={bar.y} width={bar.w} height={bar.h} fill="#ffffff" />
      <rect x={pillX} y={cy - 18} width={pillW} height={36} rx={18} fill="#eef0f3" />
      <circle cx={pillX + 18} cy={cy} r={5} fill="none" stroke="#5f6368" strokeWidth={1.6} />
      <text
        x={pillX + 32}
        y={cy}
        dominantBaseline="central"
        fontSize={14}
        fill="#202124"
        fontFamily="Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif"
      >
        {host.length > Math.floor(pillW / 8) ? host.slice(0, Math.floor(pillW / 8) - 1) + '…' : host}
      </text>
      <rect x={bar.x + bar.w - 56} y={cy - 10} width={20} height={20} rx={4} fill="none" stroke="#3c4043" strokeWidth={1.8} />
      <text x={bar.x + bar.w - 46} y={cy + 0.5} dominantBaseline="central" textAnchor="middle" fontSize={11} fontWeight={700} fill="#3c4043">
        1
      </text>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={bar.x + bar.w - 18} cy={cy - 6 + i * 6} r={1.8} fill="#3c4043" />
      ))}
      <line x1={bar.x} x2={bar.x + bar.w} y1={bar.y + bar.h - 0.5} y2={bar.y + bar.h - 0.5} stroke="#dadce0" />
    </g>
  );
}

/** 콘텐츠 아래에 깔리는 층: 기기 몸체, 검은 화면, 다른 앱, 브라우저 UI, 불투명한 시스템 바 */
export function DeviceBase({ device, layout, url, uid }: { device: DeviceSpec; layout: Layout; url: string; uid: string }) {
  const box = frameBox(device, layout);
  const { screen, viewport } = layout;
  const solidStatus = layout.statusBar && !within(layout.statusBar, viewport) ? layout.statusBar : null;
  const solidNav = layout.navBar && !within(layout.navBar, viewport) ? layout.navBar : null;
  return (
    <g>
      <path d={roundedRectPath(box.x, box.y, box.w, box.h, screen.radius + box.b * 0.8)} fill={device.frameColor ?? '#1c1f26'} />
      <path
        d={roundedRectPath(box.x + 1, box.y + 1, box.w - 2, box.h - 2, screen.radius + box.b * 0.8 - 1)}
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1.2}
      />
      <path d={roundedRectPath(0, 0, screen.w, screen.h, screen.radius)} fill="#000" />
      {layout.otherApp && (
        <g>
          <rect x={layout.otherApp.x} y={layout.otherApp.y} width={layout.otherApp.w} height={layout.otherApp.h} fill={`url(#${uid}-stripes)`} />
          <text
            x={layout.otherApp.x + layout.otherApp.w / 2}
            y={layout.otherApp.y + layout.otherApp.h / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={15}
            fill="#8a9099"
            fontFamily="Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', system-ui, sans-serif"
          >
            다른 앱
          </text>
        </g>
      )}
      {solidStatus && <rect x={solidStatus.x} y={solidStatus.y} width={solidStatus.w} height={solidStatus.h} fill="#ffffff" />}
      {solidStatus && <StatusIcons bar={solidStatus} dark />}
      {layout.browserBar && <BrowserBar bar={layout.browserBar} url={url} />}
      {solidNav && <rect x={solidNav.x} y={solidNav.y} width={solidNav.w} height={solidNav.h} fill="#ffffff" />}
    </g>
  );
}

/** 화면 분할 구분선 손잡이 */
function SplitHandle({ layout }: { layout: Layout }) {
  const a = layout.window;
  const o = layout.otherApp;
  if (!o) return null;
  const { w: W, h: H } = layout.screen;
  const fill = '#9aa1ab';
  if (o.x >= a.x + a.w - 1) return <rect x={(a.x + a.w + o.x) / 2 - 2} y={H / 2 - 20} width={4} height={40} rx={2} fill={fill} />;
  if (o.x + o.w <= a.x + 1) return <rect x={(o.x + o.w + a.x) / 2 - 2} y={H / 2 - 20} width={4} height={40} rx={2} fill={fill} />;
  if (o.y >= a.y + a.h - 1) return <rect x={W / 2 - 20} y={(a.y + a.h + o.y) / 2 - 2} width={40} height={4} rx={2} fill={fill} />;
  return <rect x={W / 2 - 20} y={(o.y + o.h + a.y) / 2 - 2} width={40} height={4} rx={2} fill={fill} />;
}

/** 콘텐츠 위에 덮는 층: 베젤 링, 카메라, 투명 상태 표시줄, 홈 인디케이터, 주름·힌지 */
export function DeviceTop({
  device,
  layout,
  uid,
  revealHinge,
}: {
  device: DeviceSpec;
  layout: Layout;
  uid: string;
  revealHinge?: boolean;
}) {
  const box = frameBox(device, layout);
  const { screen, viewport } = layout;
  const ring =
    roundedRectPath(box.x, box.y, box.w, box.h, screen.radius + box.b * 0.8) + roundedRectPath(0, 0, screen.w, screen.h, screen.radius);
  const overlayStatus = layout.statusBar && within(layout.statusBar, viewport) ? layout.statusBar : null;
  const nav = layout.navBar;
  const halfOpen = layout.devicePosture === 'folded';
  return (
    <g pointerEvents="none">
      {layout.screenFolds.map((f, i) => {
        const vertical = f.axis === 'vertical';
        if (f.gap > 0) {
          const x = vertical ? f.at - f.gap / 2 : box.x;
          const y = vertical ? box.y : f.at - f.gap / 2;
          const w = vertical ? f.gap : box.w;
          const h = vertical ? box.h : f.gap;
          return (
            <g key={i} opacity={revealHinge ? 0.55 : 1}>
              <rect x={x} y={y} width={w} height={h} fill={device.frameColor ?? '#1c1f26'} />
              <rect
                x={vertical ? f.at - 3 : x}
                y={vertical ? y : f.at - 3}
                width={vertical ? 6 : w}
                height={vertical ? h : 6}
                fill="rgba(0,0,0,0.35)"
              />
            </g>
          );
        }
        const band = halfOpen ? 70 : 10;
        return (
          <rect
            key={i}
            x={vertical ? f.at - band / 2 : 0}
            y={vertical ? 0 : f.at - band / 2}
            width={vertical ? band : screen.w}
            height={vertical ? screen.h : band}
            fill={`url(#${uid}-${halfOpen ? 'fold' : 'crease'}-${vertical ? 'v' : 'h'})`}
          />
        );
      })}
      <SplitHandle layout={layout} />
      {overlayStatus && <StatusIcons bar={overlayStatus} dark />}
      {nav && (
        <rect
          x={nav.x + nav.w / 2 - 54}
          y={nav.y + nav.h / 2 - 2}
          width={108}
          height={4}
          rx={2}
          fill="rgba(20,20,20,0.75)"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth={0.8}
        />
      )}
      <path d={ring} fill={device.frameColor ?? '#1c1f26'} fillRule="evenodd" />
      {layout.cutouts.map((c, i) =>
        c.shape === 'circle' ? (
          <g key={i}>
            <circle cx={c.x + c.w / 2} cy={c.y + c.h / 2} r={Math.min(c.w, c.h) / 2} fill="#050607" />
            <circle cx={c.x + c.w / 2 - c.w * 0.12} cy={c.y + c.h / 2 - c.h * 0.12} r={Math.min(c.w, c.h) * 0.12} fill="#1f2a3a" />
          </g>
        ) : (
          <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} rx={c.shape === 'pill' ? Math.min(c.w, c.h) / 2 : 3} fill="#050607" />
        ),
      )}
    </g>
  );
}

export interface OverlayToggles {
  zones: boolean;
  safe: boolean;
  issues: boolean;
  segments: boolean;
}

function Chip({ x, y, text, color = '#111827', scale, anchor = 'start' }: { x: number; y: number; text: string; color?: string; scale: number; anchor?: 'start' | 'middle' | 'end' }) {
  const fs = 10.5 * scale;
  const w = (text.length * 6.1 + 10) * scale;
  const h = 16 * scale;
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w;
  return (
    <g>
      <rect x={left} y={y} width={w} height={h} rx={4 * scale} fill={color} opacity={0.92} />
      <text
        x={left + w / 2}
        y={y + h / 2 + 0.5 * scale}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fs}
        fill="#fff"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      >
        {text}
      </text>
    </g>
  );
}

const EDGE_LABEL: Record<keyof Insets, string> = { top: 'T', right: 'R', bottom: 'B', left: 'L' };

/** 디버그 표시: 위험 구역, 안전 영역 값, 세그먼트, 문제 위치 */
export function DebugOverlay({
  layout,
  analysis,
  issues,
  selectedId,
  show,
  uid,
  labelScale = 1,
  numbering,
}: {
  layout: Layout;
  analysis: Analysis | null;
  issues: Issue[];
  selectedId?: string | null;
  show: OverlayToggles;
  uid: string;
  labelScale?: number;
  numbering?: Map<string, number>;
}) {
  const vp = layout.viewport;
  const s = labelScale;
  const parts: ReactNode[] = [];

  if (show.safe) {
    layout.obstructions.forEach((o) => {
      if (o.kind === 'hinge' || o.kind === 'crease') return;
      const r = { x: o.rect.x + vp.x, y: o.rect.y + vp.y, w: o.rect.w, h: o.rect.h };
      if (o.shape === 'circle') {
        parts.push(
          <circle
            key={`ob-${o.id}`}
            cx={r.x + r.w / 2}
            cy={r.y + r.h / 2}
            r={r.w / 2 + 6}
            fill={`url(#${uid}-hatch-amber)`}
            stroke="rgba(240,140,0,0.9)"
            strokeWidth={1.2}
          />,
        );
      } else if (o.shape === 'corner') {
        const rad = o.radius ?? r.w;
        const cx = o.corner === 'tl' || o.corner === 'bl' ? r.x + rad : r.x + r.w - rad;
        const cy = o.corner === 'tl' || o.corner === 'tr' ? r.y + rad : r.y + r.h - rad;
        const px = o.corner === 'tl' || o.corner === 'bl' ? r.x : r.x + r.w;
        const py = o.corner === 'tl' || o.corner === 'tr' ? r.y : r.y + r.h;
        const d = `M${px},${py} L${px},${cy} A${rad},${rad} 0 0 ${o.corner === 'tl' || o.corner === 'br' ? 1 : 0} ${cx},${py} Z`;
        parts.push(<path key={`ob-${o.id}`} d={d} fill={`url(#${uid}-hatch-amber)`} />);
      } else {
        parts.push(
          <rect key={`ob-${o.id}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={`url(#${uid}-hatch-amber)`} stroke="rgba(240,140,0,0.6)" strokeWidth={0.8} />,
        );
      }
    });
    // 가장자리별 실제 가림 깊이와 페이지가 받은 env() 값
    const env = analysis?.env.safeArea;
    (Object.keys(layout.rawInsets) as (keyof Insets)[]).forEach((edge) => {
      const raw = layout.rawInsets[edge];
      if (!raw) return;
      const got = env ? Math.round(env[edge]) : layout.insets[edge];
      const text = `${EDGE_LABEL[edge]} ${raw} · env ${got}`;
      const color = got >= raw ? '#15803d' : '#b45309';
      const pos =
        edge === 'top'
          ? { x: vp.x + vp.w - 8 * s, y: layout.window.y + raw + 4 * s, anchor: 'end' as const }
          : edge === 'bottom'
            ? { x: vp.x + vp.w - 8 * s, y: layout.window.y + layout.window.h - raw - 20 * s, anchor: 'end' as const }
            : edge === 'left'
              ? { x: layout.window.x + raw + 4 * s, y: vp.y + vp.h / 2, anchor: 'start' as const }
              : { x: layout.window.x + layout.window.w - raw - 4 * s, y: vp.y + vp.h / 2, anchor: 'end' as const };
      parts.push(<Chip key={`inset-${edge}`} x={pos.x} y={pos.y} text={text} color={color} scale={s} anchor={pos.anchor} />);
    });
  }

  if (show.zones) {
    layout.folds.forEach((f, i) => {
      const z = { x: f.zone.x + vp.x, y: f.zone.y + vp.y, w: f.zone.w, h: f.zone.h };
      const vertical = f.axis === 'vertical';
      const line = vertical ? { x1: vp.x + f.at, x2: vp.x + f.at, y1: vp.y, y2: vp.y + vp.h } : { x1: vp.x, x2: vp.x + vp.w, y1: vp.y + f.at, y2: vp.y + f.at };
      const red = f.gap > 0 || f.separating;
      parts.push(
        <g key={`fold-${i}`}>
          <rect x={z.x} y={z.y} width={z.w} height={z.h} fill={red ? `url(#${uid}-hatch-red)` : 'rgba(240,140,0,0.10)'} />
          <line {...line} stroke={red ? '#e5484d' : '#f08c00'} strokeWidth={1.2 * s} strokeDasharray={`${5 * s} ${4 * s}`} />
          <Chip
            x={vertical ? vp.x + f.at : vp.x + 8 * s}
            y={vertical ? vp.y + vp.h * 0.36 : vp.y + f.at - 22 * s}
            text={f.gap > 0 ? `힌지 ${f.gap}px` : f.separating ? '접는 선' : '주름'}
            color={red ? '#c62828' : '#c2410c'}
            scale={s}
            anchor={vertical ? 'middle' : 'start'}
          />
        </g>,
      );
    });
  }

  if (show.segments && analysis && analysis.env.segments.length > 1) {
    analysis.env.segments.forEach((seg, i) => {
      parts.push(
        <g key={`seg-${i}`}>
          <rect
            x={vp.x + seg.x + 3}
            y={vp.y + seg.y + 3}
            width={Math.max(0, seg.w - 6)}
            height={Math.max(0, seg.h - 6)}
            fill="none"
            stroke="#3e7bfa"
            strokeWidth={1.4 * s}
            strokeDasharray={`${7 * s} ${5 * s}`}
          />
          <Chip x={vp.x + seg.x + 8 * s} y={vp.y + seg.y + seg.h - 24 * s} text={`seg ${i} · ${Math.round(seg.w)}×${Math.round(seg.h)}`} color="#1d4ed8" scale={s} />
        </g>,
      );
    });
  }

  if (show.issues) {
    // 선택된 이슈를 마지막에 그려 위로 올린다
    const ordered = [...issues].sort((a, b) => (a.id === selectedId ? 1 : b.id === selectedId ? -1 : 0));
    ordered.forEach((issue) => {
      const color = SEVERITY_COLOR[issue.severity];
      const selected = issue.id === selectedId;
      const n = numbering?.get(issue.id);
      issue.rects.forEach((r, j) => {
        const x = vp.x + r.x;
        const y = vp.y + r.y;
        parts.push(
          <rect
            key={`is-${issue.id}-${j}`}
            x={x}
            y={y}
            width={r.w}
            height={r.h}
            rx={2}
            fill={selected ? `${color}33` : `${color}14`}
            stroke={color}
            strokeWidth={(selected ? 2.6 : 1.4) * s}
            strokeDasharray={issue.severity === 'info' ? `${4 * s} ${3 * s}` : undefined}
          />,
        );
        if (j === 0 && n !== undefined) {
          const bx = Math.max(vp.x + 9 * s, Math.min(vp.x + vp.w - 9 * s, x));
          const by = Math.max(vp.y + 9 * s, Math.min(vp.y + vp.h - 9 * s, y));
          parts.push(
            <g key={`badge-${issue.id}`}>
              <circle cx={bx} cy={by} r={(selected ? 10 : 8.5) * s} fill={color} stroke="#fff" strokeWidth={1.5 * s} />
              <text x={bx} y={by + 0.5 * s} textAnchor="middle" dominantBaseline="central" fontSize={10 * s} fontWeight={700} fill="#fff" fontFamily="system-ui, sans-serif">
                {n}
              </text>
            </g>,
          );
        }
      });
    });
  }

  return <g pointerEvents="none">{parts}</g>;
}
