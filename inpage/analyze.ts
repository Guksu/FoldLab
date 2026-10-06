/**
 * 검사 대상 페이지 안(격리된 월드)에서 실행되는 분석기.
 * esbuild로 IIFE 하나로 묶여 CDP Runtime.evaluate로 주입된다. 바깥 모듈에 의존하면 안 된다(타입 제외).
 */
import type {
  Insets,
  Issue,
  Obstruction,
  PageEnv,
  Rect,
  RuleId,
  Severity,
  ViewportFit,
  ViewportFold,
} from '../shared/types';
import { RULES } from '../shared/rules';

export interface AnalyzeInput {
  postureId: string;
  /** 에뮬레이션된 뷰포트 크기(DIP) */
  viewport: { w: number; h: number };
  obstructions: Obstruction[];
  folds: ViewportFold[];
  mode: 'browser' | 'app';
  fit: ViewportFit;
  wide: boolean;
  twoSegments: boolean;
  rawInsets: Insets;
  apiUsage?: { segments: boolean; posture: boolean };
  /** 크롬 안드로이드 탭에서 스크롤하면 하단 chin이 사라져 제스처 영역 아래까지 그려지는지 */
  chinRisk?: boolean;
  maxPerRule?: number;
}

export interface AnalyzeOutput {
  issues: Issue[];
  env: PageEnv;
}

type Kind = 'interactive' | 'dialog' | 'media' | 'text';

interface Info {
  /** 자식에게 적용되는 잘림 영역(DIP). null이면 완전히 잘림 */
  clip: Rect | null;
  fixed: boolean;
  inInteractive: boolean;
  inSvg: boolean;
  transparent: boolean;
  /** overflow-x가 visible이 아닌 조상(html/body 제외) 아래인지 */
  xClipped: boolean;
  /** 가로로 뷰포트를 넘쳤는지(CSS px) */
  over: boolean;
}

interface Item {
  el: Element;
  kind: Kind;
  /** 잘리지 않은 박스(DIP) */
  box: Rect;
  /** 실제로 보이는 영역(DIP) */
  vis: Rect;
  fixed: boolean;
  cs: CSSStyleDeclaration;
}

const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
const DIALOG = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
const MEDIA = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT']);
const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'META',
  'LINK',
  'HEAD',
  'TITLE',
  'BR',
  'WBR',
  'OPTION',
  'OPTGROUP',
  'SOURCE',
  'TRACK',
  'PARAM',
  'AREA',
  'MAP',
]);
const MAX_ELEMENTS = 8000;
const MIN_TARGET = 24;

const HIDDEN: Info = {
  clip: null,
  fixed: false,
  inInteractive: false,
  inSvg: false,
  transparent: true,
  xClipped: true,
  over: false,
};

declare global {
  interface Window {
    __foldlabRefs?: Element[];
  }
}

function inter(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || btm <= y) return null;
  return { x, y, w: r - x, h: btm - y };
}

function union(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rs) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function round(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

function circleHits(r: Rect, c: Rect, margin = 1): boolean {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const rad = Math.min(c.w, c.h) / 2 + margin;
  const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < rad * rad;
}

function pillHits(r: Rect, p: Rect): boolean {
  if (!inter(r, p)) return false;
  const rad = Math.min(p.w, p.h) / 2;
  if (p.w >= p.h) {
    const core = { x: p.x + rad, y: p.y, w: p.w - 2 * rad, h: p.h };
    return (
      !!inter(r, core) ||
      circleHits(r, { x: p.x, y: p.y, w: 2 * rad, h: 2 * rad }) ||
      circleHits(r, { x: p.x + p.w - 2 * rad, y: p.y, w: 2 * rad, h: 2 * rad })
    );
  }
  const core = { x: p.x, y: p.y + rad, w: p.w, h: p.h - 2 * rad };
  return (
    !!inter(r, core) ||
    circleHits(r, { x: p.x, y: p.y, w: 2 * rad, h: 2 * rad }) ||
    circleHits(r, { x: p.x, y: p.y + p.h - 2 * rad, w: 2 * rad, h: 2 * rad })
  );
}

/** 둥근 모서리 곡선 바깥으로 depth px 이상 나갔는지 */
function cornerClips(r: Rect, o: Obstruction, depth = 2): boolean {
  const sq = o.rect;
  const rad = o.radius ?? sq.w;
  if (!inter(r, sq)) return false;
  // 모서리 꼭짓점에 가장 가까운 사각형의 점과 원 중심 사이 거리
  let px: number;
  let py: number;
  let cx: number;
  let cy: number;
  switch (o.corner) {
    case 'tl':
      px = Math.max(r.x, sq.x);
      py = Math.max(r.y, sq.y);
      cx = sq.x + rad;
      cy = sq.y + rad;
      break;
    case 'tr':
      px = Math.min(r.x + r.w, sq.x + sq.w);
      py = Math.max(r.y, sq.y);
      cx = sq.x + sq.w - rad;
      cy = sq.y + rad;
      break;
    case 'bl':
      px = Math.max(r.x, sq.x);
      py = Math.min(r.y + r.h, sq.y + sq.h);
      cx = sq.x + rad;
      cy = sq.y + sq.h - rad;
      break;
    default:
      px = Math.min(r.x + r.w, sq.x + sq.w);
      py = Math.min(r.y + r.h, sq.y + sq.h);
      cx = sq.x + sq.w - rad;
      cy = sq.y + sq.h - rad;
  }
  return Math.hypot(px - cx, py - cy) > rad + depth;
}

function hasOwnText(el: Element): boolean {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && /\S/.test(n.nodeValue ?? '')) return true;
  }
  return false;
}

