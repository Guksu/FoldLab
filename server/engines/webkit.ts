import type { Browser, BrowserContext, Page, Route } from 'playwright';
import { rewriteSafeArea } from '../../inpage/safearea';
import type { EmulationSupport } from '../../shared/protocol';
import type { DeviceSpec, Insets, Layout } from '../../shared/types';
import { getWebKit } from '../browser';
import { blockIfPrivate } from '../guard';
import { getAnalyzerSource, getHooksSource, getSafeAreaShimSource } from '../inpage';
import type { DriverHooks, EngineDriver, TouchPhase } from './types';

const SCREENCAST_SCALE = 2;
/** 이만큼 움직이면 탭이 아니라 끌기(스크롤)로 본다 */
const DRAG_THRESHOLD = 6;

/**
 * WebKit(사파리 엔진): Playwright 기본 기능으로 아이폰 기기를 재현한다.
 * - 뷰포트 크기는 바로 바꾸지만, DPR·UA는 브라우저 컨텍스트 단위라 바뀌면 페이지를 새로 만든다.
 * - 안전 영역은 흉내 기능이 없어 페이지 CSS의 env(safe-area-inset-*)를 바꿔 넣는다(inpage/safearea.ts).
 * - 사파리는 화면 분할·자세 API가 없으므로 흉내 내지 않는다(실제 아이폰과 같다).
 * - CDP가 없으므로 분석기는 페이지 메인 월드에서 돈다.
 */
export class WebKitDriver implements EngineDriver {
  readonly engine = 'webkit' as const;
  page!: Page;
  support: EmulationSupport = { segments: 'none', posture: 'unsupported', safeArea: 'ok' };
  private browser!: Browser;
  private context: BrowserContext | null = null;
  private contextKey = '';
  private frameKey = '';
  private insetsKey = '';
  private scroll = { x: 0, y: 0, scale: 1, at: 0 };
  private drag: { x0: number; y0: number; x: number; y: number; t0: number; moved: boolean } | null = null;
  /** CDP처럼 방문 기록을 물어볼 수 없어 직접 센다 */
  private hist = { entries: [] as string[], index: -1, pending: null as 'back' | 'forward' | 'reload' | null };
  private closed = false;

  constructor(private readonly hooks: DriverHooks) {}

  get version(): string {
    return this.browser?.version() ?? '';
  }

  async start(device: DeviceSpec, layout: Layout): Promise<void> {
    this.browser = await getWebKit();
    await this.open(device, layout);
  }

  private keyOf(device: DeviceSpec, layout: Layout): string {
    return `${layout.dpr}|${device.userAgent}`;
  }

  /** 기기(DPR·UA)에 맞는 컨텍스트와 페이지를 새로 만든다 */
  private async open(device: DeviceSpec, layout: Layout): Promise<void> {
    await this.context?.close().catch(() => {});
    this.contextKey = this.keyOf(device, layout);
    const context = await this.browser.newContext({
      viewport: { width: layout.viewport.w, height: layout.viewport.h },
      screen: { width: layout.screen.w, height: layout.screen.h },
      deviceScaleFactor: layout.dpr,
      isMobile: true,
      hasTouch: true,
      userAgent: device.userAgent.replace(/\{chrome\}/g, '141.0.0.0'),
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      acceptDownloads: false,
      ignoreHTTPSErrors: true,
      // 분석기를 메인 월드에 넣어야 하므로 CSP 때문에 막히지 않게 한다
      bypassCSP: true,
    });
    this.context = context;
    await context.route('**/*', (route) => this.route(route));
    const hooks = await getHooksSource();
    if (hooks) await context.addInitScript({ content: hooks });
    await context.addInitScript({ content: await getSafeAreaShimSource() });
    this.insetsKey = '';
    await this.setInsets(layout.insets);
    this.page = await context.newPage();
    this.frameKey = '';
    this.hist = { entries: [], index: -1, pending: null };
    this.hooks.attach(this.page);
    await this.ensureFrames(layout);
  }

  /** 외부 CSS 파일도 안전 영역 식을 바꿔서 넘긴다(사설망 차단 설정도 여기서 함께 본다) */
  private async route(route: Route): Promise<void> {
    if (await blockIfPrivate(route)) return;
    if (route.request().resourceType() !== 'stylesheet') {
      await route.continue().catch(() => {});
      return;
    }
    try {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({ response, body: body.includes('safe-area-inset') ? rewriteSafeArea(body) : body });
    } catch {
      await route.continue().catch(() => {});
    }
  }

  async apply(device: DeviceSpec, layout: Layout): Promise<'applied' | 'reopened'> {
    if (this.keyOf(device, layout) !== this.contextKey) {
      await this.open(device, layout);
      return 'reopened';
    }
    await this.page.setViewportSize({ width: layout.viewport.w, height: layout.viewport.h });
    await this.setInsets(layout.insets);
    await this.ensureFrames(layout);
    return 'applied';
  }

