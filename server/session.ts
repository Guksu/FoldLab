import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import type { AnalyzeInput, AnalyzeOutput, ContinuityFinding } from '../inpage/analyze';
import { computeLayout, findPosture, findScreen, parseViewportFit, resolveFit, screenOrientation } from '../shared/geometry';
import type {
  CaptureItem,
  CaptureResult,
  EmulationSupport,
  FrameHeader,
  ServerMessage,
  SessionState,
} from '../shared/protocol';
import { RULES } from '../shared/rules';
import type { Analysis, DeviceSpec, DisplayMode, FitPolicy, Issue, Layout, Severity, ViewportFit } from '../shared/types';
import { config } from './config';
import { normalizeUrl, resolvesToPrivate } from './guard';
import { getAnalyzerSource, getHooksSource } from './inpage';

export interface SessionSink {
  json(msg: ServerMessage): void;
  /** done()을 부르면 다음 프레임을 받는다(전송 속도에 맞춘 흐름 제어) */
  frame(header: FrameHeader, jpeg: Buffer, done: () => void): void;
}

export interface SessionOptions {
  device: DeviceSpec;
  postureId: string;
  mode: DisplayMode;
  fit: FitPolicy;
}

/** 캡처 해상도: 뷰포트 CSS px의 2배 */
const CAPTURE_SCALE = 2;
const SCREENCAST_SCALE = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 웹소켓 연결 하나에 대응하는 헤드리스 페이지.
 * 기기 자세를 CDP 에뮬레이션(뷰포트·화면 분할·자세·안전 영역)으로 재현하고 화면을 스트리밍한다.
 */
export class LiveSession {
  private context!: BrowserContext;
  private page!: Page;
  private cdp!: CDPSession;
  private device: DeviceSpec;
  private postureId: string;
  private mode: DisplayMode;
  private fit: FitPolicy;
  private pageFit: ViewportFit = 'auto';
  private layout!: Layout;
  private support: EmulationSupport = { segments: 'none', posture: 'ok', safeArea: 'ok' };
  private worldId: number | null = null;
  private loading = false;
  private screencastKey = '';
  private uaKey = '';
  private seq = 0;
  private analyzeTimer: NodeJS.Timeout | null = null;
  private analyzeDeadline = 0;
  private analyzing: Promise<Analysis | null> | null = null;
  private reanalyze = false;
  private capturing = false;
  private closed = false;
  private touching = false;
  /** 마지막 자세 전환에서 발견한 연속성 문제(그 자세의 분석 결과에 함께 싣는다) */
  private continuity: { postureId: string; issues: Issue[] } | null = null;
  lastActive = Date.now();

  constructor(
    private readonly browser: Browser,
    private readonly sink: SessionSink,
    opts: SessionOptions,
  ) {
    this.device = opts.device;
    this.postureId = findPosture(opts.device, opts.postureId).id;
    this.mode = opts.mode;
    this.fit = opts.fit;
  }

  get busy(): boolean {
    return this.capturing;
  }

  async start(): Promise<void> {
    this.context = await this.browser.newContext({
      viewport: null,
      acceptDownloads: false,
      ignoreHTTPSErrors: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    if (!config.allowPrivateNetwork) {
      await this.context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if ((url.protocol === 'http:' || url.protocol === 'https:') && (await resolvesToPrivate(url.hostname))) {
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
    }
    this.page = await this.context.newPage();
    this.cdp = await this.context.newCDPSession(this.page);
    await this.cdp.send('Page.enable');
    const hooks = await getHooksSource();
    if (hooks) await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: hooks });
    // 새 문서의 navigator.devicePosture는 처음 만들어질 때 재정의 값을 무시하므로 문서 시작 때 미리 만들어 둔다.
    // 페이지의 API 사용 감지(hooks)에 걸리지 않게 격리된 월드에서 건드린다.
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'void (navigator.devicePosture && navigator.devicePosture.type);',
      worldName: 'foldlab-posture',
    } as never);
    await this.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    this.cdp.on('Page.screencastFrame', (f) => this.onFrame(f));
    this.page.on('framenavigated', (frame) => {
      if (frame !== this.page.mainFrame()) return;
      this.worldId = null;
      if (!this.capturing) this.continuity = null;
      void this.reapplyPosture();
      void this.pushState();
    });
    this.page.on('domcontentloaded', () => void this.onDocumentReady());
    this.page.on('load', () => {
      void this.onDocumentReady();
      this.scheduleAnalyze(400);
    });
    this.page.on('dialog', (d) => {
      this.sink.json({ t: 'dialog', kind: d.type(), message: d.message() });
      // confirm은 취소로 돌려 의도치 않은 동작(삭제 등)을 막는다
      void (d.type() === 'alert' || d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {});
    });
    this.page.on('popup', (popup) => void this.adoptPopup(popup));
    this.page.on('crash', () => this.sink.json({ t: 'error', message: '페이지가 비정상 종료됐습니다. 다시 열어 주세요.' }));