function ownTextRects(el: Element): DOMRect[] {
  const out: DOMRect[] = [];
  const range = document.createRange();
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 3 || !/\S/.test(n.nodeValue ?? '')) continue;
    range.selectNodeContents(n);
    for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) out.push(r);
  }
  return out;
}

function ownTextLength(el: Element): number {
  let len = 0;
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) len += (n.nodeValue ?? '').trim().length;
  return len;
}

const HASHY = /(^|[-_])[a-z0-9]*\d[a-z0-9]{4,}$|^(css|sc|jsx|emotion|svelte)-|__[a-z0-9]{5,}$/i;

function cssPath(el: Element): string {
  const esc = (s: string) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  if (el.id && !HASHY.test(el.id)) {
    try {
      if (document.querySelectorAll('#' + esc(el.id)).length === 1) return '#' + esc(el.id);
    } catch {
      /* 잘못된 id */
    }
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== 'BODY' && cur.tagName !== 'HTML' && parts.length < 4) {
    let part = cur.tagName.toLowerCase();
    if (cur.id && !HASHY.test(cur.id)) {
      parts.unshift(part + '#' + esc(cur.id));
      break;
    }
    const cls = Array.from(cur.classList)
      .filter((c) => !HASHY.test(c))
      .slice(0, 2);
    if (cls.length) part += '.' + cls.map(esc).join('.');
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = parent;
  }
  return parts.join(' > ');
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const input = el as HTMLInputElement;
  let text =
    el.getAttribute('aria-label') ||
    el.getAttribute('alt') ||
    el.getAttribute('title') ||
    (typeof input.placeholder === 'string' ? input.placeholder : '') ||
    '';
  if (!text) text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  if (!text && typeof input.value === 'string' && tag === 'input') text = input.value;
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > 28) text = text.slice(0, 27) + '…';
  return text ? `<${tag}> “${text}”` : `<${tag}>`;
}

function isFixedChain(el: Element | null): Element | null {
  for (let cur = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
    const pos = getComputedStyle(cur).position;
    if (pos === 'fixed' || pos === 'sticky') return cur;
  }
  return null;
}

function readSafeArea(): Insets {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.documentElement.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return out;
}

function scanCss(): { safe: boolean; segments: boolean; posture: boolean; unreadable: number } {
  const res = { safe: false, segments: false, posture: false, unreadable: 0 };
  const test = (text: string) => {
    if (!res.safe && text.includes('safe-area-inset')) res.safe = true;
    if (!res.segments && /viewport-segment|screen-spanning|spanning\s*:/.test(text)) res.segments = true;
    if (!res.posture && text.includes('device-posture')) res.posture = true;
  };
  const walk = (rules: CSSRuleList, depth: number) => {
    if (depth > 6) return;
    for (const rule of Array.from(rules)) {
      const anyRule = rule as CSSRule & {
        conditionText?: string;
        cssRules?: CSSRuleList;
        media?: MediaList;
        style?: CSSStyleDeclaration;
      };
      if (anyRule.conditionText) test(anyRule.conditionText);
      else if (anyRule.media && anyRule.media.mediaText) test(anyRule.media.mediaText);
      // CSS 중첩을 지원하는 브라우저에서는 일반 스타일 규칙도 cssRules를 가지므로 선언부를 따로 본다
      if (anyRule.style) test(anyRule.style.cssText);
      if (anyRule.cssRules && anyRule.cssRules.length) walk(anyRule.cssRules, depth + 1);
    }
  };
  const sheets: CSSStyleSheet[] = Array.from(document.styleSheets);
  for (const root of [document, ...shadowRoots()]) {
    const adopted = (root as Document).adoptedStyleSheets;
    if (adopted) sheets.push(...adopted);
  }
  for (const sheet of sheets) {
    try {
      walk(sheet.cssRules, 0);
    } catch {
      res.unreadable++;
    }
  }
  if (!res.safe && document.querySelector('[style*="safe-area-inset"]')) res.safe = true;
  return res;
}

let shadowCache: ShadowRoot[] | null = null;
function shadowRoots(): ShadowRoot[] {
  return shadowCache ?? [];
}

