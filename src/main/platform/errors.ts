// Platform 层抛出的可识别错误。主进程 IPC handler 拿到后翻译成中文用户提示
export class RoomNotFoundError extends Error {
  readonly code = 'ROOM_NOT_FOUND'
  constructor(roomId: string | number, cause?: unknown) {
    super(`找不到房间 ${roomId}`)
    this.name = 'RoomNotFoundError'
    if (cause) (this as { cause?: unknown }).cause = cause
  }
}

export class RoomApiError extends Error {
  readonly code = 'ROOM_API_ERROR'
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'RoomApiError'
    if (cause) (this as { cause?: unknown }).cause = cause
  }
}

export class AdapterAlreadyConnectedError extends Error {
  readonly code = 'ALREADY_CONNECTED'
  constructor() {
    super('已经处于连接状态，先 disconnect')
    this.name = 'AdapterAlreadyConnectedError'
  }
}

// TCP 连上了、但没等到 CONNECT_SUCCESS 就被关掉或超时。
// 典型成因：弹幕服务器握手 token 已失效、未登录被风控降级、握手中途断网
export class HandshakeFailedError extends Error {
  readonly code = 'HANDSHAKE_FAILED'
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'HandshakeFailedError'
    if (cause) (this as { cause?: unknown }).cause = cause
  }
}
