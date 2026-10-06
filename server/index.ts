import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { encodeFrame, type ClientMessage, type ServerMessage } from '../shared/protocol';
import { validateDevice } from '../shared/validate';
import { closeBrowser, getBrowser, webkitInstalled } from './browser';
import { config } from './config';
import { MeasureHub } from './measure';
import { LiveSession, type SessionSink } from './session';

const VERSION = '0.1.0';
const MAX_BUFFERED = 6 * 1024 * 1024;

const app = express();
app.disable('x-powered-by');

// 개발: server/demo, 빌드: dist/server/demo
const demoDir = fileURLToPath(new URL('./demo', import.meta.url));
const webDir = fileURLToPath(new URL('../web', import.meta.url));
const hasWebBuild = existsSync(`${webDir}/index.html`) && fileURLToPath(import.meta.url).includes('/dist/');

app.get('/api/health', async (_req, res) => {
  try {
    const browser = await getBrowser();
    res.json({ ok: true, version: VERSION, browser: browser.version(), sessions: sessions.size, allowPrivateNetwork: config.allowPrivateNetwork });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err as Error).message) });
  }
});

app.use('/demo', express.static(demoDir, { extensions: ['html'] }));

// 실기기 측정 페이지. 같은 와이파이의 폰은 UI가 요청할 때 여는 별도 포트로 접속한다.
const measure = new MeasureHub();
app.use(measure.router({ requireTokenForPage: false }));

if (hasWebBuild) {
  app.use(express.static(webDir, { index: 'index.html', maxAge: '1h' }));
  app.get(/^\/(?!api\/|ws$|demo\/|measure).*/, (_req, res) => res.sendFile(`${webDir}/index.html`));
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 << 20 });
const sessions = new Set<LiveSession>();

/** 다른 사이트가 사용자 몰래 로컬 FoldLab에 접속해 브라우저를 조종하지 못하게 출처를 확인한다 */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    if (o.host === req.headers.host) return true;
    const extra = (process.env.FOLDLAB_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (extra.includes(origin)) return true;
    // vite 개발 서버(프록시)
    return ['localhost', '127.0.0.1', '[::1]'].includes(o.hostname) && o.port === '5280';
  } catch {
    return false;
  }
}

wss.on('connection', (ws: WebSocket, req) => {
  if (!originAllowed(req)) {
    ws.close(1008, 'origin not allowed');
    return;
  }
  const sink: SessionSink = {
    json(msg: ServerMessage) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    frame(header, jpeg, done) {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) {
        done();
        return;
      }
      ws.send(encodeFrame(header, jpeg), { binary: true }, () => done());
    },
  };

  let session: LiveSession | null = null;
  let stopMeasure: (() => void) | null = null;
  let queue: Promise<void> = Promise.resolve();
  const fail = (err: unknown) => sink.json({ t: 'error', message: String((err as Error)?.message ?? err) });

  void getBrowser()
    .then((b) => sink.json({ t: 'hello', browser: b.version(), version: VERSION, engines: { webkit: webkitInstalled() } }))
    .catch(fail);

  const handle = async (msg: ClientMessage) => {
    if ((msg.t === 'open' || msg.t === 'configure') && msg.device) {
      const problem = validateDevice(msg.device);
      if (problem) throw new Error(`기기 정의 오류: ${problem}`);
    }
    if (msg.t === 'open') {
      if (!session) {
        if (sessions.size >= config.maxSessions) throw new Error(`동시 세션은 ${config.maxSessions}개까지입니다. 잠시 뒤 다시 시도하세요.`);
        const s = new LiveSession(sink, { device: msg.device, postureId: msg.postureId, mode: msg.mode, fit: msg.fit, engine: msg.engine });
        sessions.add(s);
        session = s;
        try {
          await s.start();
        } catch (err) {
          // 엔진을 띄우지 못하면(WebKit 미설치 등) 세션을 버려 다음 열기에서 다시 만든다
          sessions.delete(s);
          session = null;
          await s.close().catch(() => {});
          throw err;
        }
      } else {
        await session.configure({ device: msg.device, postureId: msg.postureId, mode: msg.mode, fit: msg.fit, engine: msg.engine });
      }
      await session.navigate(msg.url);
      return;
    }
    if (msg.t === 'measure-start') {
      stopMeasure?.();
      stopMeasure = measure.subscribe((snapshot) => sink.json({ t: 'measure-snapshot', snapshot }));
      sink.json({ t: 'measure-ready', ...(await measure.start(msg.lan)) });
      return;
    }
    if (msg.t === 'measure-stop') {
      stopMeasure?.();
      stopMeasure = null;
      return;
    }
    if (!session) throw new Error('먼저 주소를 열어 주세요.');
    const s: LiveSession = session;
    s.lastActive = Date.now();
    switch (msg.t) {
      case 'navigate':
        return s.navigate(msg.url);
      case 'history':
        return s.history(msg.dir);
      case 'configure':
        return s.configure(msg);
      case 'analyze':
        await s.runAnalysis();
        return;
      case 'reveal':
        return s.reveal(msg.ref);
      case 'capture': {
        const result = await s.capture(msg.postureIds, (done, total, postureId) =>
          sink.json({ t: 'capture-progress', done, total, postureId }),
        );
        sink.json({ t: 'capture', result });
        return;
      }
      default:
        return;
    }
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }
    // 입력은 순서만 지키면 되므로 별도로 바로 보낸다(캡처·탐색을 기다리지 않음)
    if (msg.t === 'touch' || msg.t === 'wheel' || msg.t === 'key' || msg.t === 'text') {
      const s = session;
      if (!s) return;
      const run =
        msg.t === 'touch'
          ? s.touch(msg.phase, msg.x, msg.y)
          : msg.t === 'wheel'
            ? s.wheel(msg.x, msg.y, msg.dx, msg.dy)
            : msg.t === 'key'
              ? s.key(msg.phase, msg.key)
              : s.text(msg.text);
      run.catch(() => {});
      return;
    }
    queue = queue.then(() => handle(msg)).catch(fail);
  });

  ws.on('close', () => {
    stopMeasure?.();
    stopMeasure = null;
    const s = session;
    session = null;
    if (s) {
      sessions.delete(s);
      void s.close();
    }
  });
});

const idleTimer = setInterval(() => {
  const now = Date.now();
  for (const s of sessions) {
    if (now - s.lastActive > config.idleTimeoutMs && !s.busy) {
      sessions.delete(s);
      void s.close();
    }
  }
}, 60_000);
idleTimer.unref();

server.listen(config.port, config.host, () => {
  const url = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
  console.log(`[foldlab] ${hasWebBuild ? 'UI·API' : 'API'} 서버: ${url}${hasWebBuild ? '' : ' (UI는 npm run dev의 vite 주소로 여세요)'}`);
  console.log(`[foldlab] 데모 페이지: ${url}/demo/trip`);
  if (!config.allowPrivateNetwork) console.log('[foldlab] localhost·사설망 주소 접근을 막습니다.');
  // 첫 요청이 느리지 않게 미리 띄운다
  getBrowser().catch((err) => console.error('[foldlab]', (err as Error).message));
});

async function shutdown() {
  clearInterval(idleTimer);
  await Promise.all([...sessions].map((s) => s.close()));
  await Promise.all([closeBrowser(), measure.closeLan()]);
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
