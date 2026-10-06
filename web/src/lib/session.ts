import { decodeFrame, type ClientMessage, type FrameHeader, type ServerMessage } from '../../../shared/protocol';

export type Frame = { header: FrameHeader; jpeg: Uint8Array };

type Events = {
  message: ServerMessage;
  frame: Frame;
  status: ConnectionStatus;
};

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

type Handler<T> = (value: T) => void;

/** FoldLab 서버와의 웹소켓 연결. 끊기면 다음 send 때 다시 연결한다. */
export class FoldLabClient {
  private ws: WebSocket | null = null;
  private handlers: { [K in keyof Events]: Set<Handler<Events[K]>> } = {
    message: new Set(),
    frame: new Set(),
    status: new Set(),
  };
  private pending: ClientMessage[] = [];
  status: ConnectionStatus = 'idle';

  on<K extends keyof Events>(event: K, fn: Handler<Events[K]>): () => void {
    this.handlers[event].add(fn);
    return () => this.handlers[event].delete(fn);
  }

  private emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const fn of this.handlers[event]) fn(value);
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.emit('status', s);
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      this.setStatus('open');
      const queued = this.pending;
      this.pending = [];
      for (const m of queued) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        this.emit('frame', decodeFrame(ev.data));
        return;
      }
      try {
        this.emit('message', JSON.parse(ev.data as string) as ServerMessage);
      } catch {
        /* 무시 */
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.setStatus('closed');
      }
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    // 입력 이벤트는 연결이 없으면 버린다
    if (msg.t === 'touch' || msg.t === 'wheel' || msg.t === 'key' || msg.t === 'text') return;
    this.pending.push(msg);
    this.connect();
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