    await this.applyEmulation();
    await this.pushState();
  }

  // ---------- 설정 ----------

  async configure(next: { device?: DeviceSpec; postureId?: string; mode?: DisplayMode; fit?: FitPolicy }): Promise<void> {
    const platformChanged = !!next.device && next.device.platform !== this.device.platform;
    const from = this.postureId;
    const sameDevice = !next.device || next.device.id === this.device.id;
    if (next.device) this.device = next.device;
    if (next.postureId || next.device) this.postureId = findPosture(this.device, next.postureId ?? this.postureId).id;
    if (next.mode) this.mode = next.mode;
    if (next.fit) this.fit = next.fit;
    // 같은 기기에서 자세만 바꾸면 실제 기기처럼 상태가 이어지는지 함께 본다
    const transition = sameDevice && from !== this.postureId ? await this.beginTransition() : null;
    await this.applyEmulation();
    await this.pushState();
    if (transition) {
      await this.settle();
      const issues = await this.endTransition(transition, from, this.postureId);
      this.continuity = { postureId: this.postureId, issues };
    } else if (!sameDevice) {
      this.continuity = null;
    }
    if (platformChanged && this.page.url().startsWith('http')) {
      // UA가 크게 바뀌면 서버 렌더링 결과도 달라질 수 있어 새로 불러온다
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    this.scheduleAnalyze(350);
  }

  private effectiveFit(): ViewportFit {
    return resolveFit(this.device, this.mode, this.fit, this.pageFit);
  }

  /**
   * 크롬은 새 문서의 navigator.devicePosture에 재정의 값을 넘겨주지 않는다(CSS device-posture는 그대로).
   * 같은 값을 다시 걸면 무시되므로 지웠다가 다시 건다. 문서 시작 때 객체를 만들어 두었으니 페이지 스크립트보다 먼저 반영된다.
   */
  private async reapplyPosture(): Promise<void> {
    if (this.closed || !this.layout || this.support.posture !== 'ok') return;
    const type = this.layout.devicePosture;
    await this.cdp.send('Emulation.clearDevicePostureOverride' as never).catch(() => {});
    await this.cdp.send('Emulation.setDevicePostureOverride' as never, { posture: { type } } as never).catch(() => {});
  }

  private async applyEmulation(): Promise<void> {
    const layout = computeLayout(this.device, this.postureId, { mode: this.mode, fit: this.effectiveFit() });
    const widthChanged = !this.layout || this.layout.viewport.w !== layout.viewport.w;
    this.layout = layout;
    const vp = layout.viewport;
    const posture = findPosture(this.device, this.postureId);
    const screen = findScreen(this.device, posture.screen);

    const metrics: Record<string, unknown> = {
      width: vp.w,
      height: vp.h,
      deviceScaleFactor: layout.dpr,
      mobile: true,
      screenWidth: layout.screen.w,
      screenHeight: layout.screen.h,
      positionX: vp.x,
      positionY: vp.y,
      screenOrientation: screenOrientation(layout.rotation, screen.height >= screen.width),
    };
    // 화면 분할은 setDisplayFeaturesOverride가 아니라 이 (deprecated) 인자로만 반영된다.
    // 크롬 121~148은 이 호출 때마다 자세를 이 값으로 다시 밀어 넣으므로 자세도 함께 준다.
    if (layout.displayFeature) metrics.displayFeature = layout.displayFeature;
    metrics.devicePosture = { type: layout.devicePosture };
    await this.cdp.send('Emulation.setDeviceMetricsOverride', metrics as never);

    await this.applyUserAgent();
    if (widthChanged) await this.normalizePageScale();

    // JS(navigator.devicePosture)까지 바꾸려면 별도 명령이 필요하다. 크기 변경이 끝난 뒤에 건다.
    try {
      await this.cdp.send('Emulation.setDevicePostureOverride' as never, { posture: { type: layout.devicePosture } } as never);
      this.support.posture = 'ok';
    } catch {
      this.support.posture = 'unsupported';
    }

    // 값을 빼면 env()가 정의되지 않은 상태가 되므로 8개를 모두 넘긴다
    const ins = layout.insets;
    const max = layout.maxInsets;
    try {
      await this.cdp.send(
        'Emulation.setSafeAreaInsetsOverride' as never,
        {
          insets: {
            top: ins.top,
            topMax: Math.max(ins.top, max.top),
            right: ins.right,
            rightMax: Math.max(ins.right, max.right),
            bottom: ins.bottom,
            bottomMax: Math.max(ins.bottom, max.bottom),
            left: ins.left,
            leftMax: Math.max(ins.left, max.left),
          },
        } as never,
      );
      this.support.safeArea = 'ok';
    } catch {
      this.support.safeArea = 'unsupported';
    }

    await this.verifySegments();
    await this.ensureScreencast();
  }

  /**
   * 에뮬레이션 크기를 바꾸면 크롬이 이전 배율(줌)을 그대로 끌고 와 화면이 확대된 채 남는다(예: 1.74배).
   * 새 폭에서 처음 연 것과 같도록 페이지 배율을 viewport 메타의 초기 배율로 맞춘다.
   */
  private async normalizePageScale(): Promise<void> {
    if (!this.page.url().startsWith('http')) return;
    const vpW = this.layout.viewport.w;
    const res = await this.cdp
      .send('Runtime.evaluate', {
        expression: `(() => {
          const c = (document.querySelector('meta[name="viewport" i]') || {}).content || '';
          const m = /initial-scale\s*=\s*([\d.]+)/i.exec(c);
          if (m) return Math.min(10, Math.max(0.1, parseFloat(m[1])));
          if (/width\s*=\s*device-width/i.test(c)) return 1;
          return ${vpW} / Math.max(${vpW}, document.documentElement.clientWidth || 980);
        })()`,
        returnByValue: true,
      })
      .catch(() => null);
    const scale = Number(res?.result?.value);
    if (!scale || !Number.isFinite(scale)) return;
    await sleep(30);
    await this.cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale }).catch(() => {});
  }

  /** 화면 분할(세그먼트)이 실제로 페이지에 반영됐는지 확인한다. 안 되면 신형 CDP 명령으로 한 번 더 시도한다. */
  private async verifySegments(): Promise<void> {
    const want = this.layout.displayFeature ? 2 : 1;
    const count = async () =>
      (
        await this.cdp
          .send('Runtime.evaluate', {
            expression: 'window.viewport && window.viewport.segments ? window.viewport.segments.length : 1',
            returnByValue: true,
          })
          .catch(() => null)
      )?.result?.value as number | undefined;
    if (!this.layout.displayFeature) {
      await this.cdp.send('Emulation.clearDisplayFeaturesOverride' as never).catch(() => {});
      this.support.segments = 'none';
      return;
    }
    let n = await count();
    if (n !== want) {
      await this.cdp
        .send('Emulation.setDisplayFeaturesOverride' as never, { features: [this.layout.displayFeature] } as never)
        .catch(() => {});
      await sleep(30);
      n = await count();
    }
    this.support.segments = n === want ? 'ok' : 'unsupported';
  }

  private async applyUserAgent(): Promise<void> {
    const version = this.browser.version();
    const major = version.split('.')[0];
    // 크롬의 축소된 UA처럼 주 버전만 남긴다(예: 141.0.0.0)
    const ua = this.device.userAgent.replace(/\{chrome\}/g, `${major}.0.0.0`);
    const key = `${ua}|${this.device.uaModel ?? ''}`;
    if (key === this.uaKey) return;
    this.uaKey = key;
    const android = this.device.platform === 'android';
    await this.cdp.send('Emulation.setUserAgentOverride', {
      userAgent: ua,
      acceptLanguage: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      platform: android ? 'Linux armv81' : 'iPhone',
      ...(android
        ? {
            userAgentMetadata: {
              brands: [
                { brand: 'Chromium', version: major },
                { brand: 'Google Chrome', version: major },
                { brand: 'Not.A/Brand', version: '99' },
              ],
              fullVersion: version,
              platform: 'Android',
              platformVersion: this.device.platformVersion ?? '16.0.0',
              architecture: '',
              model: this.device.uaModel ?? '',
              mobile: true,
            },
          }
        : {}),
    });
  }

  // ---------- 화면 스트리밍 ----------

  private async ensureScreencast(): Promise<void> {
    const vp = this.layout.viewport;
    const key = `${vp.w}x${vp.h}`;
    if (key === this.screencastKey) return;
    if (this.screencastKey) await this.cdp.send('Page.stopScreencast').catch(() => {});
    this.screencastKey = key;
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 75,
      maxWidth: Math.round(vp.w * SCREENCAST_SCALE),
      maxHeight: Math.round(vp.h * SCREENCAST_SCALE),
      everyNthFrame: 1,
    });
  }

  private onFrame(f: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number; scrollOffsetX: number; scrollOffsetY: number; pageScaleFactor: number } }): void {
    const ack = () => {
      if (!this.closed) void this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    };
    if (this.closed) return;
    const m = f.metadata;
    this.sink.frame(
      {
        vw: m.deviceWidth,
        vh: m.deviceHeight,
        scrollX: m.scrollOffsetX,
        scrollY: m.scrollOffsetY,
        pageScale: m.pageScaleFactor,
        seq: ++this.seq,
      },
      Buffer.from(f.data, 'base64'),
      ack,
    );
    // 화면이 바뀌었으니 조용해지면 다시 분석한다
    if (!this.touching) this.scheduleAnalyze(900, 4000);
  }

  // ---------- 탐색 ----------

  async navigate(raw: string): Promise<void> {
    const url = normalizeUrl(raw);
    if (!config.allowPrivateNetwork && (await resolvesToPrivate(url.hostname))) {
      throw new Error('이 서버 설정에서는 localhost·사설망 주소를 열 수 없습니다(FOLDLAB_ALLOW_PRIVATE).');
    }
    this.loading = true;
    await this.pushState();
    try {
      await this.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch (err) {
      const msg = String((err as Error).message ?? err).split('\n')[0];
      this.sink.json({ t: 'error', message: `페이지를 열지 못했습니다: ${msg.replace(/^page\.goto:\s*/, '')}` });
    } finally {
      this.loading = false;
      await this.pushState();
      this.scheduleAnalyze(500);
    }
  }

  async history(dir: 'back' | 'forward' | 'reload'): Promise<void> {
    const opts = { waitUntil: 'domcontentloaded' as const, timeout: 30_000 };
    try {
      if (dir === 'back') await this.page.goBack(opts);
      else if (dir === 'forward') await this.page.goForward(opts);
      else await this.page.reload(opts);
    } catch (err) {
      this.sink.json({ t: 'error', message: String((err as Error).message).split('\n')[0] });
    }
    await this.pushState();
  }

  private async adoptPopup(popup: Page): Promise<void> {
    // 새 창(target=_blank)은 같은 화면에서 이어서 연다
    await popup.waitForURL((u) => u.href !== 'about:blank', { waitUntil: 'commit', timeout: 10_000 }).catch(() => {});
    const url = popup.url();
    await popup.close().catch(() => {});
    if (url && url !== 'about:blank') await this.navigate(url).catch((e) => this.sink.json({ t: 'error', message: String(e.message) }));
  }

  private async onDocumentReady(): Promise<void> {
    if (this.closed) return;
    const res = await this.cdp
      .send('Runtime.evaluate', {
        expression: `(document.querySelector('meta[name="viewport" i]') || {}).content || ''`,
        returnByValue: true,
      })
      .catch(() => null);
    const fit = parseViewportFit(res?.result?.value as string | undefined);
    if (fit !== this.pageFit) {
      this.pageFit = fit;
      if (this.fit === 'page') {
        await this.applyEmulation();
        await this.pushState();
      }
    }
  }

  // ---------- 입력 ----------

  async touch(phase: 'start' | 'move' | 'end' | 'cancel', x: number, y: number): Promise<void> {
    if (this.capturing) return;
    this.lastActive = Date.now();
    const type = { start: 'touchStart', move: 'touchMove', end: 'touchEnd', cancel: 'touchCancel' }[phase] as
      | 'touchStart'
      | 'touchMove'
      | 'touchEnd'
      | 'touchCancel';
    this.touching = phase === 'start' || phase === 'move';
    const touchPoints = phase === 'end' || phase === 'cancel' ? [] : [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    if (!this.touching) this.scheduleAnalyze(900);
  }

  async wheel(x: number, y: number, dx: number, dy: number): Promise<void> {
    if (this.capturing) return;
    this.lastActive = Date.now();
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
  }

  async key(phase: 'down' | 'up', key: string): Promise<void> {
    if (this.capturing) return;
    this.lastActive = Date.now();
    try {
      if (phase === 'down') await this.page.keyboard.down(key);
      else await this.page.keyboard.up(key);
    } catch {
      // Playwright가 모르는 키(Process, HangulMode 등)는 무시한다
    }
  }

  async text(text: string): Promise<void> {
    if (this.capturing || !text) return;
    this.lastActive = Date.now();
    await this.page.keyboard.insertText(text);
  }

  // ---------- 분석 ----------

  scheduleAnalyze(delay = 700, maxWait = 2500): void {
    if (this.capturing || this.closed) return;
    const now = Date.now();
    if (!this.analyzeTimer) this.analyzeDeadline = now + maxWait;
    else clearTimeout(this.analyzeTimer);
    const wait = Math.max(0, Math.min(delay, this.analyzeDeadline - now));
    this.analyzeTimer = setTimeout(() => {
      this.analyzeTimer = null;
      void this.runAnalysis();
    }, wait);
  }

  async runAnalysis(): Promise<Analysis | null> {
    if (this.analyzing) {
      this.reanalyze = true;
      return this.analyzing;
    }
    this.analyzing = this.analyze()
      .catch((err) => {
        const msg = String((err as Error).message ?? err);
        if (!/context|Target closed|navigat/i.test(msg)) console.warn('[foldlab] 분석 실패:', msg);
        return null;
      })
      .finally(() => {
        this.analyzing = null;
        if (this.reanalyze) {
          this.reanalyze = false;
          this.scheduleAnalyze(200);
        }
      });
    const result = await this.analyzing;
    if (result && !this.capturing) this.sink.json({ t: 'analysis', analysis: result });
    return result;
  }

  private async isolatedWorld(): Promise<number> {
    if (this.worldId !== null) return this.worldId;
    const tree = await this.cdp.send('Page.getFrameTree');
    const { executionContextId } = await this.cdp.send('Page.createIsolatedWorld', {
      frameId: tree.frameTree.frame.id,
      worldName: 'foldlab',
    });
    const loaded = await this.cdp.send('Runtime.evaluate', {
      expression: 'typeof __foldlab',
      contextId: executionContextId,
      returnByValue: true,
    });
    if (loaded.result.value !== 'object') {
      const src = await getAnalyzerSource();
      const r = await this.cdp.send('Runtime.evaluate', { expression: src, contextId: executionContextId });
      if (r.exceptionDetails) throw new Error('분석기 주입 실패: ' + r.exceptionDetails.text);
    }
    this.worldId = executionContextId;
    return executionContextId;
  }

  private async evalInWorld<T>(expression: string): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const contextId = await this.isolatedWorld();
      try {
        const r = await this.cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true });
        if (r.exceptionDetails) {
          throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        }
        return r.result.value as T;
      } catch (err) {
        if (attempt === 0 && /context|__foldlab is not defined/i.test(String((err as Error).message))) {
          this.worldId = null;
          continue;
        }
        throw err;
      }
    }
    throw new Error('unreachable');
  }

  async analyze(): Promise<Analysis | null> {
    if (!this.page.url().startsWith('http')) return null;
    const t0 = Date.now();
    const usage = await this.cdp
      .send('Runtime.evaluate', {
        expression: 'globalThis.__foldlabApiUsage ? { ...globalThis.__foldlabApiUsage } : null',
        returnByValue: true,
      })
      .then((r) => r.result.value as { segments: boolean; posture: boolean } | null)
      .catch(() => null);
    const L = this.layout;
    const input: AnalyzeInput = {
      postureId: L.postureId,
      viewport: { w: L.viewport.w, h: L.viewport.h },
      obstructions: L.obstructions,
      folds: L.folds,
      mode: L.mode,
      fit: L.fit,
      wide: L.wide,
      twoSegments: !!L.displayFeature,
      rawInsets: L.rawInsets,
      apiUsage: usage ?? undefined,
      chinRisk: L.mode === 'browser' && this.device.platform === 'android' && L.maxInsets.bottom > 0 && L.insets.bottom === 0,
    };
    const out = await this.evalInWorld<AnalyzeOutput>(`__foldlab.analyze(${JSON.stringify(input)})`);
    const counts: Record<Severity, number> = { high: 0, warn: 0, info: 0 };
    for (const i of out.issues) counts[i.severity]++;
    return this.withContinuity({ postureId: L.postureId, issues: out.issues, counts, env: out.env, at: Date.now(), ms: Date.now() - t0 });
  }

  async reveal(ref: number): Promise<void> {
    await this.evalInWorld<boolean>(`__foldlab.reveal(${Number(ref)})`).catch(() => false);
    this.scheduleAnalyze(450);
  }

  // ---------- 자세 전환 연속성 ----------

  /** 자세를 바꾸기 직전: 메인 월드에 표식을 남기고 입력값·보던 위치·재생 상태를 기록한다 */
  private async beginTransition(): Promise<{ nonce: string; url: string } | null> {
    const url = this.page.url();
    if (!url.startsWith('http') || this.loading) return null;
    const nonce = Math.random().toString(36).slice(2);
    const ok = await this.cdp
      .send('Runtime.evaluate', {
        expression: `Object.defineProperty(window, '__foldlabSentinel', { value: '${nonce}', configurable: true, enumerable: false }) && true`,
        returnByValue: true,
      })
      .then((r) => r.result.value === true)
      .catch(() => false);
    if (!ok) return null;
    await this.evalInWorld<boolean>('__foldlab.snapshot()').catch(() => false);
    return { nonce, url };
  }

  private async endTransition(t: { nonce: string; url: string }, from: string, to: string): Promise<Issue[]> {
    const label = (id: string) => findPosture(this.device, id).label;
    const prefix = `${label(from)} → ${label(to)}: `;
    const mk = (f: ContinuityFinding, i: number): Issue => ({
      id: `continuity:${from}>${to}:${i}`,
      rule: 'continuity',
      severity: f.severity,
      title: RULES.continuity.name,
      detail: prefix + f.detail,
      hint: RULES.continuity.hint,
      selector: f.selector,
      label: f.label,
      rects: f.rect ? [f.rect] : [],
      fixed: false,
      scroll: { x: 0, y: 0 },
    });
    const sentinel = await this.cdp
      .send('Runtime.evaluate', { expression: 'window.__foldlabSentinel', returnByValue: true })
      .then((r) => r.result.value as string | undefined)
      .catch(() => undefined);
    const url = this.page.url();
    if (sentinel !== t.nonce || url !== t.url) {
      const detail =
        url !== t.url ? `자세를 바꾸자 다른 주소(${url})로 이동했습니다.` : '자세를 바꾸자 페이지를 새로 불러와 상태가 모두 초기화됐습니다.';
      return [mk({ severity: 'high', detail }, 0)];
    }
    const findings = await this.evalInWorld<ContinuityFinding[] | null>('__foldlab.compareSnapshot()').catch(() => null);
    if (!findings) return [mk({ severity: 'high', detail: '자세를 바꾸자 문서가 새로 만들어졌습니다.' }, 0)];
    return findings.map(mk);
  }

  /** 분석 결과에 이 자세의 연속성 문제를 더한다 */
  private withContinuity(a: Analysis): Analysis {
    const c = this.continuity;
    if (!c || c.postureId !== a.postureId || !c.issues.length) return a;
    const issues = [...c.issues.filter((i) => i.severity === 'high'), ...a.issues, ...c.issues.filter((i) => i.severity !== 'high')];
    const order: Record<Severity, number> = { high: 0, warn: 1, info: 2 };
    issues.sort((x, y) => order[x.severity] - order[y.severity]);
    const counts: Record<Severity, number> = { high: 0, warn: 0, info: 0 };
    for (const i of issues) counts[i.severity]++;
    return { ...a, issues, counts };
  }

  // ---------- 비교 시트 ----------

  async capture(postureIds: string[], onProgress: (done: number, total: number, postureId: string) => void): Promise<CaptureResult> {
    if (this.capturing) throw new Error('이미 캡처 중입니다.');
    const ids = postureIds.filter((id) => this.device.postures.some((p) => p.id === id));
    if (!ids.length) throw new Error('캡처할 자세를 하나 이상 고르세요.');
    this.capturing = true;
    if (this.analyzeTimer) clearTimeout(this.analyzeTimer);
    this.analyzeTimer = null;
    if (this.analyzing) await this.analyzing;
    const original = this.postureId;
    const originalContinuity = this.continuity;
    const items: CaptureItem[] = [];
    try {
      for (let i = 0; i < ids.length; i++) {
        const from = this.postureId;
        const transition = from !== ids[i] ? await this.beginTransition() : null;
        this.postureId = ids[i];
        await this.applyEmulation();
        await this.pushState();
        await this.settle();
        this.continuity = transition ? { postureId: ids[i], issues: await this.endTransition(transition, from, ids[i]) } : null;
        const analysis = await this.analyze();
        const image = await this.screenshot();
        if (analysis) items.push({ postureId: ids[i], layout: this.layout, image, imageScale: CAPTURE_SCALE, analysis });
        onProgress(i + 1, ids.length, ids[i]);
      }
    } finally {
      this.postureId = original;
      this.continuity = originalContinuity;
      await this.applyEmulation().catch(() => {});
      this.capturing = false;
      await this.pushState().catch(() => {});
      this.scheduleAnalyze(300);
    }
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ''),
      deviceId: this.device.id,
      mode: this.mode,
      at: Date.now(),
      items,
    };
  }

  /** 자세를 바꾼 뒤 레이아웃·이미지가 자리 잡을 때까지 기다린다 */
  private async settle(): Promise<void> {
    await this.cdp
      .send('Runtime.evaluate', {
        expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))',
        awaitPromise: true,
      })
      .catch(() => {});
    await sleep(350);
  }

  private async screenshot(): Promise<string> {
    const m = await this.cdp.send('Page.getLayoutMetrics');
    const v = m.cssVisualViewport;
    const shot = await this.cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: {
        x: v.pageX,
        y: v.pageY,
        width: v.clientWidth,
        height: v.clientHeight,
        scale: (CAPTURE_SCALE * (v.scale || 1)) / this.layout.dpr,
      },
      captureBeyondViewport: false,
    });
    return `data:image/png;base64,${shot.data}`;
  }

  // ---------- 상태 ----------

  async pushState(): Promise<void> {
    if (this.closed) return;
    const hist = await this.cdp.send('Page.getNavigationHistory').catch(() => null);
    const state: SessionState = {
      url: this.page.url(),
      title: await this.page.title().catch(() => ''),
      loading: this.loading,
      canGoBack: !!hist && hist.currentIndex > 0 && hist.entries[hist.currentIndex - 1]?.url !== 'about:blank',
      canGoForward: !!hist && hist.currentIndex < hist.entries.length - 1,
      deviceId: this.device.id,
      postureId: this.postureId,
      mode: this.mode,
      fit: this.fit,
      effectiveFit: this.effectiveFit(),
      layout: this.layout,
      support: { ...this.support },
    };
    this.sink.json({ t: 'state', state });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.analyzeTimer) clearTimeout(this.analyzeTimer);
    await this.context?.close().catch(() => {});
  }
}
