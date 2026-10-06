/**
 * WebKit에는 안전 영역을 흉내 내는 기능이 없다.
 * 그래서 페이지 CSS의 env(safe-area-inset-*)를 우리가 값을 바꿀 수 있는 사용자 정의 속성으로 바꿔 넣는다.
 *   env(safe-area-inset-top, 20px) → var(--foldlab-safe-area-inset-top, env(safe-area-inset-top, 20px))
 * 원래 식은 대체값으로 남겨 두므로 속성이 아직 없을 때도 페이지가 의도한 값이 된다.
 */

const VAR_PREFIX = '--foldlab-safe-area-inset-';
const PATTERN = /\b(env|constant)\(\s*safe-area-inset-(top|right|bottom|left)\b/gi;

export type SafeAreaInsets = { top: number; right: number; bottom: number; left: number };

export function rewriteSafeArea(css: string): string {
  if (!css || css.indexOf('safe-area-inset') === -1) return css;
  PATTERN.lastIndex = 0;
  let out = '';
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = PATTERN.exec(css))) {
    const start = m.index;
    const open = start + m[1].length;
    // 이미 바꾼 식(우리 var()의 대체값 자리)은 건너뛰어 여러 번 돌려도 같은 결과가 나오게 한다
    if (/--foldlab-safe-area-inset-(top|right|bottom|left)\s*,\s*$/i.test(css.slice(Math.max(0, start - 48), start))) continue;
    let depth = 0;
    let end = -1;
    for (let j = open; j < css.length; j++) {
      const ch = css[j];
      if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end === -1) break;
    const original = css.slice(start, end + 1);
    out += css.slice(from, start) + `var(${VAR_PREFIX}${m[2].toLowerCase()}, ${original})`;
    from = end + 1;
    PATTERN.lastIndex = from;
  }
  return out + css.slice(from);
}

/**
 * 페이지(메인 월드)에 심는 부분. 문서 시작 때 실행된다.
 * - <style>·style 속성·CSSOM(insertRule, replace, setProperty, cssText)·섀도 루트의 CSS를 바꿔 넣는다
 * - 외부 CSS 파일은 서버가 응답을 가로채 같은 함수로 바꾼다
 * - 현재 자세의 안전 영역 값은 window.__foldlabSafeArea.set()으로 :root에 건다
 */
export function installSafeAreaShim(): void {
  const w = window as unknown as { __foldlabSafeArea?: { set(i: SafeAreaInsets): void; insets: SafeAreaInsets } };
  if (w.__foldlabSafeArea) return;
  const state = { insets: { top: 0, right: 0, bottom: 0, left: 0 } as SafeAreaInsets, set: (_: SafeAreaInsets) => {} };
  w.__foldlabSafeArea = state;

  const applyVars = (): boolean => {
    const root = document.documentElement;
    if (!root) return false;
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) root.style.setProperty(VAR_PREFIX + edge, `${state.insets[edge]}px`);
    return true;
  };
  state.set = (insets) => {
    state.insets = { ...insets };
    applyVars();
  };

  /** 바꿀 식이 남아 있으면 바꾼 글을, 없으면 null을 돌려준다. 이미 바꾼 부분은 그대로 두므로 섞여 있어도 된다. */
  const rewrite = (text: string | null): string | null => {
    if (!text || text.indexOf('safe-area-inset') === -1) return null;
    const next = rewriteSafeArea(text);
    return next === text ? null : next;
  };
  // <style>은 글 조각(텍스트 노드)마다 바꾼다. CSS-in-JS가 조각을 덧붙여 가거나 쥐고 있는 조각을 고쳐 써도 깨지지 않는다.
  const fixText = (node: Node) => {
    const next = rewrite(node.nodeValue);
    if (next !== null) node.nodeValue = next;
  };
  const fixStyle = (el: Element) => {
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) fixText(n);
    });
  };
  const fixInline = (el: Element) => {
    const next = rewrite(el.getAttribute('style'));
    if (next !== null) el.setAttribute('style', next);
  };
  const scan = (root: ParentNode) => {
    root.querySelectorAll('style').forEach(fixStyle);
    root.querySelectorAll('[style*="safe-area-inset"]').forEach(fixInline);
  };
  const observe = (root: Node) =>
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          fixInline(r.target as Element);
        } else if (r.type === 'characterData') {
          const p = r.target.parentNode;
          if (p && p.nodeName === 'STYLE') fixText(r.target);
        } else {
          r.addedNodes.forEach((n) => {
            if (n.nodeType === 3) {
              const p = n.parentNode;
              if (p && p.nodeName === 'STYLE') fixText(n);
            } else if (n.nodeType === 1) {
              const el = n as Element;
              if (el.nodeName === 'STYLE') fixStyle(el);
              else {
                fixInline(el);
                scan(el);
              }
            }
          });
        }
      }
    }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
  observe(document);

  const sheet = CSSStyleSheet.prototype as CSSStyleSheet & { replace?: (t: string) => Promise<CSSStyleSheet>; replaceSync?: (t: string) => void };
  const insertRule = sheet.insertRule;
  sheet.insertRule = function (rule: string, index?: number) {
    return insertRule.call(this, typeof rule === 'string' ? rewriteSafeArea(rule) : rule, index);
  };
  if (sheet.replace) {
    const replace = sheet.replace;
    sheet.replace = function (text: string) {
      return replace.call(this, typeof text === 'string' ? rewriteSafeArea(text) : text);
    };
  }
  if (sheet.replaceSync) {
    const replaceSync = sheet.replaceSync;
    sheet.replaceSync = function (text: string) {
      return replaceSync.call(this, typeof text === 'string' ? rewriteSafeArea(text) : text);
    };
  }
  const decl = CSSStyleDeclaration.prototype;
  const setProperty = decl.setProperty;
  decl.setProperty = function (name: string, value: string | null, priority?: string) {
    return setProperty.call(this, name, typeof value === 'string' ? rewriteSafeArea(value) : value, priority);
  };
  const cssText = Object.getOwnPropertyDescriptor(decl, 'cssText');
  if (cssText?.set) {
    Object.defineProperty(decl, 'cssText', {
      ...cssText,
      set(v: string) {
        cssText.set!.call(this, typeof v === 'string' ? rewriteSafeArea(v) : v);
      },
    });
  }
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    const root = attachShadow.call(this, init);
    observe(root);
    return root;
  };

  if (!applyVars()) {
    new MutationObserver((_, o) => {
      if (applyVars()) o.disconnect();
    }).observe(document, { childList: true });
  }
}
