import { forwardRef } from 'react';
import { SEVERITY_LABEL, SEVERITY_ORDER } from '../../../shared/rules';
import type { CaptureResult } from '../../../shared/protocol';
import type { DeviceSpec } from '../../../shared/types';
import { MODE_LABEL, SEVERITY_COLOR, formatTime, postureLabel } from '../lib/format';
import { DebugOverlay, DeviceBase, DeviceDefs, DeviceTop, frameBox, type OverlayToggles } from './DeviceArt';

const FONT = "Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Noto Sans CJK KR', system-ui, sans-serif";
const PAD = 36;
const GAP = 44;
const HEADER = 92;
const CAPTION = 66;
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
  const width = Math.max(560, x - GAP + PAD);
  const bodyH = Math.max(...placed.map((p) => p.h));
  const height = HEADER + bodyH + CAPTION + PAD;

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
      <rect width={width} height={height} rx={18} fill="#fbfaf7" />
      <rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={18} fill="none" stroke="#e5e0d5" />
      <text x={PAD} y={42} fontSize={20} fontWeight={800} fill="#1f2329">
        {device.name} · FoldLab 비교 시트
      </text>
      <text x={PAD} y={66} fontSize={12.5} fill="#6b7280" fontFamily={`ui-monospace, SFMono-Regular, Menlo, Consolas, ${FONT}`}>
        {result.url.length > 90 ? result.url.slice(0, 89) + '…' : result.url} · {formatTime(result.at)} · {MODE_LABEL[result.mode]}
        {debug ? '' : ' · 디버그 표시 없음'}
      </text>
      <rect x={PAD} y={76} width={40} height={3} rx={1.5} fill="#e5484d" />

      {placed.map(({ item, box, x: fx, h }, i) => {
        const uid = `sheet${i}`;
        const vp = item.layout.viewport;
        const y = HEADER + (bodyH - h);
        const counts = item.analysis.counts;
        const chips = SEVERITY_ORDER.filter((s) => counts[s] > 0);
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
            <text x={fx} y={HEADER + bodyH + 26} fontSize={14} fontWeight={700} fill="#1f2329">
              {postureLabel(device, item.postureId)}
              <tspan dx={8} fontSize={11.5} fontWeight={400} fill="#8b909a">
                {vp.w}×{vp.h}
              </tspan>
            </text>
            {chips.length === 0 ? (
              <g>
                <rect x={fx} y={HEADER + bodyH + 36} width={64} height={20} rx={5} fill="#e8f6ec" />
                <text x={fx + 32} y={HEADER + bodyH + 46.5} textAnchor="middle" dominantBaseline="central" fontSize={11.5} fontWeight={700} fill="#1c7c3a">
                  문제 없음
                </text>
              </g>
            ) : (
              chips.map((s) => {
                const label = `${SEVERITY_LABEL[s]} ${counts[s]}`;
                const cw = label.length * 8.5 + 14;
                const node = (
                  <g key={s}>
                    <rect x={cx} y={HEADER + bodyH + 36} width={cw} height={20} rx={5} fill={SEVERITY_COLOR[s]} />
                    <text x={cx + cw / 2} y={HEADER + bodyH + 46.5} textAnchor="middle" dominantBaseline="central" fontSize={11.5} fontWeight={700} fill="#fff">
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
