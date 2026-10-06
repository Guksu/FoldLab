import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_DEVICE_ID, DEVICES } from '../../shared/devices';
import { computeLayout } from '../../shared/geometry';
import type { CaptureResult, SessionState } from '../../shared/protocol';
import type { Analysis, DeviceKind, DeviceSpec, DisplayMode, FitPolicy } from '../../shared/types';
import { IssuePanel } from './components/IssuePanel';
import { LiveDevice } from './components/LiveDevice';
import { SheetView } from './components/SheetView';
import type { OverlayToggles } from './components/DeviceArt';
import { MODE_LABEL, postureLabel } from './lib/format';
import { FoldLabClient, type ConnectionStatus } from './lib/session';
import { buildMarkdown, copyPng, downloadBlob, sheetFilename, svgToPng } from './lib/sheet';

const STORAGE_KEY = 'foldlab:v1';

const KIND_LABEL: Record<DeviceKind, string> = {
  book: '책처럼 펼치는 폴더블',
  flip: '플립',
  dual: '듀얼 스크린',
  trifold: '트라이폴드',
};

const STATUS_LABEL: Record<DeviceSpec['status'], string> = {
  released: '',
  announced: ' (발표)',
  rumored: ' (루머 기반 추정)',
  custom: ' (사용자 정의)',
};

interface Saved {
  url?: string;
  deviceId?: string;
  postureId?: string;
  mode?: DisplayMode;
  fit?: FitPolicy;
  toggles?: OverlayToggles;
  debug?: boolean;
}

function loadSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <rect x="2" y="4" width="10" height="18" rx="2.5" fill="#1f2329" />
      <rect x="14" y="4" width="10" height="18" rx="2.5" fill="#e5484d" />
      <rect x="12" y="6" width="2" height="14" fill="#f08c00" />
    </svg>
  );
}