export function analyze(input: AnalyzeInput): AnalyzeOutput {
  const vw = input.viewport.w;
  const vh = input.viewport.h;
  const VP: Rect = { x: 0, y: 0, w: vw, h: vh };
  const vv = window.visualViewport;
  const s = vv ? vv.scale : 1;
  const ox = vv ? vv.offsetLeft : 0;
  const oy = vv ? vv.offsetTop : 0;
  const toDip = (r: DOMRect): Rect => ({ x: (r.x - ox) * s, y: (r.y - oy) * s, w: r.width * s, h: r.height * s });
  const layoutW = document.documentElement.clientWidth;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const maxPerRule = input.maxPerRule ?? 12;

  const refs: Element[] = [];
  window.__foldlabRefs = refs;
  const issues: Issue[] = [];
  const perRule = new Map<RuleId, number>();
  const seen = new Set<string>();
  const aggregate = new Map<RuleId, { severity: Severity; rects: Rect[]; labels: string[]; fixed: boolean; refs: number[] }>();

  const refOf = (el: Element) => {
    let i = refs.indexOf(el);
    if (i < 0) i = refs.push(el) - 1;
    return i;
  };

  const add = (rule: RuleId, severity: Severity, el: Element | null, rects: Rect[], detail: string, fixed = false) => {
    const selector = el ? cssPath(el) : undefined;
    const id = `${rule}:${selector ?? issues.length}`;
    if (seen.has(id)) return;
    const n = perRule.get(rule) ?? 0;
    if (n >= maxPerRule) return;
    perRule.set(rule, n + 1);
    seen.add(id);
    const meta = RULES[rule];
    issues.push({
      id,
      rule,
      severity,
      title: meta.name,
      detail,
      hint: meta.hint,
      selector,
      label: el ? describe(el) : undefined,
      rects: rects.map(round),
      fixed,
      scroll: { x: scrollX, y: scrollY },
      ref: el ? refOf(el) : undefined,
    });
  };

  const addAgg = (rule: RuleId, severity: Severity, el: Element, rect: Rect, fixed: boolean) => {
    let a = aggregate.get(rule);
    if (!a) aggregate.set(rule, (a = { severity, rects: [], labels: [], fixed: true, refs: [] }));
    if (a.rects.length >= 30) return;
    a.rects.push(round(rect));
    a.labels.push(describe(el));
    a.fixed = a.fixed && fixed;
    a.refs.push(refOf(el));
  };

  // ---------- 요소 수집 ----------
  const items: Item[] = [];
  const fixedRoots: Array<{ el: Element; box: Rect; cs: CSSStyleDeclaration }> = [];
  const interactiveBoxes: Array<{ el: Element; box: Rect }> = [];
  const overflowOffenders: Element[] = [];
  const roots: ShadowRoot[] = [];
  const bodyInfo: Info = {
    clip: VP,
    fixed: false,
    inInteractive: false,
    inSvg: false,
    transparent: false,
    xClipped: false,
    over: false,
  };
  const stack: Array<[Element, Info]> = [];
  const pushChildren = (el: Element | ShadowRoot, info: Info) => {
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], info]);
  };
  if (document.body) pushChildren(document.body, bodyInfo);
  let visited = 0;

  while (stack.length && visited < MAX_ELEMENTS) {
    const [el, parent] = stack.pop()!;
    visited++;
    if (SKIP.has(el.tagName)) continue;
    if (parent === HIDDEN || parent.inSvg) {
      // svg 안쪽 도형이나 숨겨진 부모의 자식은 건너뛴다
      continue;
    }
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const pos = cs.position;
    const selfFixed = pos === 'fixed';
    const fixed = selfFixed || pos === 'sticky' || parent.fixed;
    const inherited = selfFixed ? VP : parent.clip;
    const raw = el.getBoundingClientRect();
    const box = toDip(raw);
    const clipsX = cs.overflowX !== 'visible';
    const clipsY = cs.overflowY !== 'visible';
    let clip = inherited;
    if (clip && (clipsX || clipsY || cs.contain.includes('paint'))) {
      const own: Rect = {
        x: clipsX ? box.x : -1e6,
        y: clipsY ? box.y : -1e6,
        w: clipsX ? box.w : 2e6,
        h: clipsY ? box.h : 2e6,
      };
      clip = inter(clip, own);
    }
    const interactive = el.matches(INTERACTIVE);
    const transparent = parent.transparent || cs.opacity === '0';
    const ownText = hasOwnText(el);
    let textRaw: DOMRect[] | null = null;
    // 고정 요소(헤더 등)는 넓어진 레이아웃 뷰포트를 따라 늘어날 뿐이라 원인에서 뺀다
    let over = false;
    if (!parent.xClipped && !fixed && raw.width > 0) {
      over = raw.right > layoutW + 1;
      if (!over && ownText && cs.display !== 'none') {
        textRaw = ownTextRects(el);
        over = textRaw.some((r) => r.right > layoutW + 1);
      }
    }
    if (over && !parent.over) overflowOffenders.push(el);
    const info: Info = {
      clip,
      fixed,
      inInteractive: parent.inInteractive || interactive,
      inSvg: el.tagName.toLowerCase() === 'svg',
      transparent,
      xClipped: parent.xClipped || (clipsX && !selfFixed),
      over,
    };
    pushChildren(el, info);
    if (el.shadowRoot) {
      roots.push(el.shadowRoot);
      pushChildren(el.shadowRoot, info);
    }

    if (transparent || cs.visibility === 'hidden' || box.w < 1 || box.h < 1 || !inherited) continue;
    const vis = inter(box, inherited);
    if (!vis) continue;
    if ((selfFixed || pos === 'sticky') && !parent.fixed) fixedRoots.push({ el, box: vis, cs });

    let kind: Kind | null = null;
    if (el.matches(DIALOG)) kind = 'dialog';
    else if (interactive && !parent.inInteractive) kind = 'interactive';
    else if (parent.inInteractive) kind = null;
    else if (MEDIA.has(el.tagName) || (info.inSvg && box.w >= 48 && box.h >= 48)) kind = 'media';
    else if (ownText) kind = 'text';
    if (!kind) continue;

    let target = vis;
    if (kind === 'text') {
      const tr = (textRaw ?? ownTextRects(el)).map(toDip);
      const u = union(tr);
      const tv = u ? inter(u, inherited) : null;
      if (!tv) continue;
      target = tv;
    }
    if (kind === 'interactive' && cs.pointerEvents !== 'none') interactiveBoxes.push({ el, box });
    items.push({ el, kind, box, vis: target, fixed, cs });
  }
  shadowCache = roots;

  // ---------- 문서 단위 검사 ----------
  const metaEl = document.querySelector('meta[name="viewport" i]');
  const metaContent = metaEl?.getAttribute('content') ?? null;
  const fitMatch = metaContent ? /viewport-fit\s*=\s*([a-z]+)/i.exec(metaContent) : null;
  const pageFit = (fitMatch?.[1]?.toLowerCase() as ViewportFit | undefined) ?? 'auto';
  const se = document.scrollingElement ?? document.documentElement;
  const cssUsage = scanCss();
  const usesSegments = cssUsage.segments || !!input.apiUsage?.segments;
  const usesPosture = cssUsage.posture || !!input.apiUsage?.posture;

  const hasDeviceWidth = !!metaContent && /width\s*=\s*device-width|initial-scale\s*=\s*1(\.0*)?(\D|$)/i.test(metaContent);
  if (!hasDeviceWidth && s < 0.95) {
    add(
      'viewport-meta',
      'high',
      null,
      [],
      `뷰포트 메타가 ${metaContent ? `"${metaContent}"` : '없어'} 화면 폭 ${vw}px 대신 ${Math.round(layoutW)}px로 그린 뒤 ${Math.round(s * 100)}%로 축소합니다.`,
    );
  }
  if (metaContent && (/user-scalable\s*=\s*(no|0)/i.test(metaContent) || /maximum-scale\s*=\s*(0?\.\d+|1(\.0*)?)(\D|$)/i.test(metaContent))) {
    add('zoom-disabled', 'warn', null, [], `viewport 메타 "${metaContent}"가 확대를 막습니다.`);
  }

  if (se.scrollWidth > layoutW + 1) {
    const offenders = overflowOffenders.slice(0, 4);
    const rects = offenders.map((el) => inter(toDip(el.getBoundingClientRect()), { x: -1e6, y: 0, w: 2e6, h: vh })).filter(Boolean) as Rect[];
    add(
      'h-overflow',
      // WCAG 1.4.10은 320px까지 가로 스크롤 없이 보여야 한다. 그보다 좁은 화면(분할 창 등)은 주의로 낮춘다
      vw < 320 ? 'warn' : 'high',
      offenders[0] ?? null,
      rects,
      `문서 폭 ${se.scrollWidth}px가 화면 ${Math.round(layoutW)}px보다 ${se.scrollWidth - Math.round(layoutW)}px 넓습니다.` +
        (offenders.length ? ` 넘친 요소: ${offenders.map((e) => describe(e)).join(', ')}` : ''),
    );
  }

  // ---------- 요소 단위 검사 ----------
  const undersized: Item[] = [];
  let contentUnion: Rect[] = [];

  for (const it of items) {
    const { el, kind, vis: t } = it;

    if (!it.fixed && kind !== 'dialog') contentUnion.push(t);

    // 접는 선 / 힌지
    for (const f of input.folds) {
      const vertical = f.axis === 'vertical';
      const a0 = vertical ? t.x : t.y;
      const a1 = vertical ? t.x + t.w : t.y + t.h;
      if (f.gap > 0) {
        const m0 = f.at - f.gap / 2;
        const m1 = f.at + f.gap / 2;
        const overlap = Math.min(a1, m1) - Math.max(a0, m0);
        if (overlap < 1) continue;
        const hiddenAll = a0 >= m0 && a1 <= m1;
        const detail = hiddenAll
          ? `힌지(${f.gap}px) 아래에 완전히 숨어 보이지 않습니다.`
          : `힌지(${f.gap}px) 아래로 ${Math.round(overlap)}px가 가려집니다.`;
        if (kind === 'interactive' || kind === 'dialog') add('hinge-hidden', 'high', el, [t], detail, it.fixed);
        else if (kind === 'text') addAgg('hinge-hidden', 'high', el, t, it.fixed);
        else if (overlap >= 8) addAgg('fold-media', 'warn', el, t, it.fixed);
        continue;
      }
      const left = f.at - a0;
      const right = a1 - f.at;
      const crosses = (min: number) => left >= min && right >= min;
      const transient = !vertical && !it.fixed;
      const nearZone = a1 > f.at - (vertical ? f.zone.w : f.zone.h) / 2 && a0 < f.at + (vertical ? f.zone.w : f.zone.h) / 2;
      if (kind === 'interactive') {
        if (f.separating && nearZone) {
          // 접는 선이 요소를 가르면 높음, 걸치지 않고 가까이만 있으면 주의
          const split = crosses(2);
          add(
            'fold-straddle',
            split && !transient ? 'high' : 'warn',
            el,
            [t],
            split
              ? `반쯤 접힌 화면의 접는 선이 요소를 ${Math.round(left)}px / ${Math.round(right)}px로 가릅니다.`
              : `접는 선에서 ${Math.round(Math.min(Math.abs(left), Math.abs(right)))}px 거리라 누르기 어렵습니다.`,
            it.fixed,
          );
        } else if (!f.separating && crosses(4)) {
          add(
            'fold-straddle',
            'warn',
            el,
            [t],
            `펼친 화면의 주름 위에 있습니다(${Math.round(left)}px / ${Math.round(right)}px). 반쯤 접으면 둘로 갈라집니다.`,
            it.fixed,
          );
        }
      } else if (kind === 'dialog' && crosses(24)) {
        add(
          'fold-straddle',
          f.separating ? 'high' : 'info',
          el,
          [t],
          f.separating ? '대화상자가 접는 선에 걸쳐 두 면으로 갈라집니다.' : '대화상자가 주름 위에 걸쳐 있습니다. 반쯤 접으면 갈라집니다.',
          it.fixed,
        );
      } else if (kind === 'text' && f.separating && !transient && crosses(8)) {
        addAgg('fold-text', 'warn', el, t, it.fixed);
      } else if (kind === 'media' && f.separating && !transient && crosses(24)) {
        addAgg('fold-media', 'warn', el, t, it.fixed);
      }
    }

    // 카메라 홀·시스템 바·둥근 모서리
    if (kind !== 'dialog' && kind !== 'media') {
      for (const o of input.obstructions) {
        if (o.kind === 'hinge' || o.kind === 'crease') continue;
        let hit = false;
        if (o.shape === 'circle') hit = circleHits(t, o.rect);
        else if (o.shape === 'pill') hit = pillHits(t, o.rect);
        else if (o.shape === 'corner') hit = cornerClips(t, o);
        else hit = !!inter(t, o.rect);
        if (!hit) continue;
        if (o.kind === 'cutout') {
          add('cutout-overlap', kind === 'interactive' ? 'high' : 'warn', el, [t], `${o.label}이(가) ${describe(el)}을(를) 덮습니다.`, it.fixed);
        } else if (o.kind === 'status-bar' || o.kind === 'nav-bar') {
          const i = inter(t, o.rect)!;
          const depth = i.h;
          if (depth < Math.min(6, t.h * 0.25)) continue;
          const rule: RuleId = o.kind === 'status-bar' ? 'status-bar-overlap' : 'nav-bar-overlap';
          add(rule, kind === 'interactive' ? 'high' : 'warn', el, [t], `${o.label}에 ${Math.round(depth)}px 겹칩니다.`, it.fixed);
        } else if (o.kind === 'corner') {
          add('corner-clip', 'warn', el, [t], '화면 모서리 곡선에 걸려 일부가 잘려 보입니다.', it.fixed);
        }
      }
    }

    if (kind === 'interactive') {
      // 작은 터치 영역
      const inlineLink =
        el.tagName === 'A' && it.cs.display === 'inline' && !!el.parentElement && ownTextLength(el.parentElement) > 0;
      if (!inlineLink && (it.box.w < MIN_TARGET || it.box.h < MIN_TARGET) && !(el as HTMLButtonElement).disabled) undersized.push(it);

      // 가려짐 검사
      const cx = t.x + t.w / 2;
      const cy = t.y + t.h / 2;
      if (cx > 0 && cy > 0 && cx < vw && cy < vh) {
        const hitEl = document.elementFromPoint(cx / s + ox, cy / s + oy);
        if (hitEl && hitEl !== el && !el.contains(hitEl) && !hitEl.contains(el) && !(hitEl instanceof HTMLLabelElement && hitEl.control === el)) {
          const coverRoot = isFixedChain(hitEl);
          if (coverRoot) {
            const cover = coverRoot.getBoundingClientRect();
            const elR = el.getBoundingClientRect();
            const maxScroll = Math.max(0, se.scrollHeight - window.innerHeight);
            let stuck = it.fixed;
            if (!stuck && cover.bottom >= window.innerHeight - 2) {
              // 맨 아래까지 스크롤해도 하단 고정 바 아래에 남는가
              const centerAtMax = elR.top + elR.height / 2 - (maxScroll - scrollY);
              stuck = centerAtMax > cover.top;
            } else if (!stuck && cover.top <= 2) {
              const centerAtTop = elR.top + scrollY + elR.height / 2;
              stuck = centerAtTop < cover.bottom;
            }
            if (stuck) {
              add('obscured', 'high', el, [t], `${describe(coverRoot)}에 가려져 ${it.fixed ? '' : '스크롤해도 '}누를 수 없습니다.`, it.fixed);
            }
          } else if (hitEl.closest(INTERACTIVE)) {
            add('obscured', 'warn', el, [t], `${describe(hitEl.closest(INTERACTIVE)!)}와(과) 겹쳐 엉뚱한 요소가 눌립니다.`, it.fixed);
          }
        }
      }
    }

    if (kind === 'text' && input.wide) {
      // 한 줄 글자 수: 라틴 80자·한중일 40자 넘으면 참고, 120자·60자 넘으면 주의(WCAG 1.4.8, Android Studio)
      const fs = parseFloat(it.cs.fontSize) || 16;
      const lh = parseFloat(it.cs.lineHeight) || fs * 1.5;
      const lines = Math.max(1, Math.round(t.h / s / lh));
      // 직접 가진 텍스트만 센다(자식 블록 텍스트까지 세면 과대평가된다)
      let text = '';
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) text += n.nodeValue ?? '';
        else if (n.nodeType === 1 && getComputedStyle(n as Element).display.startsWith('inline')) text += (n as Element).textContent ?? '';
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (lines >= 2 && text.length > 60) {
        const cjk = (text.match(/[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u3400-\u9fff\uac00-\ud7af]/g)?.length ?? 0) / text.length >= 0.3;
        // 마지막 줄은 짧을 수 있어 꽉 찬 줄 기준으로 센다
        const perLine = text.length / Math.max(1, lines - 0.5);
        const [infoAt, warnAt] = cjk ? [40, 60] : [80, 120];
        if (perLine > warnAt) addAgg('line-length', 'warn', el, t, it.fixed);
        else if (perLine > infoAt) addAgg('line-length', 'info', el, t, it.fixed);
      }
    }

    // 화면 밖으로 잘린 텍스트(가로 스크롤이 막힌 경우)
    if (kind === 'text' && se.scrollWidth <= layoutW + 1) {
      const full = union(ownTextRects(el).map(toDip));
      if (full && (full.x + full.w > vw + 4 || full.x < -4) && !it.fixed) addAgg('text-cut', 'warn', el, t, it.fixed);
    }
  }

  // WCAG 2.5.8: 24px 원이 다른 대상과 겹치지 않으면 예외
  for (const it of undersized) {
    const c = { x: it.box.x + it.box.w / 2 - 12, y: it.box.y + it.box.h / 2 - 12, w: 24, h: 24 };
    const crowded = interactiveBoxes.some(
      (o) => o.el !== it.el && !o.el.contains(it.el) && !it.el.contains(o.el) && circleHits(o.box, c, 0),
    );
    if (crowded) addAgg('tap-target', 'warn', it.el, it.vis, it.fixed);
  }

  // 넓은 화면 활용
  if (input.wide && contentUnion.length >= 6) {
    contentUnion = contentUnion.filter((r) => r.w < vw * 0.98);
    const u = union(contentUnion);
    if (u && u.w < vw * 0.55) {
      add(
        'wide-unused',
        'info',
        null,
        [u],
        `콘텐츠가 ${Math.round(u.w)}px 폭에만 있고 화면 ${vw}px의 ${Math.round((1 - u.w / vw) * 100)}%가 비어 있습니다.`,
      );
    }
  }

  // ---------- 고정 요소 ----------
  const vpArea = vw * vh;
  const layers = fixedRoots.filter(({ el, box, cs }) => {
    const z = parseInt(cs.zIndex, 10);
    return !el.matches(DIALOG) && !(z < 0) && box.w * box.h < vpArea * 0.9;
  });
  if (layers.length) {
    // 8px 격자로 겹친 부분을 한 번만 센다
    const cell = 8;
    const cols = Math.ceil(vw / cell);
    const rows = Math.ceil(vh / cell);
    const grid = new Uint8Array(cols * rows);
    for (const { box } of layers) {
      for (let y = Math.max(0, Math.floor(box.y / cell)); y < Math.min(rows, Math.ceil((box.y + box.h) / cell)); y++) {
        for (let x = Math.max(0, Math.floor(box.x / cell)); x < Math.min(cols, Math.ceil((box.x + box.w) / cell)); x++) grid[y * cols + x] = 1;
      }
    }
    const ratio = grid.reduce((a, b) => a + b, 0) / grid.length;
    if (ratio > 0.3) {
      const short = vh < 480;
      add(
        'sticky-overload',
        short ? (ratio > 0.5 ? 'high' : 'warn') : 'info',
        null,
        layers.map((l) => l.box),
        `고정 요소가 화면의 ${Math.round(ratio * 100)}%를 늘 덮습니다(화면 높이 ${vh}px).`,
        true,
      );
    }
  }

  for (const { el, box } of fixedRoots) {
    if (box.w * box.h < vpArea * 0.8) continue;
    const text = ((el as HTMLElement).innerText ?? '').slice(0, 400);
    if (/회전|돌려\s*주|가로\s*모드|세로\s*모드|세로로|가로로|rotate|portrait|landscape/i.test(text)) {
      add('orientation-lock', 'high', el, [box], `화면 대부분을 덮는 안내가 있습니다: “${text.replace(/\s+/g, ' ').trim().slice(0, 40)}”`, true);
    }
  }

  for (const { el, box, cs } of fixedRoots) {
    if (box.h < vh * 0.4 || el.matches(DIALOG + ',[role="presentation"]') === false && box.w < vw * 0.5) continue;
    const ov = cs.overflowY;
    if (ov === 'auto' || ov === 'scroll' || ov === 'overlay') continue;
    const he = el as HTMLElement;
    const contentBottom = box.y + he.scrollHeight * s;
    if (contentBottom <= vh + 4 || he.scrollHeight <= he.clientHeight + 4 && ov !== 'visible') continue;
    const scroller = Array.from(el.querySelectorAll('*')).some((c) => {
      const o = getComputedStyle(c).overflowY;
      return (o === 'auto' || o === 'scroll') && (c as HTMLElement).scrollHeight > (c as HTMLElement).clientHeight + 4;
    });
    if (!scroller) {
      add(
        'overlay-unscrollable',
        'high',
        el,
        [box],
        `고정된 영역의 내용이 화면 아래로 ${Math.round(contentBottom - vh)}px 넘치지만 스크롤할 수 없습니다.`,
        true,
      );
    }
  }

  // ---------- 크롬 135+ 하단 chin ----------
  if (input.chinRisk && !cssUsage.safe) {
    for (const { el, box } of fixedRoots) {
      if (box.y + box.h < vh - 2 || box.h > vh * 0.5 || !el.querySelector(INTERACTIVE) && !el.matches(INTERACTIVE)) continue;
      add('bottom-chin', 'warn', el, [box], '스크롤하면 하단 막대가 사라지면서 이 고정 요소가 제스처 영역(안드로이드 내비게이션 바)에 가려집니다.', true);
    }
  }

  const anyRaw = input.rawInsets.top + input.rawInsets.right + input.rawInsets.bottom + input.rawInsets.left > 0;
  if (input.mode === 'app' && anyRaw) {
    if (input.fit === 'cover' && !cssUsage.safe) {
      add('safe-area-unused', 'warn', null, [], 'env(safe-area-inset-*)를 쓰는 CSS가 없어 가장자리 요소가 시스템 UI에 가려질 수 있습니다.');
    } else if (input.fit !== 'cover') {
      add('letterbox', 'info', null, [], '화면 가장자리(상태 표시줄·카메라·제스처 영역)는 비워 둔 채 그립니다.');
    }
  }

  if (input.twoSegments && !usesSegments && !usesPosture) {
    add(
      'segments-unaware',
      'info',
      null,
      [],
      `두 세그먼트 자세지만 viewport-segments·device-posture를 쓰는 코드를 찾지 못했습니다${cssUsage.unreadable ? ` (읽을 수 없는 외부 CSS ${cssUsage.unreadable}개 제외)` : ''}.`,
    );
  }

  for (const [rule, a] of aggregate) {
    const meta = RULES[rule];
    const unique = Array.from(new Set(a.labels));
    issues.push({
      id: `${rule}:agg`,
      rule,
      severity: a.severity,
      title: `${meta.name} ${a.rects.length}개`,
      detail: `${meta.description} 예: ${unique.slice(0, 3).join(', ')}${unique.length > 3 ? ` 외 ${unique.length - 3}개` : ''}`,
      hint: meta.hint,
      rects: a.rects,
      fixed: a.fixed,
      scroll: { x: scrollX, y: scrollY },
      count: a.rects.length,
      ref: a.refs[0],
    });
  }

  const order: Record<Severity, number> = { high: 0, warn: 1, info: 2 };
  issues.sort((a, b) => {
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    const ra = a.rects[0];
    const rb = b.rects[0];
    if (!ra || !rb) return ra ? -1 : rb ? 1 : 0;
    return ra.y - rb.y || ra.x - rb.x;
  });

  const seg = (window as unknown as { viewport?: { segments?: DOMRect[] } }).viewport?.segments ?? [];
  const nav = navigator as Navigator & { devicePosture?: { type: string } };
  const env: PageEnv = {
    url: location.href,
    title: document.title,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: se.scrollWidth,
    scrollHeight: se.scrollHeight,
    scrollX,
    scrollY,
    dpr: window.devicePixelRatio,
    viewportMeta: metaContent,
    viewportFit: pageFit === 'cover' || pageFit === 'contain' ? pageFit : 'auto',
    safeArea: readSafeArea(),
    segments: Array.from(seg).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })),
    posture: nav.devicePosture?.type ?? null,
    usesSafeArea: cssUsage.safe,
    usesSegments,
    usesPosture,
    unreadableSheets: cssUsage.unreadable,
    scale: s,
    media: {
      horizontalSegments2: matchMedia('(horizontal-viewport-segments: 2)').matches,
      verticalSegments2: matchMedia('(vertical-viewport-segments: 2)').matches,
      postureFolded: matchMedia('(device-posture: folded)').matches,
    },
  };

  return { issues, env };
}

