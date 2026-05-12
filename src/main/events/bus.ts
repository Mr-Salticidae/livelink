import mitt from 'mitt'
import type { StandardEvent } from '../platform/adapter'

type BusEvents = {
  event: StandardEvent
}

export const bus = mitt<BusEvents>()
export type Bus = typeof bus
