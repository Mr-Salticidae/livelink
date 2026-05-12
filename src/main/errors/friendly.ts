// 把内部错误转成给主播朋友看的中文友好提示
import { AdapterAlreadyConnectedError, RoomApiError, RoomNotFoundError } from '../platform/errors'

export interface FriendlyError {
  code: string
  message: string
}

export function toFriendlyError(err: unknown): FriendlyError {
  if (err instanceof RoomNotFoundError) {
    return {
      code: err.code,
      message: '找不到这个直播间，或者主播还没开播。检查一下房间号，或者等主播开播再点开始。'
    }
  }
  if (err instanceof RoomApiError) {
    return {
      code: err.code,
      message: '查询房间信息失败，可能是网络问题。检查一下网络再试。'
    }
  }
  if (err instanceof AdapterAlreadyConnectedError) {
    return {
      code: err.code,
      message: '已经连接了，先点"停止"再重新开始。'
    }
  }
  if (err instanceof Error) {
    const m = err.message || ''
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(m)) {
      return {
        code: 'NETWORK',
        message: '网络好像断了，正在重连。如果一直连不上，看看 WiFi 或网线。'
      }
    }
    if (/edge-tts|tts|speech|websocket/i.test(m)) {
      return {
        code: 'TTS',
        message: '声音播放失败了，可能是网络问题。点 "测试声音" 再试一次。'
      }
    }
    return { code: 'UNKNOWN', message: m || '发生了未知错误' }
  }
  return { code: 'UNKNOWN', message: '发生了未知错误' }
}
