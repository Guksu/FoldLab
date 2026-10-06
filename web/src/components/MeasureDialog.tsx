import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Copy, Download, Laptop, RefreshCw, Smartphone, Trash2, Wand2, X } from 'lucide-react';
import { CUSTOM_DEFAULTS, CUSTOM_PRESETS, type CustomParams } from '../../../shared/custom';
import { closestPosture, compareSnapshot, customFromSnapshots, describeUa, type MeasureSnapshot, type MeasureUrl } from '../../../shared/measure';
import type { DeviceSpec, DisplayMode } from '../../../shared/types';
import type { ConnectionStatus } from '../lib/session';
import { downloadBlob } from '../lib/sheet';
import { QrCode } from './QrCode';
import { Button, IconButton, Select } from './ui';

export type SnapshotRole = 'cover' | 'main';

interface Props {
  conn: ConnectionStatus;
  ready: { urls: MeasureUrl[]; lanError?: string } | null;
  snapshots: MeasureSnapshot[];
  device: DeviceSpec;
  onRetry: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onPrefill: (params: CustomParams) => void;
  onCopy: (text: string, what: string) => void;
  onClose: () => void;
}

const insetText = (i: { top: number; right: number; bottom: number; left: number }) =>
  [i.top, i.right, i.bottom, i.left].map((v) => Math.round(v)).join(' · ');

const timeText = (at: number) => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** 측정 페이지는 브라우저 탭에서 열리므로 PWA로 연 경우만 앱 모드와 비교한다 */
const modeOf = (s: MeasureSnapshot): DisplayMode => (s.displayMode === 'browser' ? 'browser' : 'app');

