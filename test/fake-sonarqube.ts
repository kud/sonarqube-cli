import http from "node:http"
import type { AddressInfo } from "node:net"

export interface RecordedRequest {
  path: string
  query: Record<string, string>
  authorization?: string
}

export type Reply = { status?: number; body?: unknown; text?: string }
export type Handler = (req: RecordedRequest) => Reply

export const startFakeSonarQube = async (handler: Handler) => {
  const requests: RecordedRequest[] = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    const recorded: RecordedRequest = {
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      authorization: req.headers.authorization,
    }
    requests.push(recorded)
    const reply = handler(recorded)
    res.statusCode = reply.status ?? 200
    if (reply.text !== undefined) {
      res.setHeader("content-type", "text/plain")
      res.end(reply.text)
      return
    }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(reply.body ?? {}))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    host: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
