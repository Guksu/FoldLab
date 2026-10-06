// README용 시연 영상을 만든다.
// 실행 중인 FoldLab을 자동으로 조작하며 화면을 녹화하고, ffmpeg로 MP4와 GIF를 만든다.
//
// 사용:
//   npm run build && npm start      # 다른 터미널에서 서버를 띄워 둔다
//   npm run record:demo             # docs/media/foldlab-demo.mp4, .gif 생성 (ffmpeg 필요)
//
// 환경 변수: DEMO_APP_URL(기본 http://127.0.0.1:4280/), DEMO_OUT(기본 docs/media)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { findInstalledChromium } from '../server/browser';

const APP = process.env.DEMO_APP_URL ?? 'http://127.0.0.1:4280/';
const OUT = resolve(process.env.DEMO_OUT ?? 'docs/media');
const WORK = resolve('.foldlab/demo-frames');
const VIEWPORT = { width: 1440, height: 900 };
const VIDEO_WIDTH = 1920;
const GIF_WIDTH = 960;

// 헤드리스 화면에는 마우스 커서가 없으므로 커서와 클릭 표시를 페이지에 그려 넣는다
const CURSOR_SCRIPT = `(() => {
  const install = () => {
    if (document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 2.5v16.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.5 6-.2z" fill="#101828" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + (e.clientX - 5) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;width:30px;height:30px;border-radius:50%;border:2px solid rgba(16,24,40,.55);background:rgba(16,24,40,.08);z-index:2147483646;pointer-events:none;transition:transform .4s ease-out,opacity .4s ease-out;left:' + (e.clientX - 15) + 'px;top:' + (e.clientY - 15) + 'px';
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transform = 'scale(1.7)'; r.style.opacity = '0'; }));
      setTimeout(() => r.remove(), 450);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();`;

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch {
    const fallback = findInstalledChromium();
    if (!fallback) throw new Error('Chromium이 없습니다. npm run browsers를 먼저 실행하세요.');
    return chromium.launch({ executablePath: fallback });
  }
}

/** 화면 변화가 있을 때마다 프레임을 받아 디스크에 쓴다(시각은 크롬이 준 값) */
async function startRecording(page: Page) {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(WORK, file), Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIDEO_WIDTH, maxHeight: Math.round((VIDEO_WIDTH * VIEWPORT.height) / VIEWPORT.width), everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast');
    return frames;
  };
}

