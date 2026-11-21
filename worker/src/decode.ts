import { transit_realtime } from './gen/subway-rt.js'

export function decodeFeed(bytes: Uint8Array): transit_realtime.FeedMessage.$Properties {
  return transit_realtime.FeedMessage.decode(bytes)
}
