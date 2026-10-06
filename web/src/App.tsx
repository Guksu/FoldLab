import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  CircleAlert,
  CircleCheck,
  Columns2,
  FoldVertical,
  Globe,
  Info,
  LayoutGrid,
  MonitorSmartphone,
  Play,
  Plus,
  RotateCw,
  Ruler,
  ShieldCheck,
  Smartphone,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { DEFAULT_DEVICE_ID, DEVICES } from '../../shared/devices';
import { computeLayout, resolveFit } from '../../shared/geometry';
import type { CustomParams } from '../../shared/custom';
import type { MeasureSnapshot, MeasureUrl } from '../../shared/measure';
import type { CaptureResult, Engine, SessionState } from '../../shared/protocol';
import type { Analysis, DeviceKind, DeviceSpec, DisplayMode, FitPolicy } from '../../shared/types';
import { CustomDeviceDialog } from './components/CustomDeviceDialog';
import type { OverlayToggles } from './components/DeviceArt';
import { IssuePanel } from './components/IssuePanel';
import { LiveDevice } from './components/LiveDevice';
import { MeasureDialog } from './components/MeasureDialog';
import { SheetPage } from './components/SheetPage';
import { Button, IconButton, Logo, Segmented, Select, Switch, ToggleChip } from './components/ui';
import { MODE_LABEL, postureLabel } from './lib/format';
import { FoldLabClient, type ConnectionStatus } from './lib/session';
import { buildMarkdown, copyPng, downloadBlob, sheetFilename, svgToPng } from './lib/sheet';

const STORAGE_KEY = 'foldlab:v1';
const CUSTOM_KEY = 'foldlab:custom-devices';

const KIND_LABEL: Record<DeviceKind, string> = {
  book: '책처럼 펼치는 폴더블',
  flip: '플립',
  dual: '듀얼 스크린',
  trifold: '트라이폴드',
};

