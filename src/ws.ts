// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function acceptKey(key: string): string {
  return createHash("sha1").update(key + HANDSHAKE_GUID).digest("base64");
}

export const OPCODE = { continuation: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 } as const;

export interface Frame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

export function encodeFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, payload]);
}

export function encodeText(text: string): Buffer {
  return encodeFrame(OPCODE.text, Buffer.from(text, "utf8"));
}

export function encodeClose(code = 1000, reason = ""): Buffer {
  const text = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  return encodeFrame(OPCODE.close, payload);
}

export const MAX_FRAME_BYTES = 1 << 20;

export function decodeFrames(buffer: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let position = offset + 2;
    if (length === 126) {
      if (buffer.length < position + 2) break;
      length = buffer.readUInt16BE(position);
      position += 2;
    } else if (length === 127) {
      if (buffer.length < position + 8) break;
      const big = buffer.readBigUInt64BE(position);
      if (big > BigInt(MAX_FRAME_BYTES)) throw new Error(`frame of ${big} bytes refused`);
      length = Number(big);
      position += 8;
    }
    if (length > MAX_FRAME_BYTES) throw new Error(`frame of ${length} bytes refused`);
    let mask: Buffer | null = null;
    if (masked) {
      if (buffer.length < position + 4) break;
      mask = buffer.subarray(position, position + 4);
      position += 4;
    }
    if (buffer.length < position + length) break;
    const payload = Buffer.from(buffer.subarray(position, position + length));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    frames.push({ fin, opcode, payload });
    offset = position + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

export class WebSocketPeer {
  private buffer: Buffer;
  private closed = false;
  private readonly closeListeners: Array<() => void> = [];
  alive = true;

  constructor(
    private readonly socket: Duplex,
    head: Buffer = Buffer.alloc(0),
  ) {
    this.buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("close", () => this.finish());
    socket.on("end", () => this.finish());
    socket.on("error", () => this.finish());
    if (head.length) this.onData(head);
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  send(text: string): void {
    if (this.closed) return;
    this.socket.write(encodeText(text));
  }

  ping(): void {
    if (this.closed) return;
    this.alive = false;
    this.socket.write(encodeFrame(OPCODE.ping));
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    try {
      this.socket.write(encodeClose(code, reason));
    } catch {
    }
    this.socket.end();
    this.finish();
  }

  private onData(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let decoded: { frames: Frame[]; rest: Buffer };
    try {
      decoded = decodeFrames(this.buffer);
    } catch {
      this.close(1009, "frame too large");
      return;
    }
    this.buffer = Buffer.from(decoded.rest);
    for (const frame of decoded.frames) {
      if (frame.opcode === OPCODE.ping) this.socket.write(encodeFrame(OPCODE.pong, frame.payload));
      else if (frame.opcode === OPCODE.pong) this.alive = true;
      else if (frame.opcode === OPCODE.close) {
        try {
          this.socket.write(encodeFrame(OPCODE.close, frame.payload.subarray(0, 2)));
        } catch {
        }
        this.socket.end();
        this.finish();
        return;
      }
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener();
  }
}

export function acceptUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer = Buffer.alloc(0)): WebSocketPeer | null {
  const key = req.headers["sec-websocket-key"];
  const upgrade = String(req.headers.upgrade ?? "").toLowerCase();
  const version = req.headers["sec-websocket-version"];
  if (upgrade !== "websocket" || typeof key !== "string" || version !== "13") {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return null;
  }
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${acceptKey(key)}`, "", ""].join("\r\n"));
  return new WebSocketPeer(socket, head);
}
