import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import express, { type Router } from 'express';
import { parseSnapshot, type MeasureSnapshot, type MeasureUrl } from '../shared/measure';
import { config } from './config';

// 개발: server/measure, 빌드: dist/server/measure
const measureDir = fileURLToPath(new URL('./measure', import.meta.url));

/** 같은 네트워크에서 폰이 접속할 만한 IPv4 주소(사설망 우선) */
export function lanAddresses(): string[] {
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address)
    .sort((a, b) => rank(a) - rank(b));
}

type Listener = (snapshot: MeasureSnapshot) => void;

/**
 * 실기기 측정 페이지(/measure)와 측정값 수신을 맡는다.
 * - PC·Xcode 시뮬레이터는 본 서버(127.0.0.1)의 /measure를 그대로 연다.
 * - 같은 와이파이의 폰은 UI가 요청할 때만 여는 별도 포트로 접속한다. 이 포트는 측정 페이지와 수신 주소만 제공한다.
 * 측정값은 서버를 켤 때 만든 토큰이 있어야 받는다.
 */
export class MeasureHub {
  readonly token = randomBytes(12).toString('base64url');
  private listeners = new Set<Listener>();
  private lan: Server | null = null;
  private lanPort = 0;
  private stopTimer: NodeJS.Timeout | undefined;

  router({ requireTokenForPage }: { requireTokenForPage: boolean }): Router {
    const r = express.Router();
    r.get('/measure', (req, res) => {
      if (requireTokenForPage && req.query.t !== this.token) {
        res.status(404).end();
        return;
      }
      res.set('cache-control', 'no-store');
      res.sendFile('index.html', { root: measureDir });
    });
    r.post('/measure/report', express.json({ limit: '64kb' }), (req, res) => {
      if (req.query.t !== this.token) {
        res.status(403).json({ ok: false, error: '토큰이 맞지 않습니다.' });
        return;
      }
      const snapshot = parseSnapshot(req.body);
      if (typeof snapshot === 'string') {
        res.status(400).json({ ok: false, error: snapshot });
        return;
      }
      for (const fn of this.listeners) fn(snapshot);
      res.json({ ok: true, listeners: this.listeners.size });
    });
    return r;
  }

  /** UI 하나가 측정값을 받기 시작한다. 돌려준 함수를 부르면 그만 받는다. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    clearTimeout(this.stopTimer);
    return () => {
      this.listeners.delete(fn);
      // 받을 곳이 없으면 잠시 뒤 같은 네트워크용 포트를 닫는다
      if (!this.listeners.size) {
        clearTimeout(this.stopTimer);
        this.stopTimer = setTimeout(() => void this.closeLan(), 60_000);
        this.stopTimer.unref();
      }
    };
  }

  async start(lan: boolean): Promise<{ token: string; urls: MeasureUrl[]; lanError?: string }> {
    const urls: MeasureUrl[] = [
      { kind: 'local', label: '이 PC · Xcode 시뮬레이터', url: `http://localhost:${config.port}/measure?t=${this.token}` },
    ];
    let lanError: string | undefined;
    if (lan) {
      try {
        await this.openLan();
        const ips = lanAddresses();
        for (const ip of ips) urls.push({ kind: 'lan', label: `같은 와이파이 · ${ip}`, url: `http://${ip}:${this.lanPort}/measure?t=${this.token}` });
        if (!ips.length) lanError = '이 PC의 와이파이·유선 네트워크 주소를 찾지 못했습니다.';
      } catch (err) {
        lanError = `같은 네트워크용 포트를 열지 못했습니다: ${(err as Error).message}`;
      }
    }
    return { token: this.token, urls, lanError };
  }

  private async openLan(): Promise<void> {
    if (this.lan) return;
    const app = express();
    app.disable('x-powered-by');
    app.use(this.router({ requireTokenForPage: true }));
    app.use((_req, res) => res.status(404).end());
    const server = createServer(app);
    const listen = (port: number) =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => {
          server.off('error', reject);
          resolve();
        });
      });
    try {
      await listen(config.measurePort);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      await listen(0);
    }
    const addr = server.address();
    this.lanPort = typeof addr === 'object' && addr ? addr.port : config.measurePort;
    this.lan = server;
    console.log(`[foldlab] 실측용 포트를 열었습니다: 0.0.0.0:${this.lanPort} (측정 페이지만 제공)`);
  }

  async closeLan(): Promise<void> {
    const server = this.lan;
    this.lan = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections?.();
    console.log('[foldlab] 실측용 포트를 닫았습니다.');
  }
}
