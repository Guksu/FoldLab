import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import { findPosture, findScreen, screenOrientation } from '../../shared/geometry';
import type { EmulationSupport } from '../../shared/protocol';
import type { DeviceSpec, Layout } from '../../shared/types';
import { getBrowser } from '../browser';
import { guardRoute } from '../guard';
import { getAnalyzerSource, getHooksSource } from '../inpage';
import type { DriverHooks, EngineDriver, TouchPhase } from './types';

/** 캡처 해상도: 뷰포트 CSS px의 2배 */
const CAPTURE_SCALE = 2;
const SCREENCAST_SCALE = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 크로미움: CDP 에뮬레이션으로 뷰포트·화면 분할·자세·안전 영역을 재현한다.
 * 메인 월드는 페이지가 보는 곳, 분석기는 페이지와 섞이지 않는 격리된 월드에서 돈다.
 */
export class ChromiumDriver implements EngineDriver {
  readonly engine = 'chromium' as const;
  page!: Page;
  support: EmulationSupport = { segments: 'none', posture: 'ok', safeArea: 'ok' };
  private browser!: Browser;
  private context!: BrowserContext;
  private cdp!: CDPSession;
  private device!: DeviceSpec;
  private layout: Layout | null = null;
  private worldId: number | null = null;
  private screencastKey = '';
  private uaKey = '';
  private closed = false;

  constructor(private readonly hooks: DriverHooks) {}

  get version(): string {
    return this.browser?.version() ?? '';
  }

  async start(device: DeviceSpec, layout: Layout): Promise<void> {
    this.browser = await getBrowser();
    this.context = await this.browser.newContext({
      viewport: null,
      acceptDownloads: false,
      ignoreHTTPSErrors: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    await guardRoute(this.context);
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
    this.hooks.attach(this.page);
    await this.apply(device, layout);
  }

  async apply(device: DeviceSpec, layout: Layout): Promise<'applied'> {
    const widthChanged = !this.layout || this.layout.viewport.w !== layout.viewport.w;
    this.device = device;
    this.layout = layout;
    const vp = layout.viewport;
    const posture = findPosture(device, layout.postureId);
    const screen = findScreen(device, posture.screen);

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
    return 'applied';
  }

  /**
   * 크롬은 새 문서의 navigator.devicePosture에 재정의 값을 넘겨주지 않는다(CSS device-posture는 그대로).
   * 같은 값을 다시 걸면 무시되므로 지웠다가 다시 건다. 문서 시작 때 객체를 만들어 두었으니 페이지 스크립트보다 먼저 반영된다.
   */
  documentChanged(): void {
    this.worldId = null;
    if (this.closed || !this.layout || this.support.posture !== 'ok') return;
    const type = this.layout.devicePosture;
    void (async () => {
      await this.cdp.send('Emulation.clearDevicePostureOverride' as never).catch(() => {});
      await this.cdp.send('Emulation.setDevicePostureOverride' as never, { posture: { type } } as never).catch(() => {});
    })();
  }

  noteHistory(): void {}

  /**
   * 에뮬레이션 크기를 바꾸면 크롬이 이전 배율(줌)을 그대로 끌고 와 화면이 확대된 채 남는다(예: 1.74배).
   * 새 폭에서 처음 연 것과 같도록 페이지 배율을 viewport 메타의 초기 배율로 맞춘다.
   */
  private async normalizePageScale(): Promise<void> {
    if (!this.page.url().startsWith('http') || !this.layout) return;
    const vpW = this.layout.viewport.w;
    const scale = await this.evaluate<number>(`(() => {
      const c = (document.querySelector('meta[name="viewport" i]') || {}).content || '';
      const m = /initial-scale\\s*=\\s*([\\d.]+)/i.exec(c);
      if (m) return Math.min(10, Math.max(0.1, parseFloat(m[1])));
      if (/width\\s*=\\s*device-width/i.test(c)) return 1;
      return ${vpW} / Math.max(${vpW}, document.documentElement.clientWidth || 980);
    })()`).catch(() => NaN);
    if (!scale || !Number.isFinite(scale)) return;
    await sleep(30);
    await this.cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale }).catch(() => {});
  }

  /** 화면 분할(세그먼트)이 실제로 페이지에 반영됐는지 확인한다. 안 되면 신형 CDP 명령으로 한 번 더 시도한다. */
  private async verifySegments(): Promise<void> {
    const layout = this.layout!;
    const want = layout.displayFeature ? 2 : 1;
    const count = () =>
      this.evaluate<number>('window.viewport && window.viewport.segments ? window.viewport.segments.length : 1').catch(() => undefined);
    if (!layout.displayFeature) {
      await this.cdp.send('Emulation.clearDisplayFeaturesOverride' as never).catch(() => {});
      this.support.segments = 'none';
      return;
    }
    let n = await count();
    if (n !== want) {
      await this.cdp.send('Emulation.setDisplayFeaturesOverride' as never, { features: [layout.displayFeature] } as never).catch(() => {});
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
    const vp = this.layout!.viewport;
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

  private onFrame(f: {
    data: string;
    sessionId: number;
    metadata: { deviceWidth: number; deviceHeight: number; scrollOffsetX: number; scrollOffsetY: number; pageScaleFactor: number };
  }): void {
    if (this.closed) return;
    const m = f.metadata;
    void this.hooks
      .frame(
        { vw: m.deviceWidth, vh: m.deviceHeight, scrollX: m.scrollOffsetX, scrollY: m.scrollOffsetY, pageScale: m.pageScaleFactor },
        Buffer.from(f.data, 'base64'),
      )
      .finally(() => {
        if (!this.closed) void this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      });
  }

  // ---------- 페이지 안 계산 ----------

  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
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

  async evaluateTool<T>(expression: string): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const contextId = await this.isolatedWorld();
      try {
        const r = await this.cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
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

  // ---------- 입력 ----------

  async touch(phase: TouchPhase, x: number, y: number): Promise<void> {
    const type = { start: 'touchStart', move: 'touchMove', end: 'touchEnd', cancel: 'touchCancel' }[phase] as
      | 'touchStart'
      | 'touchMove'
      | 'touchEnd'
      | 'touchCancel';
    const touchPoints = phase === 'end' || phase === 'cancel' ? [] : [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }

  async wheel(x: number, y: number, dx: number, dy: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
  }

  // ---------- 캡처·상태 ----------

  async screenshot(layout: Layout): Promise<{ image: string; scale: number }> {
    const m = await this.cdp.send('Page.getLayoutMetrics');
    const v = m.cssVisualViewport;
    const shot = await this.cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: {
        x: v.pageX,
        y: v.pageY,
        width: v.clientWidth,
        height: v.clientHeight,
        scale: (CAPTURE_SCALE * (v.scale || 1)) / layout.dpr,
      },
      captureBeyondViewport: false,
    });
    return { image: `data:image/png;base64,${shot.data}`, scale: CAPTURE_SCALE };
  }

  async navigationState(): Promise<{ canGoBack: boolean; canGoForward: boolean }> {
    const hist = await this.cdp.send('Page.getNavigationHistory').catch(() => null);
    return {
      canGoBack: !!hist && hist.currentIndex > 0 && hist.entries[hist.currentIndex - 1]?.url !== 'about:blank',
      canGoForward: !!hist && hist.currentIndex < hist.entries.length - 1,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.context?.close().catch(() => {});
  }
}
