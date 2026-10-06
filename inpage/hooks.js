// 페이지 메인 월드에 주입: 폴더블 API 사용 여부만 기록한다(동작은 바꾸지 않는다).
(() => {
  const KEY = '__foldlabApiUsage';
  if (window[KEY]) return;
  const usage = { segments: false, posture: false };
  Object.defineProperty(window, KEY, { value: usage, enumerable: false });
  const wrapGetter = (proto, prop, flag) => {
    try {
      const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.get || !d.configurable) return;
      Object.defineProperty(proto, prop, {
        ...d,
        get() {
          usage[flag] = true;
          return d.get.call(this);
        },
      });
    } catch {}
  };
  if (typeof Viewport !== 'undefined') wrapGetter(Viewport.prototype, 'segments', 'segments');
  wrapGetter(Navigator.prototype, 'devicePosture', 'posture');
  try {
    const mm = window.matchMedia;
    window.matchMedia = function (q) {
      const s = String(q);
      if (/viewport-segments|spanning/.test(s)) usage.segments = true;
      if (/device-posture/.test(s)) usage.posture = true;
      return mm.call(this, q);
    };
  } catch {}
})();
