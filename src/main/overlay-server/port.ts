import net from 'node:net'

// 从 start 开始向上探活 N 个端口，返回第一个空闲的
export async function findAvailablePort(start: number, max: number = 50): Promise<number> {
  for (let port = start; port < start + max; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(false))
      srv.once('listening', () => srv.close(() => resolve(true)))
      try {
        srv.listen(port, '127.0.0.1')
      } catch {
        resolve(false)
      }
    })
    if (free) return port
  }
  throw new Error(`No free port in range ${start}-${start + max}`)
}
