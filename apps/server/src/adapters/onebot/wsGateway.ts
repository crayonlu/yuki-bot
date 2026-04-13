import { randomUUID } from "node:crypto"
import type { OneBotMessageEvent, OneBotMessageSegment, OneBotQuotedMessage } from "@bot/shared"
import type { AppLogger } from "../../infra/logger"

type WsLike = {
  send: (data: string) => void
}

type OnMessageEvent = (event: OneBotMessageEvent, traceId: string) => Promise<void>

type OneBotApiResponse = {
  status?: string
  retcode?: number
  data?: unknown
  echo?: string
  msg?: string
}

const toSegments = (message: unknown): OneBotMessageSegment[] => {
  if (!Array.isArray(message)) return []
  return message
    .map<OneBotMessageSegment | undefined>((item) => {
      if (!item || typeof item !== "object") return undefined
      const value = item as Record<string, unknown>
      if (typeof value.type !== "string") return undefined
      const data =
        value.data && typeof value.data === "object"
          ? (value.data as Record<string, unknown>)
          : undefined
      const serializedData = data
        ? Object.fromEntries(Object.entries(data).map(([key, entry]) => [key, String(entry ?? "")]))
        : undefined
      return {
        type: value.type,
        data: serializedData
      }
    })
    .filter((item): item is OneBotMessageSegment => item !== undefined)
}

export class OneBotWsGateway {
  private readonly sockets = new Set<WsLike>()
  private readonly pendingCalls = new Map<
    string,
    {
      resolve: (value: OneBotApiResponse) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly log

  constructor(
    logger: AppLogger,
    private readonly onMessageEvent: OnMessageEvent
  ) {
    this.log = logger.child("onebot-ws")
  }

  addSocket(ws: WsLike) {
    this.sockets.add(ws)
    this.log.info("NapCat ws connected", { connections: this.sockets.size })
  }

  removeSocket(ws: WsLike) {
    this.sockets.delete(ws)
    this.log.info("NapCat ws disconnected", { connections: this.sockets.size })
  }

  private async handlePayload(payload: unknown) {
    if (Array.isArray(payload)) {
      for (const item of payload) {
        await this.handlePayload(item)
      }
      return
    }
    if (!payload || typeof payload !== "object") {
      return
    }
    const maybeApiResponse = payload as OneBotApiResponse
    if (typeof maybeApiResponse.echo === "string") {
      const pending = this.pendingCalls.get(maybeApiResponse.echo)
      if (pending) {
        this.pendingCalls.delete(maybeApiResponse.echo)
        clearTimeout(pending.timer)
        pending.resolve(maybeApiResponse)
        return
      }
    }

    const maybeEvent = payload as Partial<OneBotMessageEvent> & {
      message?: unknown
    }
    if (maybeEvent.post_type !== "message" || typeof maybeEvent.raw_message !== "string") {
      return
    }
    const segments = toSegments(maybeEvent.message)
    const replySegment = segments.find((segment) => segment.type === "reply")
    const replyMessageId = replySegment?.data?.id
    const nextEvent: OneBotMessageEvent = {
      ...(maybeEvent as OneBotMessageEvent),
      message: segments,
      reply: replyMessageId ? { message_id: replyMessageId } : undefined
    }

    const traceId = randomUUID()
    await this.onMessageEvent(nextEvent, traceId)
  }

  async handleRaw(raw: unknown) {
    let payload: unknown = raw
    if (typeof raw === "string") {
      try {
        payload = JSON.parse(raw)
      } catch {
        this.log.warn("Received non-JSON payload", { raw: raw.slice(0, 120) })
        return
      }
    }
    await this.handlePayload(payload)
  }

  async replyTo(event: OneBotMessageEvent, text: string) {
    const action =
      event.message_type === "group"
        ? {
            action: "send_group_msg",
            params: { group_id: event.group_id, message: text }
          }
        : {
            action: "send_private_msg",
            params: { user_id: event.user_id, message: text }
          }

    const payload = JSON.stringify(action)
    for (const ws of this.sockets) {
      ws.send(payload)
    }
  }

  private async callApi(action: string, params: Record<string, unknown>, timeoutMs = 15000) {
    const socket = this.sockets.values().next().value as WsLike | undefined
    if (!socket) {
      throw new Error("NapCat ws is not connected")
    }
    const echo = randomUUID()
    const payload = JSON.stringify({
      action,
      params,
      echo
    })
    const result = await new Promise<OneBotApiResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(echo)
        reject(new Error(`OneBot API timeout: ${action}`))
      }, timeoutMs)
      this.pendingCalls.set(echo, { resolve, reject, timer })
      socket.send(payload)
    })
    if (result.status !== "ok" || (typeof result.retcode === "number" && result.retcode !== 0)) {
      throw new Error(`OneBot API failed(${action}): ${result.msg ?? result.retcode ?? "unknown"}`)
    }
    return result.data
  }

  async getMessageById(messageId: number | string): Promise<OneBotQuotedMessage | undefined> {
    const data = (await this.callApi("get_msg", {
      message_id: messageId
    })) as {
      message_id?: number | string
      raw_message?: string
      message?: unknown
    }
    if (!data) return undefined
    return {
      message_id: data.message_id ?? messageId,
      raw_message: data.raw_message ?? "",
      message: toSegments(data.message)
    }
  }

  async sendForward(event: OneBotMessageEvent, contents: string[]): Promise<void> {
    if (contents.length === 0) return
    const messages = contents.map((content) => ({
      type: "node",
      data: {
        name: "bot",
        uin: String(event.self_id),
        content
      }
    }))
    try {
      await this.callApi("send_forward_msg", {
        group_id: event.group_id,
        user_id: event.user_id,
        messages
      })
      return
    } catch {}

    if (event.message_type === "group") {
      await this.callApi("send_group_forward_msg", {
        group_id: event.group_id,
        messages
      })
      return
    }
    await this.callApi("send_private_forward_msg", {
      user_id: event.user_id,
      messages
    })
  }
}
