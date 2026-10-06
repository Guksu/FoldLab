import type { Page } from 'playwright';
import type { AnalyzeInput, AnalyzeOutput, ContinuityFinding } from '../inpage/analyze';
import { computeLayout, findPosture, parseViewportFit, resolveFit } from '../shared/geometry';
import type { CaptureItem, CaptureResult, Engine, FrameHeader, ServerMessage, SessionState } from '../shared/protocol';
import { RULES } from '../shared/rules';
import type { Analysis, DeviceSpec, DisplayMode, FitPolicy, Issue, Layout, Severity, ViewportFit } from '../shared/types';
import { webkitInstalled } from './browser';
import { config } from './config';
import { ChromiumDriver } from './engines/chromium';
import type { DriverHooks, EngineDriver, TouchPhase } from './engines/types';
import { WebKitDriver } from './engines/webkit';
import { normalizeUrl, resolvesToPrivate } from './guard';

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
  engine?: Engine;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** WebKit이 없는 서버면 크로미움으로 그린다(UI는 서버 정보를 받기 전에도 고른 엔진을 보낸다) */
function usableEngine(engine: Engine): Engine {
  return engine === 'webkit' && !webkitInstalled() ? 'chromium' : engine;
}

/**
 * 웹소켓 연결 하나에 대응하는 헤드리스 페이지.
 * 엔진마다 다른 부분(에뮬레이션·화면 프레임·입력·캡처)은 드라이버가 맡고,
 * 여기서는 분석·자세 전환 연속성·비교 시트·상태 전송 같은 공통 흐름을 맡는다.
 */
