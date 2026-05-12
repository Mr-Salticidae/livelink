import { io, type Socket } from 'socket.io-client'

// overlay 一定从主进程内嵌的 OverlayServer 加载，所以用同源 + /overlay namespace
const socket: Socket = io(`${location.origin}/overlay`, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
})

export function on<T = unknown>(event: string, cb: (data: T) => void): () => void {
  socket.on(event, cb)
  return () => socket.off(event, cb)
}

export { socket }