function encode(frames: { file: string; t: number }[]) {
  if (frames.length < 2) throw new Error('녹화된 프레임이 없습니다.');
  // 프레임마다 다음 프레임까지의 시간을 그대로 써서 실제 속도를 살린다
  const lines: string[] = [];
  frames.forEach((f, i) => {
    const next = frames[i + 1];
    const d = next ? Math.max(0.001, next.t - f.t) : 1.5;
    lines.push(`file '${f.file}'`, `duration ${d.toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`);
  writeFileSync(join(WORK, 'list.txt'), lines.join('\n'));
  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, 'foldlab-demo.mp4');
  const gif = join(OUT, 'foldlab-demo.gif');
  const palette = join(WORK, 'palette.png');
  const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  ff(['-f', 'concat', '-safe', '0', '-i', join(WORK, 'list.txt'), '-vf', `fps=30,scale=${VIDEO_WIDTH}:-2:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-movflags', '+faststart', mp4]);
  const gifFilter = `fps=10,scale=${GIF_WIDTH}:-1:flags=lanczos`;
  ff(['-i', mp4, '-vf', `${gifFilter},palettegen=max_colors=128:stats_mode=diff`, palette]);
  ff(['-i', mp4, '-i', palette, '-lavfi', `${gifFilter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, gif]);
  for (const f of [mp4, gif]) console.log(`${f}  ${(statSync(f).size / 1024 / 1024).toFixed(1)}MB`);
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await page.addInitScript(CURSOR_SCRIPT);
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1000);

  let cursor = { x: VIEWPORT.width * 0.62, y: VIEWPORT.height * 0.55 };
  await page.mouse.move(cursor.x, cursor.y);
  const pause = (ms: number) => page.waitForTimeout(ms);
  const moveTo = async (x: number, y: number, ms = 650) => {
    const from = cursor;
    const steps = Math.max(10, Math.round(ms / 22));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await pause(14);
    }
    cursor = { x, y };
  };
  const moveToEl = async (el: Locator, fx = 0.5, fy = 0.5, ms?: number) => {
    const b = await el.boundingBox();
    if (!b) throw new Error('요소 위치를 찾지 못했습니다.');
    await moveTo(b.x + b.width * fx, b.y + b.height * fy, ms);
  };
  const click = async (el: Locator, fx?: number, fy?: number) => {
    await moveToEl(el, fx, fy);
    await pause(160);
    await page.mouse.down();
    await pause(70);
    await page.mouse.up();
  };
  const analyzed = (posture: string) =>
    page.waitForFunction((p) => document.querySelector('.inspector-head p')?.textContent?.startsWith(`${p} 자세 ·`), posture, { timeout: 30000 });
  const wheel = async (dy: number, times: number) => {
    for (let i = 0; i < times; i++) {
      await page.mouse.wheel(0, dy);
      await pause(45);
    }
  };

  const stop = await startRecording(page);
  await pause(1400);

  // 1. 주소를 입력하고 연다
  await click(page.getByRole('textbox', { name: '검사할 주소' }), 0.3);
  await page.keyboard.type(`${new URL(APP).host.replace('127.0.0.1', 'localhost')}/demo/trip`, { delay: 55 });
  await pause(400);
  await page.keyboard.press('Enter');
  await analyzed('펼침');
  await pause(1500);

  // 2. 문제를 눌러 위치와 설명을 본다
  await click(page.locator('.issue-row').first(), 0.35);
  await pause(2200);

  // 3. 기기 화면 안을 직접 스크롤한다
  await moveToEl(page.locator('.live-device .input-capture'), 0.32, 0.6, 800);
  await wheel(80, 7);
  await pause(1000);
  await wheel(-80, 7);
  await pause(800);

  // 4. 자세를 바꾼다
  for (const name of ['접힘', '분할 · 오른쪽', '반 접힘 · 북']) {
    await click(page.getByRole('radio', { name, exact: true }));
    await analyzed(name);
    await pause(1500);
  }

  // 5. 다른 기기(플립)로 바꾼다
  const select = page.getByRole('combobox', { name: '기기' });
  await moveToEl(select, 0.4);
  await pause(250);
  await select.selectOption('galaxy-z-flip8');
  await analyzed('펼침');
  await pause(900);
  await click(page.getByRole('radio', { name: '반 접힘 · 플렉스', exact: true }));
  await analyzed('반 접힘 · 플렉스');
  await pause(1500);

  // 6. 디버그 표시를 껐다 켠다
  const debugSwitch = page.locator('.stage-dock .switch');
  await click(debugSwitch, 0.15);
  await pause(1300);
  await click(debugSwitch, 0.15);
  await pause(900);

  // 7. 비교 시트로 여러 자세를 한 장에 캡처한다
  await click(page.getByRole('tab', { name: '비교 시트' }));
  await pause(800);
  await click(page.getByRole('button', { name: /자세 캡처/ }));
  await page.waitForSelector('.sheet-svg', { timeout: 90000 });
  await pause(900);
  // 내보내기 버튼을 보여 준 뒤 시트 전체가 보이게 내린다
  await moveToEl(page.getByRole('button', { name: 'PNG 저장' }), 0.5, 0.5, 900);
  await pause(1200);
  await moveTo(VIEWPORT.width * 0.55, VIEWPORT.height * 0.62, 800);
  await wheel(70, 6);
  await pause(2400);

  const frames = await stop();
  await browser.close();
  console.log(`프레임 ${frames.length}개, ${(frames[frames.length - 1].t - frames[0].t).toFixed(1)}초`);
  encode(frames);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
