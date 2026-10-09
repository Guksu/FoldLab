import type { Ref } from 'react';
import { ArrowRight, Camera, Copy, Download, FileText, Images } from 'lucide-react';
import type { CaptureResult } from '../../../shared/protocol';
import type { DeviceSpec } from '../../../shared/types';
import { formatTime, hostOf, postureLabel } from '../lib/format';
import type { OverlayToggles } from './DeviceArt';
import { SheetView } from './SheetView';
import { Button, CheckChip, Switch } from './ui';

interface Props {
  device: DeviceSpec;
  live: boolean;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  progress: { done: number; total: number; postureId: string } | null;
  capture: CaptureResult | null;
  debug: boolean;
  onDebugChange: (v: boolean) => void;
  toggles: OverlayToggles;
  sheetRef: Ref<SVGSVGElement>;
  onCapture: () => void;
  onExportPng: (copy: boolean) => void;
  onCopyMarkdown: () => void;
  onGoLive: () => void;
}

/** 비교 시트 탭: 고른 자세를 차례로 캡처해 기기 프레임째 한 장으로 만든다 */
export function SheetPage(props: Props) {
  const { device, live, selected, progress, capture } = props;
  const count = device.postures.filter((p) => selected.includes(p.id)).length;
  const result = capture && capture.deviceId === device.id ? capture : null;

  return (
    <main className="sheet-page">
      <div className="sheet-inner">
        <header className="page-head">
          <h1>비교 시트</h1>
          <p>
            고른 자세를 차례로 바꿔 가며 같은 페이지를 캡처하고, 자세별 문제 수를 함께 적어 한 장으로 만듭니다. PNG나 Markdown으로 PR·Jira에 그대로
            붙이면 됩니다.
          </p>
        </header>

        <section className="card capture-card">
          <div className="capture-head">
            <div>
              <h2>캡처할 자세</h2>
              <p>{device.name} · 모든 자세를 같은 배율로 그려 실제 크기 차이가 보입니다</p>
            </div>
          </div>
          <div className="chip-row">
            {device.postures.map((p) => (
              <CheckChip
                key={p.id}
                on={selected.includes(p.id)}
                disabled={!!progress}
                onChange={(on) => props.onSelectedChange(on ? [...selected, p.id] : selected.filter((id) => id !== p.id))}
              >
                {p.label}
              </CheckChip>
            ))}
          </div>
          <div className="capture-foot">
            <Button variant="primary" icon={Camera} onClick={props.onCapture} disabled={!!progress || !live || count === 0}>
              {progress ? `캡처 중 ${progress.done}/${progress.total}` : `${count}개 자세 캡처`}
            </Button>
            {!live && (
              <>
                <span className="muted">라이브 탭에서 주소를 먼저 열어 주세요.</span>
                <Button variant="ghost" size="sm" onClick={props.onGoLive}>
                  라이브로 이동
                  <ArrowRight size={14} aria-hidden />
                </Button>
              </>
            )}
          </div>
        </section>

        {progress && (
          <section className="card progress" aria-live="polite">
            <div className="progress-top">
              <span className="spinner" aria-hidden />
              {postureLabel(device, progress.postureId)} 자세로 바꾸고 캡처하는 중…
              <span className="num">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="progress-track">
              <div style={{ transform: `scaleX(${Math.max(0.04, progress.done / Math.max(1, progress.total))})` }} />
            </div>
          </section>
        )}

        {result ? (
          <section className="card sheet-result">
            <div className="sheet-toolbar">
              <div className="sheet-title">
                <b>
                  {device.name} · {result.items.length}개 자세
                </b>
                <span>
                  {hostOf(result.url)} · {formatTime(result.at)}
                </span>
              </div>
              <Switch checked={props.debug} onChange={props.onDebugChange}>
                디버그 표시
              </Switch>
              <div className="spacer" />
              <Button variant="ghost" size="sm" icon={Copy} onClick={() => props.onExportPng(true)}>
                이미지 복사
              </Button>
              <Button variant="ghost" size="sm" icon={FileText} onClick={props.onCopyMarkdown}>
                Markdown 복사
              </Button>
              <Button variant="primary" size="sm" icon={Download} onClick={() => props.onExportPng(false)}>
                PNG 저장
              </Button>
            </div>
            <div className="sheet-canvas">
              <SheetView ref={props.sheetRef} result={result} device={device} debug={props.debug} toggles={props.toggles} />
            </div>
          </section>
        ) : (
          !progress && (
            <section className="card empty-card">
              <div className="empty-state">
                <span className="empty-icon">
                  <Images size={20} aria-hidden />
                </span>
                <h3>아직 캡처한 시트가 없습니다</h3>
                <p>자세를 고르고 캡처하면 이곳에 기기 프레임째 나란히 그려 줍니다.</p>
              </div>
            </section>
          )
        )}
      </div>
    </main>
  );
}
