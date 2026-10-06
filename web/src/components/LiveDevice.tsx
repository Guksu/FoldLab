import { useEffect, useId, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import type { Analysis, DeviceSpec, Issue, Layout } from '../../../shared/types';
import { shiftRects } from '../lib/format';
import type { FoldLabClient } from '../lib/session';
import { DebugOverlay, DeviceBase, DeviceDefs, DeviceTop, frameBox, type OverlayToggles } from './DeviceArt';

interface Props {
  client: FoldLabClient;
  device: DeviceSpec;
  layout: Layout;
  url: string;
  live: boolean;
  analysis: Analysis | null;
  selectedId: string | null;
  numbering: Map<string, number>;
  debug: boolean;
  toggles: OverlayToggles;
  maxWidth: number;
  maxHeight: number;
  placeholder?: string;
}

const PRINTABLE_SKIP = new Set(['Process', 'Unidentified', 'Dead', 'HangulMode', 'HanjaMode', 'Lang1', 'Lang2']);

export function LiveDevice(props: Props) {
  const { client, device, layout, url, live, analysis, debug, toggles, maxWidth, maxHeight } = props;
  const uid = useId().replace(/:/g, '');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<HTMLDivElement>(null);
  const sinkRef = useRef<HTMLTextAreaElement>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0, scale: 1 });
  const [hasFrame, setHasFrame] = useState(false);
  const pressed = useRef(false);
  const vp = layout.viewport;
  const box = frameBox(device, layout);
  const zoom = Math.max(0.2, Math.min(1.15, maxWidth / box.w, maxHeight / box.h));

  // 화면 프레임 그리기: 디코딩 중에 들어온 프레임은 가장 최신 것만 남긴다
  useEffect(() => {
    if (!live) {
      setHasFrame(false);
      return;
    }
    let decoding = false;
    let next: { jpeg: Uint8Array; sx: number; sy: number; scale: number } | null = null;
    const draw = async () => {
      if (decoding || !next) return;
      decoding = true;
      const job = next;
      next = null;
      try {
        const bitmap = await createImageBitmap(new Blob([job.jpeg as BlobPart], { type: 'image/jpeg' }));
        const c = canvasRef.current;
        if (c) {
          if (c.width !== bitmap.width || c.height !== bitmap.height) {
            c.width = bitmap.width;
            c.height = bitmap.height;
          }
          c.getContext('2d')?.drawImage(bitmap, 0, 0);
          setHasFrame(true);
          setScroll((prev) => (prev.x === job.sx && prev.y === job.sy && prev.scale === job.scale ? prev : { x: job.sx, y: job.sy, scale: job.scale }));
        }
        bitmap.close();
      } catch {
        /* 깨진 프레임은 버린다 */
      } finally {
        decoding = false;
        if (next) void draw();
      }
    };
    return client.on('frame', ({ header, jpeg }) => {
      next = { jpeg, sx: header.scrollX, sy: header.scrollY, scale: header.pageScale };
      void draw();
    });
  }, [client, live]);

  // 휠은 passive가 아닌 리스너여야 기본 스크롤을 막을 수 있다
  useEffect(() => {
    const el = captureRef.current;
    if (!el || !live) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? r.height : 1;
      client.send({
        t: 'wheel',
        x: ((e.clientX - r.left) / r.width) * vp.w,
        y: ((e.clientY - r.top) / r.height) * vp.h,
        dx: e.deltaX * unit,
        dy: e.deltaY * unit,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [client, live, vp.w, vp.h]);

  const point = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(vp.w - 0.5, ((e.clientX - r.left) / r.width) * vp.w)),
      y: Math.max(0, Math.min(vp.h - 0.5, ((e.clientY - r.top) / r.height) * vp.h)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!live || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pressed.current = true;
    sinkRef.current?.focus({ preventScroll: true });
    client.send({ t: 'touch', phase: 'start', ...point(e) });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pressed.current) return;
    client.send({ t: 'touch', phase: 'move', ...point(e) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!pressed.current) return;
    pressed.current = false;
    client.send({ t: 'touch', phase: e.type === 'pointercancel' ? 'cancel' : 'end', ...point(e) });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || PRINTABLE_SKIP.has(e.key)) return;
    e.preventDefault();
    client.send({ t: 'key', phase: 'down', key: e.key, code: e.code, modifiers: 0 });
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || PRINTABLE_SKIP.has(e.key)) return;
    e.preventDefault();
    client.send({ t: 'key', phase: 'up', key: e.key, code: e.code, modifiers: 0 });
  };
  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    if (e.data) client.send({ t: 'text', text: e.data });
    e.currentTarget.value = '';
  };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (text) client.send({ t: 'text', text });
    e.preventDefault();
  };

  const issues: Issue[] = analysis && analysis.postureId === layout.postureId
    ? analysis.issues.map((i) => ({ ...i, rects: shiftRects(i, scroll, scroll.scale) }))
    : [];

  const W = box.w * zoom;
  const H = box.h * zoom;
  const vpStyle = {
    left: (vp.x - box.x) * zoom,
    top: (vp.y - box.y) * zoom,
    width: vp.w * zoom,
    height: vp.h * zoom,
  };

  return (
    <div className="live-device" style={{ width: W, height: H }}>
      <svg className="layer" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} width={W} height={H} aria-hidden>
        <DeviceDefs uid={uid} />
        <DeviceBase device={device} layout={layout} url={url} uid={uid} />
      </svg>
      <canvas ref={canvasRef} className="screen" style={{ ...vpStyle, opacity: live && hasFrame ? 1 : 0 }} />
      {(!live || !hasFrame) && (
        <div className="screen-placeholder" style={vpStyle}>
          {live || props.placeholder ? <span className="spinner" aria-hidden /> : <Globe size={24} aria-hidden />}
          <span>{props.placeholder ?? (live ? '화면을 받는 중…' : '주소를 열면 여기에 화면이 나타납니다')}</span>
        </div>
      )}
      <svg className="layer" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} width={W} height={H} aria-hidden>
        <DeviceTop device={device} layout={layout} uid={uid} revealHinge={debug && toggles.zones} />
        {debug && live && (
          <DebugOverlay
            layout={layout}
            analysis={analysis && analysis.postureId === layout.postureId ? analysis : null}
            issues={issues}
            selectedId={props.selectedId}
            show={toggles}
            uid={uid}
            labelScale={Math.min(2.2, Math.max(1, 0.9 / zoom))}
            numbering={props.numbering}
          />
        )}
        {debug && !live && (
          <DebugOverlay layout={layout} analysis={null} issues={[]} show={{ ...toggles, issues: false }} uid={uid} labelScale={Math.min(2.2, Math.max(1, 0.9 / zoom))} />
        )}
      </svg>
      <div
        ref={captureRef}
        className={`input-capture${live ? ' live' : ''}`}
        style={vpStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <textarea
          ref={sinkRef}
          className="ime-sink"
          aria-label="기기 화면 입력"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onCompositionEnd={onCompositionEnd}
          onPaste={onPaste}
        />
      </div>
    </div>
  );
}
