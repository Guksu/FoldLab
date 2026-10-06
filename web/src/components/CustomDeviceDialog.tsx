import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronRight, CircleAlert, X } from 'lucide-react';
import { CUSTOM_DEFAULTS, CUSTOM_PRESETS, buildCustomDevice, type CustomParams } from '../../../shared/custom';
import { computeLayout } from '../../../shared/geometry';
import type { DeviceSpec } from '../../../shared/types';
import { validateDevice } from '../../../shared/validate';
import { DeviceBase, DeviceDefs, DeviceTop, frameBox } from './DeviceArt';
import { Button, IconButton, Select } from './ui';

interface Props {
  onSave: (device: DeviceSpec) => void;
  onClose: () => void;
}

type NumKey = { [K in keyof CustomParams]: CustomParams[K] extends number ? K : never }[keyof CustomParams];

const KIND_TEXT: Record<CustomParams['kind'], string> = {
  book: '책형 폴더블',
  flip: '플립',
  dual: '듀얼 스크린',
};

function Preview({ device, postureId, caption }: { device: DeviceSpec; postureId: string; caption: string }) {
  const uid = useId().replace(/:/g, '');
  const layout = computeLayout(device, postureId, { mode: 'app', fit: 'cover' });
  const box = frameBox(device, layout);
  return (
    <figure className="custom-preview-item">
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="custom-preview" aria-hidden>
        <DeviceDefs uid={uid} />
        <DeviceBase device={device} layout={layout} url="" uid={uid} />
        <rect x={layout.viewport.x} y={layout.viewport.y} width={layout.viewport.w} height={layout.viewport.h} fill="#f7f8fa" />
        <DeviceTop device={device} layout={layout} uid={uid} />
      </svg>
      <span>
        {caption} · {layout.viewport.w}×{layout.viewport.h}
      </span>
    </figure>
  );
}

/** 카탈로그에 없는 기기(사내 시제품, 루머 기기 등)를 값으로 정의한다 */
export function CustomDeviceDialog({ onSave, onClose }: Props) {
  const [p, setP] = useState<CustomParams>(CUSTOM_DEFAULTS);
  const [json, setJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const device = useMemo(() => buildCustomDevice(p, 'custom-preview'), [p]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const num = (key: NumKey, label: string, min: number, max: number, step = 1) => (
    <label className="form-field">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={p[key]}
        onChange={(e) => setP({ ...p, [key]: Number(e.target.value) })}
      />
    </label>
  );

  const save = () => {
    const d = buildCustomDevice(p);
    const problem = validateDevice(d);
    if (problem) {
      setError(problem);
      return;
    }
    onSave(d);
  };

  const importJson = () => {
    try {
      const d = JSON.parse(json) as DeviceSpec;
      const problem = validateDevice(d);
      if (problem) throw new Error(problem);
      onSave({ ...d, id: d.id.startsWith('custom-') ? d.id : `custom-${d.id}`, status: 'custom' });
    } catch (err) {
      setError(`JSON을 읽지 못했습니다: ${(err as Error).message}`);
    }
  };

  const dual = p.kind === 'dual';

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="custom-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="custom-title">기기 직접 만들기</h2>
            <p>
              카탈로그에 없는 기기(사내 시제품, 출시 전 루머 기기 등)를 CSS px 값으로 정의합니다. 렌더링 엔진은 크로미움이므로 iOS를 고르면 화면
              크기·UA·안전 영역만 흉내 냅니다.
            </p>
          </div>
          <IconButton icon={X} label="닫기" onClick={onClose} />
        </header>

        <div className="modal-body">
          <div className="custom-grid">
            <div>
              <section className="form-section">
                <h3>기본 정보</h3>
                <div className="form-grid">
                  <label className="form-field wide">
                    <span>이름</span>
                    <input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
                  </label>
                  <label className="form-field">
                    <span>종류</span>
                    <Select
                      value={p.kind}
                      onChange={(e) => {
                        const kind = e.target.value as CustomParams['kind'];
                        setP({ ...p, ...CUSTOM_PRESETS[kind], kind });
                      }}
                    >
                      {(Object.keys(KIND_TEXT) as CustomParams['kind'][]).map((k) => (
                        <option key={k} value={k}>
                          {KIND_TEXT[k]}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="form-field">
                    <span>플랫폼</span>
                    <Select value={p.platform} onChange={(e) => setP({ ...p, platform: e.target.value as CustomParams['platform'] })}>
                      <option value="ios">iOS (Safari UA)</option>
                      <option value="android">Android (Chrome UA)</option>
                    </Select>
                  </label>
                </div>
              </section>

              <section className="form-section">
                <h3>화면 크기 (CSS px)</h3>
                <div className="form-grid">
                  {!dual && num('coverW', '커버 화면 폭', 200, 1200)}
                  {!dual && num('coverH', '커버 화면 높이', 200, 1600)}
                  {num('mainW', dual ? '화면 한 장 폭' : '메인 화면 폭', 200, 2000)}
                  {num('mainH', dual ? '화면 한 장 높이' : '메인 화면 높이', 200, 2000)}
                  {num('dpr', 'DPR', 1, 4, 0.125)}
                  {num('hingeGap', dual ? '힌지 폭' : '힌지 폭 (0=주름)', 0, 120)}
                </div>
              </section>

              <section className="form-section">
                <h3>카메라 · 시스템 바</h3>
                <div className="form-grid">
                  <label className="form-field">
                    <span>카메라</span>
                    <Select value={p.camera} onChange={(e) => setP({ ...p, camera: e.target.value as CustomParams['camera'] })}>
                      <option value="island">다이내믹 아일랜드</option>
                      <option value="top-center">펀치 홀 · 가운데</option>
                      <option value="top-left">펀치 홀 · 왼쪽</option>
                      <option value="top-right">펀치 홀 · 오른쪽</option>
                      <option value="none">없음</option>
                    </Select>
                  </label>
                  {p.camera !== 'island' && p.camera !== 'none' && num('cameraSize', '카메라 지름', 6, 40)}
                  {num('statusBar', '상태 표시줄', 0, 80)}
                  {num('navBar', '홈 인디케이터', 0, 60)}
                  {num('radius', '모서리 반경', 0, 80)}
                </div>
              </section>

              <details className="json-import">
                <summary>
                  <ChevronRight size={14} aria-hidden />
                  JSON으로 가져오기
                </summary>
                <div className="json-body">
                  <textarea value={json} onChange={(e) => setJson(e.target.value)} placeholder="팀원이 공유한 기기 JSON을 붙여 넣으세요" rows={5} />
                  <Button size="sm" onClick={importJson} disabled={!json.trim()}>
                    가져오기
                  </Button>
                </div>
              </details>
            </div>

            <div className="custom-previews">
              <Preview device={device} postureId={dual ? 'single' : p.kind === 'flip' ? 'cover' : 'folded'} caption={dual ? '한 화면' : '접힘'} />
              <Preview device={device} postureId={dual ? 'spanned' : 'unfolded'} caption={dual ? '두 화면 걸침' : '펼침'} />
            </div>
          </div>

          {error && (
            <p className="callout callout-error" role="alert">
              <CircleAlert size={14} aria-hidden />
              <span>{error}</span>
            </p>
          )}
        </div>

        <footer className="modal-foot">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={save}>
            기기 추가
          </Button>
        </footer>
      </div>
    </div>
  );
}
