import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';
import { config } from './config';

const ARGS = ['--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check'];

let browserPromise: Promise<Browser> | null = null;

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().then((b) => {
      b.on('disconnected', () => {
        browserPromise = null;
      });
      return b;
    });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  const w = webkitPromise;
  browserPromise = null;
  webkitPromise = null;
  await Promise.all([p, w].map(async (b) => (await b?.catch(() => null))?.close().catch(() => {})));
}

// ---------- WebKit(사파리 엔진) ----------

let webkitPromise: Promise<Browser> | null = null;

/** Playwright WebKit이 설치돼 있는지. FOLDLAB_WEBKIT=0이면 쓰지 않는다. */
export function webkitInstalled(): boolean {
  if (/^(0|false|off|no)$/i.test(process.env.FOLDLAB_WEBKIT ?? '')) return false;
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
}

export function getWebKit(): Promise<Browser> {
  if (!webkitPromise) {
    webkitPromise = webkit
      .launch()
      .then((b) => {
        b.on('disconnected', () => {
          webkitPromise = null;
        });
        return b;
      })
      .catch((err: Error) => {
        webkitPromise = null;
        throw new Error(
          'WebKit을 실행하지 못했습니다. `npx playwright install webkit`(리눅스는 `--with-deps`를 붙여서)을 실행한 뒤 서버를 다시 켜 주세요. ' +
            String(err.message).split('\n')[0],
        );
      });
  }
  return webkitPromise;
}

async function launch(): Promise<Browser> {
  if (config.chromiumPath) return chromium.launch({ executablePath: config.chromiumPath, args: ARGS });
  try {
    return await chromium.launch({ args: ARGS });
  } catch (err) {
    // Playwright 버전과 설치된 브라우저 리비전이 다를 때 캐시에 있는 다른 리비전을 쓴다
    const fallback = findInstalledChromium();
    if (!fallback) {
      throw new Error(
        'Chromium을 찾지 못했습니다. `npm run browsers`(npx playwright install chromium)를 실행하거나 FOLDLAB_CHROMIUM_PATH를 지정하세요.\n' +
          String((err as Error).message).split('\n')[0],
      );
    }
    console.warn(`[foldlab] Playwright 기본 브라우저가 없어 ${fallback}을(를) 사용합니다.`);
    return chromium.launch({ executablePath: fallback, args: ARGS });
  }
}

const CANDIDATES = [
  'chrome-headless-shell-linux64/chrome-headless-shell',
  'chrome-linux/headless_shell',
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-headless-shell-mac-arm64/chrome-headless-shell',
  'chrome-headless-shell-mac-x64/chrome-headless-shell',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-headless-shell-win64/chrome-headless-shell.exe',
  'chrome-win/chrome.exe',
  'chrome-win64/chrome.exe',
];

export function findInstalledChromium(): string | null {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : undefined,
  ].filter((r): r is string => !!r && existsSync(r));
  for (const root of roots) {
    const dirs = readdirSync(root)
      .map((name) => ({ name, m: /^chromium(_headless_shell)?-(\d+)$/.exec(name) }))
      .filter((d) => d.m)
      .sort((a, b) => Number(b.m![2]) - Number(a.m![2]) || (a.m![1] ? -1 : 1));
    for (const d of dirs) {
      for (const c of CANDIDATES) {
        const p = join(root, d.name, c);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}
