// overlay 端用到的最小类型定义。复刻自主进程，避免 renderer/main 边界耦合
export interface OverlayUser {
  uid: string
  uname: string
  avatar?: string
  guardLevel?: number
}

export interface OverlayEventBase {
  kind: string
  platform: string
  timestamp: number
  user: OverlayUser
  payload: Record<string, unknown>
}

export interface OverlayPayload {
  kind: string
  text?: string
  event: OverlayEventBase
  extra?: Record<string, unknown>
}
