import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeBrowser } from '../server/browser';
import { LiveSession } from '../server/session';
import { getDevice } from '../shared/devices';
import type { Engine, ServerMessage, SessionState } from '../shared/protocol';

/**
 * WebKit을 쓸 수 없을 때 크로미움으로 대신 그리는지 본다.
 * 실제 WebKit 설치 여부와 상관없이 돌도록 browser 모듈의 WebKit 부분만 바꿔 끼운다.
 */
const webkit = vi.hoisted(() => ({ installed: true }));
vi.mock('../server/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/browser')>()),
  webkitInstalled: () => webkit.installed,
  getWebKit: () => Promise.reject(new Error('WebKit을 실행하지 못했습니다(테스트).')),
}));

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>엔진</title><p>엔진 고르기</p>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  server?.close();
  await closeBrowser();
});

function collect() {
  const messages: ServerMessage[] = [];
  const states = () => messages.filter((m): m is { t: 'state'; state: SessionState } => m.t === 'state').map((m) => m.state);
  return {
    sink: {
      json: (m: ServerMessage) => void messages.push(m),
      frame: (_h: unknown, _j: Buffer, done: () => void) => done(),
    },
    states,
    state: () => states().at(-1)!,
    errors: () => messages.filter((m): m is { t: 'error'; message: string } => m.t === 'error').map((m) => m.message),
  };
}

const options = (engine: Engine) => ({ device: getDevice('iphone-duo')!, postureId: 'unfolded', mode: 'app' as const, fit: 'page' as const, engine });

describe('엔진 고르기', () => {
  it('WebKit이 없는 서버면 알리지 않고 크로미움으로 그리며, WebKit을 골라도 페이지를 다시 열지 않는다', async () => {
    webkit.installed = false;
    const c = collect();
    const session = new LiveSession(c.sink, options('webkit'));
    try {
      await session.start();
      await session.navigate(base);
      expect(c.state().engine).toBe('chromium');
      const seen = c.states().length;
      await session.configure({ engine: 'webkit' });
      expect(c.state().engine).toBe('chromium');
      expect(c.state().url).toBe(base);
      expect(c.states().slice(seen).some((s) => s.loading)).toBe(false);
      expect(c.errors()).toEqual([]);
    } finally {
      await session.close();
      webkit.installed = true;
    }
  });

  it('WebKit을 띄우지 못하면 크로미움으로 대신 열고 이유를 알린다', async () => {
    const c = collect();
    const session = new LiveSession(c.sink, options('webkit'));
    try {
      await session.start();
      expect(c.state().engine).toBe('chromium');
      expect(c.errors()).toEqual([expect.stringContaining('WebKit 대신 크로미움으로 그립니다.')]);
      await session.navigate(base);
      expect(c.state().url).toBe(base);
      expect((await session.analyze())?.env.dpr).toBe(c.state().layout.dpr);
    } finally {
      await session.close();
    }
  });

  it('보던 페이지에서 WebKit으로 바꾸다 실패해도 크로미움으로 같은 주소를 다시 연다', async () => {
    const c = collect();
    const session = new LiveSession(c.sink, options('chromium'));
    try {
      await session.start();
      await session.navigate(base);
      await session.configure({ engine: 'webkit' });
      expect(c.state().engine).toBe('chromium');
      expect(c.state().url).toBe(base);
      expect(c.errors()).toHaveLength(1);
      expect((await session.analyze())?.env.dpr).toBe(c.state().layout.dpr);
    } finally {
      await session.close();
    }
  });
});
