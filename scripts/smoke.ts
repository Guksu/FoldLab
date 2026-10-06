// 서버에 웹소켓으로 붙어 데모 페이지를 열고 자세별 분석·캡처가 되는지 확인하는 간단한 점검 스크립트
// 사용: npx tsx scripts/smoke.ts [url] [deviceId] [mode]
import { writeFileSync, mkdirSync } from 'node:fs';
import WebSocket from 'ws';
import { DEVICES } from '../shared/devices';
import { decodeFrame, type ServerMessage } from '../shared/protocol';

const url = process.argv[2] ?? 'http://127.0.0.1:4280/demo/trip';
const deviceId = process.argv[3] ?? 'galaxy-z-fold7';
const mode = (process.argv[4] ?? 'app') as 'app' | 'browser';
const outDir = process.env.SMOKE_OUT ?? '.foldlab/smoke';
mkdirSync(outDir, { recursive: true });
const device = DEVICES.find((d) => d.id === deviceId)!;
const ws = new WebSocket(`ws://127.0.0.1:${process.env.FOLDLAB_PORT ?? 4280}/ws`);
let frames = 0;
const send = (m: unknown) => ws.send(JSON.stringify(m));
const wait = (pred: (m: ServerMessage) => boolean, ms = 20000) =>
  new Promise<ServerMessage>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    const on = (data: WebSocket.RawData, bin: boolean) => {
      if (bin) return;
      const m = JSON.parse(data.toString()) as ServerMessage;
      if (pred(m)) {
        clearTimeout(t);
        ws.off('message', on);
        resolve(m);
      }
    };
    ws.on('message', on);
  });
ws.on('message', (data, bin) => {
  if (bin) {
    frames++;
    if (frames === 1) {
      const buf = data as Buffer;
      const { header, jpeg } = decodeFrame(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      console.log('first frame', header, jpeg.length, 'bytes');
    }
    return;
  }
  const m = JSON.parse(data.toString()) as ServerMessage;
  if (m.t === 'error') console.log('ERROR', m.message);
  if (m.t === 'dialog') console.log('DIALOG', m.kind, m.message);
});
await new Promise((r) => ws.once('open', r));
const postureId = device.postures[1].id;
send({ t: 'open', url, device, postureId, mode, fit: 'page' });
const st = (await wait((m) => m.t === 'state' && m.state.url.startsWith('http') && !m.state.loading)) as Extract<ServerMessage, { t: 'state' }>;
console.log('state', st.state.url, st.state.layout.viewport, 'insets', st.state.layout.insets, 'fit', st.state.effectiveFit, 'support', st.state.support);
const an = (await wait((m) => m.t === 'analysis')) as Extract<ServerMessage, { t: 'analysis' }>;
console.log('analysis', an.analysis.postureId, an.analysis.counts, `${an.analysis.ms}ms`);
for (const i of an.analysis.issues) console.log(`  [${i.severity}] ${i.rule} ${i.label ?? ''} — ${i.detail}`);
console.log('env', JSON.stringify({ ...an.analysis.env, url: undefined }));
send({ t: 'capture', postureIds: device.postures.filter((p) => p.sheet).map((p) => p.id) });
const cap = (await wait((m) => m.t === 'capture', 60000)) as Extract<ServerMessage, { t: 'capture' }>;
for (const it of cap.result.items) {
  const file = `${outDir}/${deviceId}-${mode}-${it.postureId}.png`;
  writeFileSync(file, Buffer.from(it.image.split(',')[1], 'base64'));
  console.log(`capture ${it.postureId} vp=${it.layout.viewport.w}x${it.layout.viewport.h} seg=${JSON.stringify(it.analysis.env.segments)} posture=${it.analysis.env.posture} safe=${JSON.stringify(it.analysis.env.safeArea)} counts=${JSON.stringify(it.analysis.counts)} -> ${file}`);
  for (const i of it.analysis.issues) console.log(`    [${i.severity}] ${i.rule} ${i.label ?? ''} — ${i.detail}`);
}
console.log('frames received', frames);
ws.close();
process.exit(0);
