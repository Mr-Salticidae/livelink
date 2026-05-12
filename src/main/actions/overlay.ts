// Overlay 广播器骨架（Task 3 阶段，先 stub；Task 5 由 OverlayServer 注入真实 broadcast）
import type { StandardEvent } from '../platform/adapter'

export interface OverlayMessage {
  kind: string
  text?: string
  event: StandardEvent
  extra?: Record<string, unknown>
}

export type OverlaySender = (msg: OverlayMessage) => void

export class OverlayBroadcaster {
  private sender: OverlaySender | null = null

  setSender(sender: OverlaySender | null): void {
    this.sender = sender
  }

  broadcast(msg: OverlayMessage): void {
    if (!this.sender) {
      console.log(`[Overlay stub] would broadcast`, msg.kind, msg.text)
      return
    }
    this.sender(msg)
  }
}