/** 실기기·시뮬레이터에서 /measure를 열어 화면 값을 재고 카탈로그와 비교한다 */
export function MeasureDialog(props: Props) {
  const { ready, snapshots, device } = props;
  const lanUrls = ready?.urls.filter((u) => u.kind === 'lan') ?? [];
  const localUrl = ready?.urls.find((u) => u.kind === 'local');
  const [lanIndex, setLanIndex] = useState(0);
  const lan = lanUrls[Math.min(lanIndex, lanUrls.length - 1)];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, SnapshotRole>>({});
  const selected = snapshots.find((s) => s.id === selectedId) ?? snapshots[0] ?? null;
  const [postureId, setPostureId] = useState<string | null>(null);
  const mode = selected ? modeOf(selected) : 'browser';
  const autoPosture = useMemo(() => (selected ? closestPosture(device, mode, selected) : null), [device, mode, selected]);
  const comparePosture = postureId && device.postures.some((p) => p.id === postureId) ? postureId : autoPosture;
  const rows = useMemo(
    () => (selected && comparePosture ? compareSnapshot(device, comparePosture, mode, selected) : []),
    [device, comparePosture, mode, selected],
  );
  const mismatches = rows.filter((r) => r.ok === false).length;

  // 다른 측정값을 고르면 다시 가장 비슷한 자세부터 보여 준다
  useEffect(() => setPostureId(null), [selected?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  const pick = (role: SnapshotRole) => {
    const id = Object.keys(roles).find((k) => roles[k] === role && snapshots.some((s) => s.id === k));
    return snapshots.find((s) => s.id === id);
  };

  const prefill = () => {
    let cover = pick('cover');
    let main = pick('main');
    // 역할을 안 정했으면 뷰포트가 가장 작은 값을 커버, 가장 큰 값을 메인으로 본다
    if (!cover && !main && snapshots.length) {
      const byArea = [...snapshots].sort((a, b) => a.viewport.width * a.viewport.height - b.viewport.width * b.viewport.height);
      cover = byArea.length > 1 ? byArea[0] : undefined;
      main = byArea[byArea.length - 1];
    }
    const ref = main ?? cover;
    const tall = ref ? Math.max(ref.screen.width, ref.screen.height) / Math.max(1, Math.min(ref.screen.width, ref.screen.height)) : 1;
    const kind: CustomParams['kind'] = main && tall > 1.8 ? 'flip' : 'book';
    props.onPrefill(customFromSnapshots({ ...CUSTOM_DEFAULTS, ...CUSTOM_PRESETS[kind], kind }, { cover, main }));
  };

  const exportJson = () => {
    const data = { app: 'FoldLab', kind: 'measure', exportedAt: new Date().toISOString(), roles, snapshots };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `foldlab-measure-${stamp}.json`);
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <div className="modal measure-modal" role="dialog" aria-modal="true" aria-labelledby="measure-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="measure-title">실기기로 재기</h2>
            <p>
              폰이나 Xcode 시뮬레이터에서 측정 페이지를 열면 화면 크기·DPR·안전 영역·세그먼트·자세를 재서 이곳으로 보냅니다. 카탈로그 값과
              비교하거나, 잰 값으로 기기를 만들 수 있습니다.
            </p>
          </div>
          <IconButton icon={X} label="닫기" onClick={props.onClose} />
        </header>

        <div className="modal-body measure-body">
          <section className="measure-connect">
            <h3 className="measure-step">1. 기기에서 열기</h3>
            {props.conn !== 'open' && (
              <p className="callout callout-error">
                <CircleAlert size={14} aria-hidden />
                <span>FoldLab 서버와 연결이 끊겼습니다.</span>
                <Button size="sm" icon={RefreshCw} onClick={props.onRetry}>
                  다시 연결
                </Button>
              </p>
            )}
            <div className="connect-card">
              <div className="connect-title">
                <Smartphone size={15} aria-hidden />
                안드로이드 실기기 · 같은 와이파이
              </div>
              {lan ? (
                <>
                  <div className="qr-box">
                    <QrCode text={lan.url} />
                  </div>
                  {lanUrls.length > 1 && (
                    <Select aria-label="PC 네트워크 주소" value={String(lanIndex)} onChange={(e) => setLanIndex(Number(e.target.value))}>
                      {lanUrls.map((u, i) => (
                        <option key={u.url} value={i}>
                          {u.label}
                        </option>
                      ))}
                    </Select>
                  )}
                  <UrlRow url={lan.url} onCopy={props.onCopy} />
                  <p className="connect-note">
                    폰 카메라로 QR을 찍으세요. 열리지 않으면 PC와 폰이 같은 와이파이인지, PC 방화벽이 이 포트를 막지 않는지 확인하세요.
                  </p>
                </>
              ) : ready?.lanError ? (
                <p className="callout callout-warn">
                  <CircleAlert size={14} aria-hidden />
                  <span>{ready.lanError}</span>
                </p>
              ) : (
                <p className="connect-note">주소를 준비하는 중…</p>
              )}
              <details className="connect-more">
                <summary>접힘 상태와 기기 모델명까지 재려면</summary>
                <p>
                  와이파이 주소(http)는 보안 연결이 아니라 Device Posture API와 기기 모델명을 쓸 수 없습니다. USB 디버깅을 켜고 PC 크롬의{' '}
                  <code>chrome://inspect</code> → Port forwarding에 <code>4280 → localhost:4280</code>을 추가한 뒤, 폰에서 아래 &lsquo;이 PC&rsquo;
                  주소를 여세요.
                </p>
              </details>
            </div>
            <div className="connect-card">
              <div className="connect-title">
                <Laptop size={15} aria-hidden />
                Xcode 시뮬레이터 · 이 PC
              </div>
              {localUrl ? <UrlRow url={localUrl.url} onCopy={props.onCopy} /> : <p className="connect-note">주소를 준비하는 중…</p>}
              <p className="connect-note">맥에서 시뮬레이터의 사파리로 이 주소를 여세요. 시뮬레이터는 맥의 localhost에 바로 접속합니다.</p>
            </div>
          </section>

          <section className="measure-results">
            <div className="measure-results-head">
              <h3 className="measure-step">2. 측정값 {snapshots.length > 0 && <span className="count-pill">{snapshots.length}</span>}</h3>
              {snapshots.length > 0 && (
                <Button variant="ghost" size="sm" icon={Trash2} onClick={props.onClear}>
                  모두 지우기
                </Button>
              )}
            </div>
            {snapshots.length === 0 ? (
              <div className="empty-state measure-empty">
                <span className="empty-icon">
                  <span className="pulse-dot" />
                </span>
                <h3>측정값을 기다리는 중</h3>
                <p>기기에서 주소를 열면 바로 들어옵니다. 접거나 펴거나 돌릴 때마다 새 값이 추가됩니다.</p>
              </div>
            ) : (
              <>
                <ul className="snap-list">
                  {snapshots.map((s, i) => {
                    const ua = describeUa(s);
                    const on = s.id === selected?.id;
                    return (
                      <li key={s.id} className={`snap${on ? ' on' : ''}`}>
                        <button type="button" className="snap-main" onClick={() => setSelectedId(s.id)} aria-pressed={on}>
                          <span className="snap-title">
                            #{snapshots.length - i} · {Math.round(s.viewport.width)}×{Math.round(s.viewport.height)} · DPR {s.dpr}
                          </span>
                          <span className="snap-sub">
                            {timeText(s.at)} · {ua.text}
                          </span>
                          <span className="snap-meta">
                            안전 영역 {insetText(s.safeArea)} · 세그먼트 {s.segments.length > 1 ? s.segments.length : 1}개
                            {s.posture ? ` · ${s.posture}` : ''}
                          </span>
                        </button>
                        <div className="snap-actions">
                          {(['cover', 'main'] as const).map((role) => (
                            <button
                              key={role}
                              type="button"
                              className={`role-chip${roles[s.id] === role ? ' on' : ''}`}
                              aria-pressed={roles[s.id] === role}
                              onClick={() => {
                                const next = { ...roles };
                                // 같은 역할은 하나만 둔다
                                for (const k of Object.keys(next)) if (next[k] === role) delete next[k];
                                if (roles[s.id] !== role) next[s.id] = role;
                                setRoles(next);
                              }}
                            >
                              {roles[s.id] === role && <Check size={12} aria-hidden />}
                              {role === 'cover' ? '커버' : '메인'}
                            </button>
                          ))}
                          <IconButton icon={X} label="이 측정값 지우기" className="sm" onClick={() => props.onRemove(s.id)} />
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {selected && comparePosture && (
                  <div className="compare">
                    <div className="compare-head">
                      <span className="field-label">비교할 자세</span>
                      <Select aria-label="비교할 자세" value={comparePosture} onChange={(e) => setPostureId(e.target.value)}>
                        {device.postures.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                            {p.id === autoPosture ? ' (가장 비슷함)' : ''}
                          </option>
                        ))}
                      </Select>
                      <span className={`badge ${mismatches ? 'badge-warn' : 'badge-neutral'}`}>
                        {mismatches ? `다른 값 ${mismatches}개` : '모두 일치'}
                      </span>
                    </div>
                    <p className="compare-note">
                      {device.name} · {mode === 'browser' ? '브라우저 탭' : '앱·전체 화면'} · viewport-fit=cover 기준
                    </p>
                    <table className="compare-table">
                      <thead>
                        <tr>
                          <th>항목</th>
                          <th>카탈로그</th>
                          <th>실측</th>
                          <th aria-label="결과" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.label} className={r.ok === false ? 'bad' : ''}>
                            <td>{r.label}</td>
                            <td className="num">{r.expected}</td>
                            <td className="num">{r.actual}</td>
                            <td className="mark">{r.ok === null ? '—' : r.ok ? <Check size={14} aria-label="일치" /> : <X size={14} aria-label="다름" />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <footer className="modal-foot">
          <Button variant="ghost" icon={Download} onClick={exportJson} disabled={!snapshots.length}>
            JSON 저장
          </Button>
          <div className="spacer" />
          <Button variant="primary" icon={Wand2} onClick={prefill} disabled={!snapshots.length}>
            이 값으로 기기 만들기
          </Button>
        </footer>
      </div>
    </div>
  );
}

function UrlRow({ url, onCopy }: { url: string; onCopy: (text: string, what: string) => void }) {
  return (
    <div className="url-row">
      <code>{url}</code>
      <IconButton icon={Copy} label="주소 복사" className="sm" onClick={() => onCopy(url, '측정 페이지 주소')} />
    </div>
  );
}
