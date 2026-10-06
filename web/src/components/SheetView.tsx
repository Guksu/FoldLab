import { forwardRef } from 'react';
import { SEVERITY_LABEL, SEVERITY_ORDER } from '../../../shared/rules';
import type { CaptureResult } from '../../../shared/protocol';
import type { DeviceSpec } from '../../../shared/types';
import { MODE_LABEL, SEVERITY_COLOR, SEVERITY_TINT, formatTime, postureLabel } from '../lib/format';
import { DebugOverlay, DeviceBase, DeviceDefs, DeviceTop, frameBox, type OverlayToggles } from './DeviceArt';

// PNG로 내보낼 때는 웹 글꼴을 못 쓰므로 시스템 한글 글꼴을 뒤에 둔다
const FONT = "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Noto Sans CJK KR', system-ui, sans-serif";
const MONO = `'SF Mono', SFMono-Regular, ui-monospace, Menlo, Consolas, ${FONT}`;
const PAD = 40;
const GAP = 48;
const HEADER = 104;
const CAPTION = 72;
const FRAME_HEIGHT = 520;

interface Props {
  result: CaptureResult;
  device: DeviceSpec;
  debug: boolean;
  toggles: OverlayToggles;
}

/** 자세별 캡처를 기기 프레임째 한 장의 svg로 그린다. 그대로 PNG로 내보낸다. */
export const SheetView = forwardRef<SVGSVGElement, Props>(function SheetView({ result, device, debug, toggles }, ref) {
  const frames = result.items.map((item) => ({ item, box: frameBox(device, item.layout) }));
  const tallest = Math.max(...frames.map((f) => f.box.h), 1);
  // 모든 자세를 같은 배율로 그려 실제 크기 차이가 보이게 한다
  const k = Math.min(0.75, FRAME_HEIGHT / tallest);
  let x = PAD;
  const placed = frames.map((f) => {
    const w = f.box.w * k;
    const out = { ...f, x, w, h: f.box.h * k };
    x += w + GAP;
    return out;
  });
  const width = Math.max(600, x - GAP + PAD);
  const bodyH = Math.max(...placed.map((p) => p.h));
  const height = HEADER + bodyH + CAPTION + PAD - 8;
  const totals = SEVERITY_ORDER.map((s) => ({ s, n: result.items.reduce((sum, it) => sum + it.analysis.counts[s], 0) }));
  const url = result.url.length > 90 ? result.url.slice(0, 89) + '…' : result.url;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="sheet-svg"
      fontFamily={FONT}
    >
      <rect width={width} height={height} rx={16} fill="#ffffff" />
      <rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={16} fill="none" stroke="#e4e7ec" />

      {/* 머리말: 로고, 기기 이름, 주소·시각, 전체 문제 수 */}
      <g transform={`translate(${PAD} 30)`}>
        <rect x={0} y={4} width={8.5} height={15} rx={2.2} fill="#101828" />
        <path d="M10.5 5.2c0-.45.3-.85.73-.98l6.2-1.86A1.2 1.2 0 0 1 19 3.5v16a1.2 1.2 0 0 1-1.57 1.14l-6.2-1.86a1.03 1.03 0 0 1-.73-.98z" fill="#4f46e5" />
        <text x={30} y={12} dominantBaseline="central" fontSize={13} fontWeight={600} fill="#667085">
          FoldLab 비교 시트
        </text>
      </g>
      <text x={PAD} y={76} fontSize={21} fontWeight={700} fill="#101828" letterSpacing="-0.02em">
        {device.name}
      </text>
      <text x={PAD} y={HEADER - 4} fontSize={12} fill="#667085" fontFamily={MONO}>
        {url} · {formatTime(result.at)} · {MODE_LABEL[result.mode]}
        {debug ? '' : ' · 디버그 표시 없음'}
      </text>
      {(() => {
        // 오른쪽 위: 모든 자세의 문제 수 합계
        let rx = width - PAD;
        return [...totals].reverse().map(({ s, n }) => {
          const label = `${SEVERITY_LABEL[s]} ${n}`;
          const cw = label.length * 8 + 30;
          rx -= cw;
          const cx = rx;
          rx -= 6;
          return (
            <g key={s}>
              <rect x={cx} y={56} width={cw} height={26} rx={7} fill={n ? SEVERITY_TINT[s].bg : '#f2f4f7'} />
              <circle cx={cx + 13} cy={69} r={3.5} fill={n ? SEVERITY_COLOR[s] : '#c0c7d2'} />
              <text x={cx + 22} y={69.5} dominantBaseline="central" fontSize={12.5} fontWeight={600} fill={n ? SEVERITY_TINT[s].fg : '#98a2b3'}>
                {label}
              </text>
            </g>
          );
        });
      })()}
      <line x1={PAD} x2={width - PAD} y1={HEADER + 14} y2={HEADER + 14} stroke="#eef0f3" />

      {placed.map(({ item, box, x: fx, h }, i) => {
        const uid = `sheet${i}`;
        const vp = item.layout.viewport;
        const y = HEADER + 28 + (bodyH - h);
        const counts = item.analysis.counts;
        const chips = SEVERITY_ORDER.filter((s) => counts[s] > 0);
        const capY = HEADER + 28 + bodyH;
        let cx = fx;
        return (
          <g key={item.postureId}>
            <g transform={`translate(${fx} ${y}) scale(${k}) translate(${-box.x} ${-box.y})`}>
              <DeviceDefs uid={uid} />
              <DeviceBase device={device} layout={item.layout} url={result.url} uid={uid} />
              <image href={item.image} x={vp.x} y={vp.y} width={vp.w} height={vp.h} preserveAspectRatio="none" />
              <DeviceTop device={device} layout={item.layout} uid={uid} revealHinge={debug && toggles.zones} />
              {debug && (
                <DebugOverlay
                  layout={item.layout}
                  analysis={item.analysis}
                  issues={item.analysis.issues}
                  show={toggles}
                  uid={uid}
                  labelScale={Math.min(2.4, 1 / k)}
                  numbering={new Map(item.analysis.issues.map((iss, n) => [iss.id, n + 1]))}
                />
              )}
            </g>
            <text x={fx} y={capY + 26} fontSize={14} fontWeight={600} fill="#101828">
              {postureLabel(device, item.postureId)}
              <tspan dx={8} fontSize={11.5} fontWeight={400} fill="#98a2b3" fontFamily={MONO}>
                {vp.w}×{vp.h}
              </tspan>
            </text>
            {chips.length === 0 ? (
              <g>
                <rect x={fx} y={capY + 38} width={68} height={22} rx={6} fill="#ecfdf3" />
                <text x={fx + 34} y={capY + 49.5} textAnchor="middle" dominantBaseline="central" fontSize={11.5} fontWeight={600} fill="#067647">
                  문제 없음
                </text>
              </g>
            ) : (
              chips.map((s) => {
                const label = `${SEVERITY_LABEL[s]} ${counts[s]}`;
                const cw = label.length * 8 + 26;
                const node = (
                  <g key={s}>
                    <rect x={cx} y={capY + 38} width={cw} height={22} rx={6} fill={SEVERITY_TINT[s].bg} />
                    <circle cx={cx + 11} cy={capY + 49} r={3} fill={SEVERITY_COLOR[s]} />
                    <text x={cx + 19} y={capY + 49.5} dominantBaseline="central" fontSize={11.5} fontWeight={600} fill={SEVERITY_TINT[s].fg}>
                      {label}
                    </text>
                  </g>
                );
                cx += cw + 6;
                return node;
              })
            )}
          </g>
        );
      })}
    </svg>
  );
});
