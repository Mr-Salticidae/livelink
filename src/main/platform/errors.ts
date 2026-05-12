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