/** 이슈 요소를 화면 가운데로 스크롤한다 */
export function reveal(ref: number): boolean {
  const el = window.__foldlabRefs?.[ref];
  if (!el || !el.isConnected) return false;
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  return true;
}

// ---------- 자세 전환 연속성 ----------

interface Snap {
  inputs: Array<{ ref: number; value: string; key: string }>;
  anchor: { ref: number; top: number; text: string } | null;
  videos: Array<{ ref: number; t: number }>;
}

declare global {
  interface Window {
    __foldlabSnap?: { refs: Element[]; data: Snap };
  }
}

export interface ContinuityFinding {
  severity: Severity;
  detail: string;
  label?: string;
  selector?: string;
  rect?: Rect;
}

const TEXTUAL =
  'input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="tel"],input[type="url"],input[type="number"],textarea';

function dipRect(el: Element): Rect {
  const vv = window.visualViewport;
  const s = vv ? vv.scale : 1;
  const r = el.getBoundingClientRect();
  return round({ x: (r.x - (vv?.offsetLeft ?? 0)) * s, y: (r.y - (vv?.offsetTop ?? 0)) * s, w: r.width * s, h: r.height * s });
}

/** 자세를 바꾸기 직전 상태(입력값, 보던 위치, 재생 중인 동영상)를 기록한다 */
export function snapshot(): boolean {
  const refs: Element[] = [];
  const ref = (el: Element) => refs.push(el) - 1;
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(TEXTUAL))
    .filter((el) => !!el.value)
    .slice(0, 20)
    .map((el) => ({ ref: ref(el), value: el.value, key: el.getAttribute('name') || el.id || '' }));
  let anchor: Snap['anchor'] = null;
  if (window.scrollY > 50) {
    let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.35);
    // 글자가 있는 블록까지 올라간다
    while (el && el !== document.body && ((el as HTMLElement).innerText ?? '').trim().length < 8) el = el.parentElement;
    if (el && el !== document.body && el !== document.documentElement) {
      anchor = {
        ref: ref(el),
        top: el.getBoundingClientRect().top,
        text: ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
      };
    }
  }
  const videos = Array.from(document.querySelectorAll('video'))
    .filter((v) => !v.paused && !v.ended)
    .slice(0, 5)
    .map((v) => ({ ref: ref(v), t: v.currentTime }));
  window.__foldlabSnap = { refs, data: { inputs, anchor, videos } };
  return true;
}