const KIND_SHORT: Record<DeviceKind, string> = {
  book: '책형 폴더블',
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

const OVERLAYS: [keyof OverlayToggles, string, LucideIcon][] = [
  ['zones', '접는 선·힌지', FoldVertical],
  ['safe', '안전 영역', ShieldCheck],
  ['issues', '문제 위치', CircleAlert],
  ['segments', '세그먼트', Columns2],
];

interface Saved {
  url?: string;
  deviceId?: string;
  postureId?: string;
  mode?: DisplayMode;
  fit?: FitPolicy;
  toggles?: OverlayToggles;
  debug?: boolean;
  /** 아이폰 기기를 그릴 엔진 */
  iosEngine?: Engine;
}

interface Toast {
  text: string;
  kind: 'success' | 'info' | 'error';
}

const TOAST_ICON: Record<Toast['kind'], LucideIcon> = {
  success: CircleCheck,
  info: Info,
  error: CircleAlert,
};

function loadSaved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function loadCustomDevices(): DeviceSpec[] {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as DeviceSpec[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveCustomDevices(list: DeviceSpec[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    /* 저장소를 못 쓰는 환경 */
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

export function App() {
  const saved = useMemo(loadSaved, []);
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const client = useMemo(() => new FoldLabClient(), []);
  const [conn, setConn] = useState<ConnectionStatus>('idle');
  const [browserVersion, setBrowserVersion] = useState('');
  const [webkitAvailable, setWebkitAvailable] = useState(false);
  const [iosEngine, setIosEngine] = useState<Engine>(saved.iosEngine ?? 'webkit');
  const [urlInput, setUrlInput] = useState(params.get('url') ?? saved.url ?? '');
  const [customDevices, setCustomDevices] = useState<DeviceSpec[]>(loadCustomDevices);
  const allDevices = useMemo(() => [...DEVICES, ...customDevices], [customDevices]);
  const [deviceId, setDeviceId] = useState(
    [params.get('device'), saved.deviceId].find((id) => id && allDevices.some((d) => d.id === id)) ?? DEFAULT_DEVICE_ID,
  );
  const device = allDevices.find((d) => d.id === deviceId) ?? DEVICES[0];
  const [customOpen, setCustomOpen] = useState(false);
  const [customInitial, setCustomInitial] = useState<CustomParams | undefined>(undefined);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [measureReady, setMeasureReady] = useState<{ urls: MeasureUrl[]; lanError?: string } | null>(null);
  const [snapshots, setSnapshots] = useState<MeasureSnapshot[]>([]);
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
  const [toast, setToast] = useState<Toast | null>(null);
  const sheetRef = useRef<SVGSVGElement>(null);
  const [stageRef, stage] = useElementSize<HTMLElement>();

  const validPosture = device.postures.some((p) => p.id === postureId) ? postureId : device.postures[1]?.id ?? device.postures[0].id;
  const activePosture = session?.postureId && session.deviceId === device.id ? session.postureId : validPosture;

  const toastTimer = useRef(0);
  const showToast = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    setToast({ text, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ url: urlInput, deviceId, postureId: validPosture, mode, fit, toggles, debug, iosEngine } satisfies Saved),
      );
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
  }, [urlInput, deviceId, validPosture, mode, fit, toggles, debug, iosEngine]);

  /** 아이폰 기기는 WebKit이 설치돼 있고 사용자가 고르면 사파리 엔진으로 그린다 */
  const engineFor = useCallback(
    (d: DeviceSpec, pref: Engine = iosEngine): Engine => (d.platform === 'ios' && webkitAvailable && pref === 'webkit' ? 'webkit' : 'chromium'),
    [iosEngine, webkitAvailable],
  );

  useEffect(() => {
    const offStatus = client.on('status', (st) => {
      setConn(st);
      // 서버 세션은 연결과 함께 사라지므로 화면도 초기 상태로 돌린다
      if (st === 'closed') {
        setSession(null);
        setAnalysis(null);
        setProgress(null);
        setMeasureReady(null);
      }
    });
    const offMsg = client.on('message', (m) => {
      switch (m.t) {
        case 'hello':
          setBrowserVersion(m.browser);
          setWebkitAvailable(!!m.engines?.webkit);
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
          showToast(`페이지 ${m.kind}: ${m.message}`, 'info');
          break;
        case 'measure-ready':
          setMeasureReady({ urls: m.urls, lanError: m.lanError });
          break;
        case 'measure-snapshot':
          setSnapshots((list) => [m.snapshot, ...list.filter((x) => x.id !== m.snapshot.id)].slice(0, 40));
          break;
        case 'error':
          setProgress(null);
          showToast(m.message, 'error');
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
      client.send({ t: 'open', url: target, device, postureId: validPosture, mode, fit, engine: engineFor(device) });
    },
    [client, device, validPosture, mode, fit, engineFor],
  );

  // ?url= 로 들어오면 바로 연다
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    if (params.get('url')) open(params.get('url')!);
  }, [open, params]);

  const configure = (next: { device?: DeviceSpec; postureId?: string; mode?: DisplayMode; fit?: FitPolicy; engine?: Engine }) => {
    if (session) client.send({ t: 'configure', ...next });
  };

  const changeDevice = (id: string, list = allDevices) => {
    if (id === '__custom') {
      setCustomOpen(true);
      return;
    }
    const next = list.find((d) => d.id === id);
    if (!next) return;
    const pid = next.postures.some((p) => p.id === validPosture) ? validPosture : next.postures[1]?.id ?? next.postures[0].id;
    setDeviceId(id);
    setPostureId(pid);
    setSheetPostures(next.postures.filter((p) => p.sheet).map((p) => p.id));
    setCapture(null);
    configure({ device: next, postureId: pid, engine: engineFor(next) });
  };

  const changeEngine = (e: Engine) => {
    setIosEngine(e);
    configure({ engine: engineFor(device, e) });
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
      showToast('먼저 주소를 열어 주세요.', 'error');
      return;
    }
    const ids = device.postures.filter((p) => sheetPostures.includes(p.id)).map((p) => p.id);
    if (!ids.length) {
      showToast('캡처할 자세를 하나 이상 고르세요.', 'error');
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
      showToast(`내보내기 실패: ${(err as Error).message}`, 'error');
    }
  };

  const copyMarkdown = async () => {
    if (!capture) return;
    try {
      await navigator.clipboard.writeText(buildMarkdown(capture, device));
      showToast('Markdown 요약을 복사했습니다.');
    } catch {
      showToast('클립보드에 접근할 수 없습니다.', 'error');
    }
  };

  // 아직 페이지를 열지 않았을 때 보여 줄 레이아웃(페이지 메타를 모르니 cover로 가정)
  const fallbackLayout = useMemo(
    () => computeLayout(device, validPosture, { mode, fit: resolveFit(device, mode, fit, 'cover') }),
    [device, validPosture, mode, fit],
  );
  const live = !!session && session.deviceId === device.id && session.url.startsWith('http');
  const layout = live && session ? session.layout : fallbackLayout;
  const liveAnalysis = analysis && session && analysis.postureId === session.postureId ? analysis : null;
  const numbering = useMemo(() => new Map((liveAnalysis?.issues ?? []).map((i, n) => [i.id, n + 1])), [liveAnalysis]);
  const groups = (Object.keys(KIND_LABEL) as DeviceKind[])
    .map((kind) => ({ kind, items: DEVICES.filter((d) => d.kind === kind) }))
    .filter((g) => g.items.length);
  const screenLabel = device.screens.find((s) => s.id === device.postures.find((p) => p.id === activePosture)?.screen)?.label;

  const addCustomDevice = (d: DeviceSpec) => {
    const list = [...customDevices.filter((c) => c.id !== d.id), d];
    setCustomDevices(list);
    saveCustomDevices(list);
    setCustomOpen(false);
    changeDevice(d.id, [...DEVICES, ...list]);
    showToast(`'${d.name}' 기기를 추가했습니다.`);
  };

  const removeCustomDevice = () => {
    if (device.status !== 'custom') return;
    const list = customDevices.filter((c) => c.id !== device.id);
    setCustomDevices(list);
    saveCustomDevices(list);
    changeDevice(DEFAULT_DEVICE_ID, [...DEVICES, ...list]);
    showToast(`'${device.name}' 기기를 삭제했습니다.`);
  };

  const openMeasure = () => {
    setMeasureOpen(true);
    client.send({ t: 'measure-start', lan: true });
  };

  const closeMeasure = () => {
    setMeasureOpen(false);
    client.send({ t: 'measure-stop' });
  };

  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${what}를 복사했습니다.`);
    } catch {
      showToast('클립보드에 접근할 수 없습니다.', 'error');
    }
  };

  const copyDeviceJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(device, null, 2));
      showToast('기기 정의 JSON을 복사했습니다. 팀원에게 공유해 가져오기로 추가할 수 있습니다.');
    } catch {
      showToast('클립보드에 접근할 수 없습니다.', 'error');
    }
  };

  const demoUrl = `${location.origin}/demo/trip`;
  const engineText =
    session?.engine === 'webkit'
      ? `WebKit ${session.engineVersion}`
      : browserVersion
        ? `Chromium ${browserVersion.split('.')[0]}`
        : '연결됨';
  const connText = conn === 'open' ? engineText : conn === 'closed' ? '서버 연결 끊김' : '연결 중';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          FoldLab
        </div>
        <span className="vsep" aria-hidden />
        <nav className="nav-tabs" role="tablist" aria-label="보기">
          <button type="button" role="tab" aria-selected={tab === 'live'} className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>
            <MonitorSmartphone size={15} aria-hidden />
            라이브
          </button>
          <button type="button" role="tab" aria-selected={tab === 'sheet'} className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>
            <LayoutGrid size={15} aria-hidden />
            비교 시트
            {capture && capture.deviceId === device.id && tab !== 'sheet' && <span className="tab-dot" aria-label="새 시트" />}
          </button>
        </nav>
        <form
          className="urlbar"
          onSubmit={(e) => {
            e.preventDefault();
            open(urlInput);
          }}
        >
          <div className="nav-group">
            <IconButton icon={ArrowLeft} label="뒤로" disabled={!session?.canGoBack} onClick={() => client.send({ t: 'history', dir: 'back' })} />
            <IconButton icon={ArrowRight} label="앞으로" disabled={!session?.canGoForward} onClick={() => client.send({ t: 'history', dir: 'forward' })} />
            <IconButton icon={RotateCw} label="새로고침" disabled={!live} onClick={() => client.send({ t: 'history', dir: 'reload' })} />
          </div>
          <div className="url-field">
            {session?.loading ? <span className="spinner" aria-label="불러오는 중" /> : <Globe size={15} aria-hidden />}
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com 또는 localhost:3000"
              aria-label="검사할 주소"
              spellCheck={false}
              autoCapitalize="off"
            />
            <Button type="submit" variant="primary" size="sm" disabled={!urlInput.trim()}>
              열기
            </Button>
          </div>
        </form>
        <div className={`conn ${conn}`} title={browserVersion ? `헤드리스 Chromium ${browserVersion}` : undefined}>
          <i aria-hidden />
          <span className="conn-text">{connText}</span>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <Select icon={Smartphone} className="device-select" aria-label="기기" value={deviceId} onChange={(e) => changeDevice(e.target.value)}>
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
            <optgroup label="직접 만든 기기">
              {customDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              <option value="__custom">＋ 기기 직접 만들기…</option>
            </optgroup>
          </Select>
          <span className="device-meta">
            {KIND_SHORT[device.kind]} · {device.platform === 'ios' ? 'iOS' : 'Android'}
          </span>
          {device.status === 'custom' && (
            <>
              <IconButton icon={Braces} label="기기 정의 JSON 복사" onClick={() => void copyDeviceJson()} />
              <IconButton icon={Trash2} label="이 기기 삭제" onClick={removeCustomDevice} />
            </>
          )}
        </div>
        <span className="vsep" aria-hidden />
        <div className="tool-group">
          <Segmented<DisplayMode>
            label="표시 방식"
            value={mode}
            onChange={changeMode}
            options={[
              { value: 'browser', label: MODE_LABEL.browser, hint: '주소창과 시스템 바가 있는 크롬·사파리 탭' },
              { value: 'app', label: MODE_LABEL.app, hint: 'PWA·웹뷰처럼 화면 전체를 쓰는 경우' },
            ]}
          />
        </div>
        {device.platform === 'ios' && (
          <>
            <span className="vsep" aria-hidden />
            <div className="tool-group">
              <span className="field-label">엔진</span>
              <Segmented<Engine>
                label="렌더링 엔진"
                value={engineFor(device)}
                onChange={changeEngine}
                options={[
                  { value: 'chromium', label: '크로미움', hint: '크로미움에 아이폰 화면 크기·UA·안전 영역만 흉내 냅니다' },
                  {
                    value: 'webkit',
                    label: 'WebKit',
                    hint: webkitAvailable
                      ? '사파리와 같은 WebKit 엔진으로 그립니다'
                      : 'WebKit이 설치되지 않았습니다. npx playwright install webkit 후 서버를 다시 켜 주세요',
                    disabled: !webkitAvailable,
                  },
                ]}
              />
            </div>
          </>
        )}
        <span className="vsep" aria-hidden />
        <label className="tool-group">
          <span className="field-label code">viewport-fit</span>
          <Select value={fit} onChange={(e) => changeFit(e.target.value as FitPolicy)}>
            <option value="page">페이지 설정 따름{session && fit === 'page' ? ` (${session.effectiveFit})` : ''}</option>
            <option value="cover">cover로 강제</option>
            <option value="auto">auto로 강제</option>
          </Select>
        </label>
        <div className="spacer" />
        <Button variant="ghost" size="sm" icon={Ruler} onClick={openMeasure}>
          실기기로 재기
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          onClick={() => {
            setCustomInitial(undefined);
            setCustomOpen(true);
          }}
        >
          기기 만들기
        </Button>
      </div>

      {tab === 'live' ? (
        <main className="workspace">
          <section className={`stage${live || session?.loading ? '' : ' idle'}`} ref={stageRef}>
            <div className="posture-bar" role="radiogroup" aria-label="자세">
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
              maxWidth={stage.w}
              maxHeight={stage.h}
              placeholder={session?.loading ? '불러오는 중…' : undefined}
            />
            {live ? (
              <div className="stage-dock">
                <Switch checked={debug} onChange={setDebug}>
                  디버그 표시
                </Switch>
                <span className="dock-sep" aria-hidden />
                {OVERLAYS.map(([key, label, Icon]) => (
                  <ToggleChip key={key} on={toggles[key]} icon={Icon} disabled={!debug} onClick={() => setToggles({ ...toggles, [key]: !toggles[key] })}>
                    {label}
                  </ToggleChip>
                ))}
                <span className="dock-sep readout-sep" aria-hidden />
                <span className="readout" title={screenLabel}>
                  {layout.viewport.w}×{layout.viewport.h} · DPR {layout.dpr}
                </span>
              </div>
            ) : (
              !session?.loading && (
                <div className="welcome">
                  <span className="welcome-icon">
                    <MonitorSmartphone size={18} aria-hidden />
                  </span>
                  <div>
                    <h1>주소를 열면 이 기기 화면 그대로 보여 드려요</h1>
                    <p>
                      접힘·펼침·반 접힘·화면 분할 자세를 실제 브라우저 엔진으로 재현하고, 접는 선·카메라 홀·시스템 바에 걸린 요소를 찾아 줍니다.
                    </p>
                    <div className="welcome-actions">
                      <Button variant="primary" size="sm" icon={Play} onClick={() => open(demoUrl)}>
                        데모 페이지로 체험하기
                      </Button>
                      <span className="muted">
                        {screenLabel} · {postureLabel(device, activePosture)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            )}
          </section>
          <IssuePanel
            analysis={liveAnalysis}
            layout={live ? layout : null}
            support={session?.support ?? null}
            engine={session?.engine ?? 'chromium'}
            engineVersion={session?.engineVersion ?? ''}
            selectedId={selectedId}
            numbering={numbering}
            postureName={postureLabel(device, activePosture)}
            onSelect={setSelectedId}
            onReveal={(ref) => client.send({ t: 'reveal', ref })}
            onReanalyze={() => client.send({ t: 'analyze' })}
            live={live}
          />
        </main>
      ) : (
        <SheetPage
          device={device}
          live={live}
          selected={sheetPostures}
          onSelectedChange={setSheetPostures}
          progress={progress}
          capture={capture}
          debug={sheetDebug}
          onDebugChange={setSheetDebug}
          toggles={toggles}
          sheetRef={sheetRef}
          onCapture={startCapture}
          onExportPng={(copy) => void exportPng(copy)}
          onCopyMarkdown={() => void copyMarkdown()}
          onGoLive={() => setTab('live')}
        />
      )}
      {customOpen && <CustomDeviceDialog initial={customInitial} onSave={addCustomDevice} onClose={() => setCustomOpen(false)} />}
      {measureOpen && (
        <MeasureDialog
          conn={conn}
          ready={measureReady}
          snapshots={snapshots}
          device={device}
          onRetry={() => client.send({ t: 'measure-start', lan: true })}
          onRemove={(id) => setSnapshots((list) => list.filter((x) => x.id !== id))}
          onClear={() => setSnapshots([])}
          onCopy={(text, what) => void copyText(text, what)}
          onPrefill={(params) => {
            closeMeasure();
            setCustomInitial(params);
            setCustomOpen(true);
          }}
          onClose={closeMeasure}
        />
      )}
      {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = TOAST_ICON[toast.kind];
  return (
    <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} onClick={onClose}>
      <Icon size={16} aria-hidden />
      <span>{toast.text}</span>
    </div>
  );
}
