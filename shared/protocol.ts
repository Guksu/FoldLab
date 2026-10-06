import type { MeasureSnapshot, MeasureUrl } from './measure';
import type { Analysis, DeviceSpec, DisplayMode, FitPolicy, Layout, ViewportFit } from './types';

/** 페이지를 그리는 엔진. 아이폰 기기는 WebKit(사파리 엔진)으로도 그릴 수 있다 */
export type Engine = 'chromium' | 'webkit';

/** 브라우저(UI) → 서버 */
export type ClientMessage =
  | {
      t: 'open';
      url: string;
      device: DeviceSpec;
      postureId: string;
      mode: DisplayMode;
      fit: FitPolicy;
      engine?: Engine;
    }
  | { t: 'navigate'; url: string }
  | { t: 'history'; dir: 'back' | 'forward' | 'reload' }
  | { t: 'configure'; device?: DeviceSpec; postureId?: string; mode?: DisplayMode; fit?: FitPolicy; engine?: Engine }
  | { t: 'touch'; phase: 'start' | 'move' | 'end' | 'cancel'; x: number; y: number }
  | { t: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { t: 'key'; phase: 'down' | 'up'; key: string; code: string; modifiers: number }
  | { t: 'text'; text: string }
  | { t: 'analyze' }
  | { t: 'reveal'; ref: number }
  | { t: 'capture'; postureIds: string[] }
  | { t: 'measure-start'; lan: boolean }
  | { t: 'measure-stop' };

export interface EmulationSupport {
  segments: 'ok' | 'unsupported' | 'none';
  posture: 'ok' | 'unsupported';
  safeArea: 'ok' | 'unsupported';
}

export interface SessionState {
  engine: Engine;
  /** 엔진 버전(예: 141.0.7390.37, 26.0) */
  engineVersion: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  deviceId: string;
  postureId: string;
  mode: DisplayMode;
  fit: FitPolicy;
  effectiveFit: ViewportFit;
  layout: Layout;
  support: EmulationSupport;
}

export interface CaptureItem {
  postureId: string;
  layout: Layout;
  /** data:image/png;base64,... (뷰포트 2배 해상도) */
  image: string;
  imageScale: number;
  analysis: Analysis;
}

export interface CaptureResult {
  url: string;
  title: string;
  deviceId: string;
  mode: DisplayMode;
  at: number;
  items: CaptureItem[];
}

/** 서버 → 브라우저(JSON). 화면 프레임은 바이너리 메시지로 따로 보낸다. */
export type ServerMessage =
  | { t: 'hello'; browser: string; version: string; engines: { webkit: boolean } }
  | { t: 'state'; state: SessionState }
  | { t: 'analysis'; analysis: Analysis }
  | { t: 'capture-progress'; done: number; total: number; postureId: string }
  | { t: 'capture'; result: CaptureResult }
  | { t: 'dialog'; kind: string; message: string }
  | { t: 'measure-ready'; token: string; urls: MeasureUrl[]; lanError?: string }
  | { t: 'measure-snapshot'; snapshot: MeasureSnapshot }
  | { t: 'error'; message: string };

export interface FrameHeader {
  /** 뷰포트 CSS 크기 */
  vw: number;
  vh: number;
  scrollX: number;
  scrollY: number;
  pageScale: number;
  seq: number;
}

/** 바이너리 프레임: [헤더 길이 uint32 BE][헤더 JSON][JPEG] */
export function encodeFrame(header: FrameHeader, jpeg: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + head.length + jpeg.length);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(jpeg, 4 + head.length);
  return out;
}

export function decodeFrame(buf: ArrayBuffer): { header: FrameHeader; jpeg: Uint8Array } {
  const len = new DataView(buf).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as FrameHeader;
  return { header, jpeg: new Uint8Array(buf, 4 + len) };
}