/** snapshot() 이후 달라진 점. 기록 자체가 없으면(문서가 새로 로드됨) null */
export function compareSnapshot(): ContinuityFinding[] | null {
  const snap = window.__foldlabSnap;
  if (!snap) return null;
  const { refs, data } = snap;
  const out: ContinuityFinding[] = [];
  for (const i of data.inputs) {
    const el = refs[i.ref] as HTMLInputElement;
    if (el.isConnected && el.value === i.value) continue;
    // 다시 그려졌더라도 같은 이름의 입력이 값을 이어받았으면 괜찮다
    let same: HTMLInputElement | null = null;
    if (i.key) {
      try {
        same = document.querySelector(`[name="${CSS.escape(i.key)}"],#${CSS.escape(i.key)}`);
      } catch {
        same = null;
      }
    }
    if (same && same.value === i.value) continue;
    const target = el.isConnected ? el : same;
    out.push({
      severity: 'high',
      detail: `입력해 둔 값 “${i.value.slice(0, 20)}”이(가) 사라졌습니다.`,
      label: target ? describe(target) : undefined,
      selector: target ? cssPath(target) : undefined,
      rect: target ? dipRect(target) : undefined,
    });
  }
  if (data.anchor) {
    const el = refs[data.anchor.ref];
    if (!el.isConnected) {
      out.push({ severity: 'warn', detail: `보던 콘텐츠(“${data.anchor.text}”)가 다시 그려져 스크롤 위치를 잃었습니다.` });
    } else {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) {
        out.push({
          severity: 'warn',
          detail: `보던 콘텐츠(“${data.anchor.text}”)가 화면 밖으로 밀려나 스크롤 위치를 잃었습니다.`,
          label: describe(el),
          selector: cssPath(el),
        });
      }
    }
  }
  for (const v of data.videos) {
    const el = refs[v.ref] as HTMLVideoElement;
    if (!el.isConnected || el.paused) out.push({ severity: 'warn', detail: '재생 중이던 동영상이 멈췄습니다.', label: el.isConnected ? describe(el) : '<video>' });
    else if (el.currentTime + 0.5 < v.t) out.push({ severity: 'warn', detail: '동영상이 처음으로 돌아갔습니다.', label: describe(el) });
  }
  return out;
}