export class LiveSession {
  private driver: EngineDriver;
  private device: DeviceSpec;
  private postureId: string;
  private mode: DisplayMode;
  private fit: FitPolicy;
  private pageFit: ViewportFit = 'auto';
  private layout!: Layout;
  private loading = false;
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
    private readonly sink: SessionSink,
    opts: SessionOptions,
  ) {
    this.device = opts.device;
    this.postureId = findPosture(opts.device, opts.postureId).id;
    this.mode = opts.mode;
    this.fit = opts.fit;
    this.driver = this.createDriver(usableEngine(opts.engine ?? 'chromium'));
  }

  get busy(): boolean {
    return this.capturing;
  }

  get engine(): Engine {
    return this.driver.engine;
  }

  private get page(): Page {
    return this.driver.page;
  }

  private createDriver(engine: Engine): EngineDriver {
    const hooks: DriverHooks = {
      attach: (page) => this.attach(page),
      frame: (meta, jpeg) =>
        new Promise<void>((resolve) => {
          if (this.closed) return resolve();
          this.sink.frame({ ...meta, seq: ++this.seq }, jpeg, resolve);
          // 화면이 바뀌었으니 조용해지면 다시 분석한다
          if (!this.touching) this.scheduleAnalyze(900, 4000);
        }),
    };
    return engine === 'webkit' ? new WebKitDriver(hooks) : new ChromiumDriver(hooks);
  }

  /** 드라이버가 만든 페이지에 이벤트를 붙인다. WebKit은 기기를 바꾸면 페이지를 새로 만들어 다시 불린다. */
  private attach(page: Page): void {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame() || page !== this.page) return;
      if (!this.capturing) this.continuity = null;
      this.driver.documentChanged(frame.url());
      void this.pushState();
    });
    page.on('domcontentloaded', () => void this.onDocumentReady());
    page.on('load', () => {
      void this.onDocumentReady();
      this.scheduleAnalyze(400);
    });
    page.on('dialog', (d) => {
      this.sink.json({ t: 'dialog', kind: d.type(), message: d.message() });
      // confirm은 취소로 돌려 의도치 않은 동작(삭제 등)을 막는다
      void (d.type() === 'alert' || d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {});
    });
    page.on('popup', (popup) => void this.adoptPopup(popup));
    page.on('crash', () => this.sink.json({ t: 'error', message: '페이지가 비정상 종료됐습니다. 다시 열어 주세요.' }));
  }

  private computeLayout(): Layout {
    return computeLayout(this.device, this.postureId, { mode: this.mode, fit: this.effectiveFit() });
  }

  async start(): Promise<void> {
    this.layout = this.computeLayout();
    await this.startDriver();
    await this.pushState();
  }

  /** 드라이버를 띄운다. WebKit을 띄우지 못하면 크로미움으로 대신 그리고 이유를 알린다. */
  private async startDriver(): Promise<void> {
    try {
      await this.driver.start(this.device, this.layout);
    } catch (err) {
      if (this.driver.engine === 'chromium' || this.closed) throw err;
      await this.driver.close().catch(() => {});
      this.sink.json({ t: 'error', message: `WebKit 대신 크로미움으로 그립니다. ${String((err as Error)?.message ?? err)}` });
      this.driver = this.createDriver('chromium');
      await this.driver.start(this.device, this.layout);
    }
  }

  // ---------- 설정 ----------

  async configure(next: { device?: DeviceSpec; postureId?: string; mode?: DisplayMode; fit?: FitPolicy; engine?: Engine }): Promise<void> {
    const platformChanged = !!next.device && next.device.platform !== this.device.platform;
    const from = this.postureId;
    const sameDevice = !next.device || next.device.id === this.device.id;
    if (next.device) this.device = next.device;
    if (next.postureId || next.device) this.postureId = findPosture(this.device, next.postureId ?? this.postureId).id;
    if (next.mode) this.mode = next.mode;
    if (next.fit) this.fit = next.fit;
    const engine = next.engine && usableEngine(next.engine);
    if (engine && engine !== this.driver.engine) {
      await this.switchEngine(engine);
      return;
    }
    // 같은 기기에서 자세만 바꾸면 실제 기기처럼 상태가 이어지는지 함께 본다
    const transition = sameDevice && from !== this.postureId ? await this.beginTransition() : null;
    const reopened = await this.applyEmulation();
    await this.pushState();
    if (transition && !reopened) {
      await this.settle();
      const issues = await this.endTransition(transition, from, this.postureId);
      this.continuity = { postureId: this.postureId, issues };
    } else if (!sameDevice) {
      this.continuity = null;
    }
    if (platformChanged && !reopened && this.page.url().startsWith('http')) {
      // UA가 크게 바뀌면 서버 렌더링 결과도 달라질 수 있어 새로 불러온다
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    this.scheduleAnalyze(350);
  }

  /** 엔진을 바꾼다: 새 엔진으로 페이지를 다시 만들고 같은 주소를 연다(페이지 상태는 이어지지 않는다) */
  private async switchEngine(engine: Engine): Promise<void> {
    const url = this.page?.url() ?? '';
    const old = this.driver;
    this.driver = this.createDriver(engine);
    this.continuity = null;
    this.pageFit = 'auto';
    await old.close().catch(() => {});
    this.layout = this.computeLayout();
    await this.startDriver();
    await this.pushState();
    if (url.startsWith('http')) await this.navigate(url);
  }

  private effectiveFit(): ViewportFit {
    return resolveFit(this.device, this.mode, this.fit, this.pageFit);
  }

  /** 레이아웃을 드라이버에 건다. WebKit이 페이지를 새로 만들었으면 보던 주소를 다시 열고 true를 돌려준다. */
  private async applyEmulation(): Promise<boolean> {
    const url = this.page?.url() ?? '';
    this.layout = this.computeLayout();
    const result = await this.driver.apply(this.device, this.layout);
    if (result === 'reopened' && url.startsWith('http')) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
      return true;
    }
    return result === 'reopened';
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
    this.driver.noteHistory(dir);
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
    const content = await this.driver
      .evaluate<string>(`(document.querySelector('meta[name="viewport" i]') || {}).content || ''`)
      .catch(() => undefined);
    const fit = parseViewportFit(content);
    if (fit !== this.pageFit) {
      this.pageFit = fit;
      if (this.fit === 'page') {
        await this.applyEmulation();
        await this.pushState();
      }
    }
  }

  // ---------- 입력 ----------

  async touch(phase: TouchPhase, x: number, y: number): Promise<void> {
    if (this.capturing) return;
    this.lastActive = Date.now();
    this.touching = phase === 'start' || phase === 'move';
    await this.driver.touch(phase, x, y);
    if (!this.touching) this.scheduleAnalyze(900);
  }

  async wheel(x: number, y: number, dx: number, dy: number): Promise<void> {
    if (this.capturing) return;
    this.lastActive = Date.now();
    await this.driver.wheel(x, y, dx, dy);
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
        if (!/context|Target closed|navigat|destroyed/i.test(msg)) console.warn('[foldlab] 분석 실패:', msg);
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

  async analyze(): Promise<Analysis | null> {
    if (!this.page.url().startsWith('http')) return null;
    const t0 = Date.now();
    const usage = await this.driver
      .evaluate<{ segments: boolean; posture: boolean } | null>('globalThis.__foldlabApiUsage ? { ...globalThis.__foldlabApiUsage } : null')
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
      // WebKit(사파리)은 화면 분할 API가 없어 세그먼트를 흉내 내지 않는다
      twoSegments: !!L.displayFeature && this.driver.engine === 'chromium',
      rawInsets: L.rawInsets,
      apiUsage: usage ?? undefined,
      chinRisk: L.mode === 'browser' && this.device.platform === 'android' && L.maxInsets.bottom > 0 && L.insets.bottom === 0,
    };
    const out = await this.driver.evaluateTool<AnalyzeOutput>(`__foldlab.analyze(${JSON.stringify(input)})`);
    const counts: Record<Severity, number> = { high: 0, warn: 0, info: 0 };
    for (const i of out.issues) counts[i.severity]++;
    return this.withContinuity({ postureId: L.postureId, issues: out.issues, counts, env: out.env, at: Date.now(), ms: Date.now() - t0 });
  }

  async reveal(ref: number): Promise<void> {
    await this.driver.evaluateTool<boolean>(`__foldlab.reveal(${Number(ref)})`).catch(() => false);
    this.scheduleAnalyze(450);
  }

  // ---------- 자세 전환 연속성 ----------

  /** 자세를 바꾸기 직전: 메인 월드에 표식을 남기고 입력값·보던 위치·재생 상태를 기록한다 */
  private async beginTransition(): Promise<{ nonce: string; url: string } | null> {
    const url = this.page.url();
    if (!url.startsWith('http') || this.loading) return null;
    const nonce = Math.random().toString(36).slice(2);
    const ok = await this.driver
      .evaluate<boolean>(
        `Object.defineProperty(window, '__foldlabSentinel', { value: '${nonce}', configurable: true, enumerable: false }) && true`,
      )
      .catch(() => false);
    if (!ok) return null;
    await this.driver.evaluateTool<boolean>('__foldlab.snapshot()').catch(() => false);
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
    const sentinel = await this.driver.evaluate<string | undefined>('window.__foldlabSentinel').catch(() => undefined);
    const url = this.page.url();
    if (sentinel !== t.nonce || url !== t.url) {
      const detail =
        url !== t.url ? `자세를 바꾸자 다른 주소(${url})로 이동했습니다.` : '자세를 바꾸자 페이지를 새로 불러와 상태가 모두 초기화됐습니다.';
      return [mk({ severity: 'high', detail }, 0)];
    }
    const findings = await this.driver.evaluateTool<ContinuityFinding[] | null>('__foldlab.compareSnapshot()').catch(() => null);
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
        const reopened = await this.applyEmulation();
        await this.pushState();
        await this.settle();
        this.continuity =
          transition && !reopened ? { postureId: ids[i], issues: await this.endTransition(transition, from, ids[i]) } : null;
        const analysis = await this.analyze();
        const shot = await this.driver.screenshot(this.layout);
        if (analysis) items.push({ postureId: ids[i], layout: this.layout, image: shot.image, imageScale: shot.scale, analysis });
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
    await this.driver
      .evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
      .catch(() => {});
    await sleep(350);
  }

  // ---------- 상태 ----------

  async pushState(): Promise<void> {
    if (this.closed || !this.layout) return;
    const nav = await this.driver.navigationState().catch(() => ({ canGoBack: false, canGoForward: false }));
    const state: SessionState = {
      engine: this.driver.engine,
      engineVersion: this.driver.version,
      url: this.page?.url() ?? 'about:blank',
      title: (await this.page?.title().catch(() => '')) ?? '',
      loading: this.loading,
      canGoBack: nav.canGoBack,
      canGoForward: nav.canGoForward,
      deviceId: this.device.id,
      postureId: this.postureId,
      mode: this.mode,
      fit: this.fit,
      effectiveFit: this.effectiveFit(),
      layout: this.layout,
      support: { ...this.driver.support },
    };
    this.sink.json({ t: 'state', state });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.analyzeTimer) clearTimeout(this.analyzeTimer);
    await this.driver.close();
  }
}