export function App() {
  const saved = useMemo(loadSaved, []);
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const client = useMemo(() => new FoldLabClient(), []);
  const [conn, setConn] = useState<ConnectionStatus>('idle');
  const [browserVersion, setBrowserVersion] = useState('');
  const [urlInput, setUrlInput] = useState(params.get('url') ?? saved.url ?? '');
  const [deviceId, setDeviceId] = useState(
    [params.get('device'), saved.deviceId].find((id) => id && DEVICES.some((d) => d.id === id)) ?? DEFAULT_DEVICE_ID,
  );
  const device = DEVICES.find((d) => d.id === deviceId) ?? DEVICES[0];
  const [postureId, setPostureId] = useState(params.get('posture') ?? saved.postureId ?? 'unfolded');
  const [mode, setMode] = useState<DisplayMode>((params.get('mode') as DisplayMode) ?? saved.mode ?? 'app');
  const [fit, setFit] = useState<FitPolicy>(saved.fit ?? 'page');
  const [session, setSession] = useState<SessionState | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [debug, setDebug] = useState(saved.debug ?? true);
  const [toggles, setToggles] = useState<OverlayToggles>(saved.toggles ?? { zones: true, safe: true, issues: true, segments: true });
  const [tab, setTab] = useState<'live' | 'sheet'>('live');
  const [sheetPostures, setSheetPostures] = useState<string[]>(() => device.postures.filter((p) => p.sheet).map((p) => p.id));
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; postureId: string } | null>(null);
  const [sheetDebug, setSheetDebug] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const sheetRef = useRef<SVGSVGElement>(null);
  const [stageRef, stage] = useElementSize<HTMLDivElement>();

  const validPosture = device.postures.some((p) => p.id === postureId) ? postureId : device.postures[1]?.id ?? device.postures[0].id;
  const activePosture = session?.postureId && session.deviceId === device.id ? session.postureId : validPosture;

  const toastTimer = useRef(0);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: urlInput, deviceId, postureId: validPosture, mode, fit, toggles, debug } satisfies Saved));
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, [urlInput, deviceId, validPosture, mode, fit, toggles, debug]);

  useEffect(() => {
    const offStatus = client.on('status', setConn);
    const offMsg = client.on('message', (m) => {
      switch (m.t) {
        case 'hello':
          setBrowserVersion(m.browser);
          break;
        case 'state':
          setSession(m.state);
          break;
        case 'analysis':
          setAnalysis(m.analysis);
          break;
        case 'capture-progress':
          setProgress({ done: m.done, total: m.total, postureId: m.postureId });
          break;
        case 'capture':
          setProgress(null);
          setCapture(m.result);
          break;
        case 'dialog':
          showToast(`페이지 ${m.kind}: ${m.message}`);
          break;
        case 'error':
          setProgress(null);
          showToast(m.message);
          break;
      }
    });
    client.connect();
    return () => {
      offStatus();
      offMsg();
    };
  }, [client, showToast]);

  useEffect(() => {
    setSelectedId(null);
  }, [activePosture, deviceId]);

  const open = useCallback(
    (url: string) => {
      const target = url.trim();
      if (!target) return;
      setUrlInput(target);
      setAnalysis(null);
      client.send({ t: 'open', url: target, device, postureId: validPosture, mode, fit });
    },
    [client, device, validPosture, mode, fit],
  );

  // ?url= 로 들어오면 바로 연다
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    if (params.get('url')) open(params.get('url')!);
  }, [open, params]);

  const configure = (next: { device?: DeviceSpec; postureId?: string; mode?: DisplayMode; fit?: FitPolicy }) => {
    if (session) client.send({ t: 'configure', ...next });
  };

  const changeDevice = (id: string) => {
    const next = DEVICES.find((d) => d.id === id);
    if (!next) return;
    const pid = next.postures.some((p) => p.id === validPosture) ? validPosture : next.postures[1]?.id ?? next.postures[0].id;
    setDeviceId(id);
    setPostureId(pid);
    setSheetPostures(next.postures.filter((p) => p.sheet).map((p) => p.id));
    setCapture(null);
    configure({ device: next, postureId: pid });
  };

  const changePosture = (id: string) => {
    setPostureId(id);
    configure({ postureId: id });
  };

  const changeMode = (m: DisplayMode) => {
    setMode(m);
    configure({ mode: m });
  };

  const changeFit = (f: FitPolicy) => {
    setFit(f);
    configure({ fit: f });
  };

  const startCapture = () => {
    if (!session) {
      showToast('먼저 주소를 열어 주세요.');
      return;
    }
    const ids = device.postures.filter((p) => sheetPostures.includes(p.id)).map((p) => p.id);
    if (!ids.length) {
      showToast('캡처할 자세를 하나 이상 고르세요.');
      return;
    }
    setProgress({ done: 0, total: ids.length, postureId: ids[0] });
    client.send({ t: 'capture', postureIds: ids });
  };

  const exportPng = async (copy: boolean) => {
    if (!sheetRef.current || !capture) return;
    try {
      const blob = await svgToPng(sheetRef.current, 2);
      if (copy) {
        await copyPng(blob);
        showToast('이미지를 클립보드에 복사했습니다. PR이나 Jira에 붙여 넣으세요.');
      } else {
        downloadBlob(blob, sheetFilename(capture, device, sheetDebug));
      }
    } catch (err) {
      showToast(`내보내기 실패: ${(err as Error).message}`);
    }
  };

  const copyMarkdown = async () => {
    if (!capture) return;
    try {
      await navigator.clipboard.writeText(buildMarkdown(capture, device));
      showToast('Markdown 요약을 복사했습니다.');
    } catch {
      showToast('클립보드에 접근할 수 없습니다.');
    }
  };

  const fallbackLayout = useMemo(
    () => computeLayout(device, validPosture, { mode, fit: fit === 'cover' ? 'cover' : fit === 'auto' ? 'auto' : mode === 'app' ? 'cover' : 'auto' }),
    [device, validPosture, mode, fit],
  );
  const live = !!session && session.deviceId === device.id && session.url.startsWith('http');
  const layout = live && session ? session.layout : fallbackLayout;
  const liveAnalysis = analysis && session && analysis.postureId === session.postureId ? analysis : null;
  const numbering = useMemo(() => new Map((liveAnalysis?.issues ?? []).map((i, n) => [i.id, n + 1])), [liveAnalysis]);
  const groups = (Object.keys(KIND_LABEL) as DeviceKind[])
    .map((kind) => ({ kind, items: DEVICES.filter((d) => d.kind === kind) }))
    .filter((g) => g.items.length);

  const demoUrl = `${location.origin}/demo/trip`;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <div>
            <b>FoldLab</b>
            <span>폴더블·듀얼 스크린 화면 디버거</span>
          </div>
        </div>
        <form
          className="urlbar"
          onSubmit={(e) => {
            e.preventDefault();
            open(urlInput);
          }}
        >
          <div className="nav-buttons">
            <button type="button" className="icon" title="뒤로" disabled={!session?.canGoBack} onClick={() => client.send({ t: 'history', dir: 'back' })}>
              ←
            </button>
            <button type="button" className="icon" title="앞으로" disabled={!session?.canGoForward} onClick={() => client.send({ t: 'history', dir: 'forward' })}>
              →
            </button>
            <button type="button" className="icon" title="새로고침" disabled={!live} onClick={() => client.send({ t: 'history', dir: 'reload' })}>
              ↻
            </button>
          </div>
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://example.com 또는 localhost:3000"
            aria-label="검사할 주소"
            spellCheck={false}
            autoCapitalize="off"
          />
          {session?.loading && <span className="spinner" aria-label="불러오는 중" />}
          <button type="submit" className="primary">
            열기
          </button>
        </form>
        <div className={`conn ${conn}`} title={browserVersion ? `Chromium ${browserVersion}` : undefined}>
          <i />
          {conn === 'open' ? (browserVersion ? `Chromium ${browserVersion.split('.')[0]}` : '연결됨') : conn === 'connecting' ? '연결 중' : '서버 연결 끊김'}
        </div>
      </header>

      <div className="controls">
        <label className="field">
          <span>기기</span>
          <select value={deviceId} onChange={(e) => changeDevice(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g.kind} label={KIND_LABEL[g.kind]}>
                {g.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {STATUS_LABEL[d.status]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="seg" role="radiogroup" aria-label="표시 방식">
          {(['browser', 'app'] as DisplayMode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => changeMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <label className="field">
          <span>viewport-fit</span>
          <select value={fit} onChange={(e) => changeFit(e.target.value as FitPolicy)}>
            <option value="page">페이지 설정 따름{session && fit === 'page' ? ` (${session.effectiveFit})` : ''}</option>
            <option value="cover">cover로 강제</option>
            <option value="auto">auto로 강제</option>
          </select>
        </label>
        <div className="spacer" />
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'live'} className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>
            라이브
          </button>
          <button type="button" role="tab" aria-selected={tab === 'sheet'} className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>
            비교 시트
          </button>
        </div>
      </div>

      {tab === 'live' ? (
        <main className="workspace">
          <section className="stage-col">
            <div className="postures" role="radiogroup" aria-label="자세">
              {device.postures.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={activePosture === p.id}
                  className={activePosture === p.id ? 'on' : ''}
                  title={p.hint}
                  onClick={() => changePosture(p.id)}
                  disabled={!!progress}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="stage" ref={stageRef}>
              <LiveDevice
                client={client}
                device={device}
                layout={layout}
                url={session?.url ?? urlInput}
                live={live}
                analysis={liveAnalysis}
                selectedId={selectedId}
                numbering={numbering}
                debug={debug}
                toggles={toggles}
                maxWidth={stage.w - 32}
                maxHeight={stage.h - 24}
                placeholder={session?.loading ? '불러오는 중…' : undefined}
              />
              {!live && (
                <div className="welcome">
                  <h1>주소를 넣으면 폴더블 화면 그대로 보여 드려요</h1>
                  <p>접힘·펼침·반 접힘·화면 분할 자세를 실제 크롬 엔진으로 재현하고, 접는 선·카메라 홀·시스템 바에 걸린 요소를 찾아 줍니다.</p>
                  <button type="button" className="primary" onClick={() => open(demoUrl)}>
                    데모 페이지로 체험하기
                  </button>
                </div>
              )}
            </div>
            <div className="toggles">
              <label className="switch">
                <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
                <span>디버그 표시</span>
              </label>
              {(
                [
                  ['zones', '접는 선·힌지'],
                  ['safe', '안전 영역'],
                  ['issues', '문제 위치'],
                  ['segments', '세그먼트'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className={`chip-toggle${debug ? '' : ' off'}`}>
                  <input type="checkbox" checked={toggles[key]} disabled={!debug} onChange={(e) => setToggles({ ...toggles, [key]: e.target.checked })} />
                  {label}
                </label>
              ))}
              <span className="muted small">{device.screens.find((s) => s.id === device.postures.find((p) => p.id === activePosture)?.screen)?.label}</span>
            </div>
          </section>
          <IssuePanel
            analysis={liveAnalysis}
            layout={live ? layout : null}
            support={session?.support ?? null}
            selectedId={selectedId}
            numbering={numbering}
            onSelect={setSelectedId}
            onReveal={(ref) => client.send({ t: 'reveal', ref })}
            onReanalyze={() => client.send({ t: 'analyze' })}
            live={live}
          />
        </main>
      ) : (
        <main className="sheet-page">
          <section className="sheet-intro">
            <span className="badge">비교 시트</span>
            <h1>여러 자세를 기기 프레임째 한 장으로 캡처합니다</h1>
            <p className="muted">
              고른 자세를 차례로 바꿔 가며 같은 페이지를 캡처하고 자세별 문제 수를 함께 적습니다. PNG나 Markdown으로 PR·Jira에 그대로 붙이면 됩니다.
              디버그 표시를 빼고 실제 화면만 찍을 수도 있습니다.
            </p>
          </section>
          <section className="sheet-controls">
            <div className="posture-checks">
              {device.postures.map((p) => (
                <label key={p.id} className="chip-toggle">
                  <input
                    type="checkbox"
                    checked={sheetPostures.includes(p.id)}
                    onChange={(e) =>
                      setSheetPostures(e.target.checked ? [...sheetPostures, p.id] : sheetPostures.filter((id) => id !== p.id))
                    }
                  />
                  {p.label}
                </label>
              ))}
            </div>
            <button type="button" className="primary" onClick={startCapture} disabled={!!progress || !live}>
              {progress ? `캡처 중 ${progress.done}/${progress.total}` : `${sheetPostures.length}개 자세 캡처`}
            </button>
            {!live && <span className="muted small">라이브 탭에서 주소를 먼저 여세요.</span>}
          </section>
          {progress && (
            <div className="progress">
              <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              <span>
                {postureLabel(device, progress.postureId)} 자세로 바꾸는 중… ({progress.done}/{progress.total})
              </span>
            </div>
          )}
          {capture && capture.deviceId === device.id ? (
            <section className="sheet-card">
              <div className="sheet-actions">
                <label className="switch">
                  <input type="checkbox" checked={sheetDebug} onChange={(e) => setSheetDebug(e.target.checked)} />
                  <span>디버그 표시</span>
                </label>
                <div className="spacer" />
                <button type="button" className="ghost" onClick={() => void exportPng(true)}>
                  이미지 복사
                </button>
                <button type="button" className="ghost" onClick={() => void copyMarkdown()}>
                  Markdown 복사
                </button>
                <button type="button" className="primary" onClick={() => void exportPng(false)}>
                  PNG 저장
                </button>
              </div>
              <div className="sheet-scroll">
                <SheetView ref={sheetRef} result={capture} device={device} debug={sheetDebug} toggles={toggles} />
              </div>
            </section>
          ) : (
            !progress && <p className="muted sheet-empty">아직 캡처한 시트가 없습니다.</p>
          )}
        </main>
      )}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}
