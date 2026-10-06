import type { Page } from 'playwright';
import type { EmulationSupport, Engine, FrameHeader } from '../../shared/protocol';
import type { DeviceSpec, Layout } from '../../shared/types';

export type FrameMeta = Omit<FrameHeader, 'seq'>;
export type TouchPhase = 'start' | 'move' | 'end' | 'cancel';

/** 세션이 드라이버에 넘기는 연결점 */
export interface DriverHooks {
  /** 새 페이지가 생길 때마다 이벤트를 붙인다(WebKit은 기기를 바꾸면 페이지를 새로 만든다) */
  attach(page: Page): void;
  /** 화면 프레임 하나. 돌려준 Promise가 끝나야 다음 프레임을 받는다(전송 속도에 맞춘 흐름 제어) */
  frame(meta: FrameMeta, jpeg: Buffer): Promise<void>;
}

/**
 * 엔진마다 다른 부분만 모은 드라이버.
 * 분석·자세 전환 연속성·비교 시트 같은 공통 흐름은 LiveSession이 맡는다.
 */
export interface EngineDriver {
  readonly engine: Engine;
  readonly page: Page;
  readonly support: EmulationSupport;
  readonly version: string;
  start(device: DeviceSpec, layout: Layout): Promise<void>;
  /** 레이아웃을 건다. 'reopened'면 페이지를 새로 만들었으므로(WebKit에서 DPR·UA 변경) 세션이 주소를 다시 연다 */
  apply(device: DeviceSpec, layout: Layout): Promise<'applied' | 'reopened'>;
  /** 메인 프레임이 새 문서로 바뀌었을 때 */
  documentChanged(url: string): void;
  /** 뒤로·앞으로·새로고침 직전에 알린다(방문 기록을 직접 세는 엔진용) */
  noteHistory(dir: 'back' | 'forward' | 'reload'): void;
  /** 페이지 메인 월드에서 식을 계산한다(Promise는 기다린다) */
  evaluate<T>(expression: string): Promise<T>;
  /** 분석기(__foldlab)가 있는 곳에서 식을 계산한다 */
  evaluateTool<T>(expression: string): Promise<T>;
  touch(phase: TouchPhase, x: number, y: number): Promise<void>;
  wheel(x: number, y: number, dx: number, dy: number): Promise<void>;
  /** 현재 뷰포트를 PNG data URL로. scale은 CSS px 대비 배율 */
  screenshot(layout: Layout): Promise<{ image: string; scale: number }>;
  navigationState(): Promise<{ canGoBack: boolean; canGoForward: boolean }>;
  close(): Promise<void>;
}