  /** 지금 문서에 바로 걸고, 앞으로 열 문서에도 걸리게 문서 시작 스크립트를 덧붙인다(마지막에 붙인 값이 이긴다) */
  private async setInsets(insets: Insets): Promise<void> {
    const key = JSON.stringify(insets);
    if (key === this.insetsKey) return;
    this.insetsKey = key;
    const call = `window.__foldlabSafeArea && window.__foldlabSafeArea.set(${key})`;
    await this.context!.addInitScript({ content: call });
    if (this.page) await this.page.evaluate(call).catch(() => {});
  }

  documentChanged(url: string): void {
    const h = this.hist;
    if (h.pending === 'back') h.index = Math.max(0, h.index - 1);
    else if (h.pending === 'forward') h.index = Math.min(h.entries.length - 1, h.index + 1);
    else if (h.pending !== 'reload' && h.entries[h.index] !== url && url !== 'about:blank') {
      h.entries = h.entries.slice(0, h.index + 1);
      h.entries.push(url);
      h.index = h.entries.length - 1;
    }
    h.pending = null;
    this.scroll = { x: 0, y: 0, scale: 1, at: 0 };
  }

  noteHistory(dir: 'back' | 'forward' | 'reload'): void {
    this.hist.pending = dir;
  }

  // ---------- 화면 스트리밍 ----------

  private async ensureFrames(layout: Layout): Promise<void> {
    const vp = layout.viewport;
    const key = `${vp.w}x${vp.h}`;
    if (key === this.frameKey) return;
    if (this.frameKey) await this.page.screencast.stop().catch(() => {});
    this.frameKey = key;
    await this.page.screencast.start({
      size: { width: Math.round(vp.w * SCREENCAST_SCALE), height: Math.round(vp.h * SCREENCAST_SCALE) },
      quality: 75,
      onFrame: async ({ data, viewportWidth, viewportHeight }) => {
        if (this.closed) return;
        this.pollScroll();
        const s = this.scroll;
        await this.hooks.frame({ vw: viewportWidth, vh: viewportHeight, scrollX: s.x, scrollY: s.y, pageScale: s.scale }, data);
      },
    });
  }

  /** 프레임에 스크롤 위치가 없으므로 조금씩 물어봐 문제 표시가 스크롤을 따라가게 한다 */
  private pollScroll(): void {
    const now = Date.now();
    if (now - this.scroll.at < 120) return;
    this.scroll.at = now;
    void this.page
      .evaluate(() => [window.scrollX, window.scrollY, window.visualViewport ? window.visualViewport.scale : 1])
      .then(([x, y, scale]) => {
        this.scroll = { x, y, scale, at: this.scroll.at };
      })
      .catch(() => {});
  }

  // ---------- 페이지 안 계산 ----------

  async evaluate<T>(expression: string): Promise<T> {
    return (await this.page.evaluate(expression)) as T;
  }

  async evaluateTool<T>(expression: string): Promise<T> {
    const loaded = await this.page.evaluate('typeof window.__foldlab').catch(() => 'undefined');
    if (loaded !== 'object') {
      const src = await getAnalyzerSource();
      // 묶음은 var __foldlab = ... 꼴이라 함수 안에서 실행하고 window에 붙인다
      await this.page.evaluate(`(() => { ${src}\n; window.__foldlab = __foldlab; return true; })()`);
    }
    return (await this.page.evaluate(expression)) as T;
  }

  // ---------- 입력 ----------

  /**
   * Playwright WebKit은 탭만 보낼 수 있고 터치 끌기는 없다.
   * 짧게 누르고 떼면 탭, 끌면 휠 스크롤로 바꿔 보낸다.
   */
  async touch(phase: TouchPhase, x: number, y: number): Promise<void> {
    if (phase === 'start') {
      this.drag = { x0: x, y0: y, x, y, t0: Date.now(), moved: false };
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (phase === 'move') {
      if (Math.hypot(x - d.x0, y - d.y0) > DRAG_THRESHOLD) d.moved = true;
      const dx = x - d.x;
      const dy = y - d.y;
      d.x = x;
      d.y = y;
      if (d.moved && (dx || dy)) {
        await this.page.mouse.move(x, y);
        await this.page.mouse.wheel(-dx, -dy);
      }
      return;
    }
    this.drag = null;
    if (phase === 'end' && !d.moved && Date.now() - d.t0 < 700) await this.page.touchscreen.tap(d.x0, d.y0);
  }

  async wheel(x: number, y: number, dx: number, dy: number): Promise<void> {
    await this.page.mouse.move(x, y);
    await this.page.mouse.wheel(dx, dy);
  }

  // ---------- 캡처·상태 ----------

  async screenshot(layout: Layout): Promise<{ image: string; scale: number }> {
    const buf = await this.page.screenshot({ type: 'png', scale: 'device' });
    return { image: `data:image/png;base64,${buf.toString('base64')}`, scale: layout.dpr };
  }

  async navigationState(): Promise<{ canGoBack: boolean; canGoForward: boolean }> {
    return { canGoBack: this.hist.index > 0, canGoForward: this.hist.index < this.hist.entries.length - 1 };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.context?.close().catch(() => {});
  }
}
