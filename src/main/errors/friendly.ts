// 把内部错误转成给主播朋友看的中文友好提示
import {
  AdapterAlreadyConnectedError,
  HandshakeFailedError,
  RoomApiError,
  RoomNotFoundError
} from '../platform/errors'
import { BilibiliApiError } from '../platform/bilibili-api'

export interface FriendlyError {
  code: string
  message: string
}

export function toFriendlyError(err: unknown): FriendlyError {
  if (err instanceof HandshakeFailedError) {
    return {
      code: err.code,
      message:
        '连上了 B 站但没通过验证。多半是登录态过期了：到「B 站登录」页重新填一次 SESSDATA 再试。'
    }
  }
  if (err instanceof BilibiliApiError) {
    // -352 / -412 是 B 站风控拦截，和网络不通不是一回事，分开提示免得主播白折腾
    if (err.apiCode === -352 || err.apiCode === -412) {
      return {
        code: 'BILIBILI_RISK_CONTROL',
        message: 'B 站把这次请求拦了（风控）。等一两分钟再试；老是这样就填一下 SESSDATA 登录态。'
      }
    }
    if (err.apiCode === null) {
      return {
        code: 'NETWORK',
        message: '连不上 B 站服务器，先看看网络。网络恢复后会自动重连。'
      }
    }
    return { code: err.code, message: `B 站接口返回异常（${err.apiCode}）：${err.message}` }
  }
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
