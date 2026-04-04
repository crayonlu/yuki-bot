import { randomUUID } from "node:crypto";
import type { OneBotMessageEvent } from "@bot/shared";
import type { AppLogger } from "../../infra/logger";

type WsLike = {
  send: (data: string) => void;
};

type OnMessageEvent = (event: OneBotMessageEvent, traceId: string) => Promise<void>;

export class OneBotWsGateway {
  private readonly sockets = new Set<WsLike>();
  private readonly log;

  constructor(logger: AppLogger, private readonly onMessageEvent: OnMessageEvent) {
    this.log = logger.child("onebot-ws");
  }

  addSocket(ws: WsLike) {
    this.sockets.add(ws);
    this.log.info("NapCat ws connected", { connections: this.sockets.size });
  }

  removeSocket(ws: WsLike) {
    this.sockets.delete(ws);
    this.log.info("NapCat ws disconnected", { connections: this.sockets.size });
  }

  private async handlePayload(payload: unknown) {
    if (Array.isArray(payload)) {
      for (const item of payload) {
        await this.handlePayload(item);
      }
      return;
    }
    const maybeEvent = payload as Partial<OneBotMessageEvent>;
    if (maybeEvent.post_type !== "message" || typeof maybeEvent.raw_message !== "string") {
      return;
    }

    const traceId = randomUUID();
    await this.onMessageEvent(maybeEvent as OneBotMessageEvent, traceId);
  }

  async handleRaw(raw: unknown) {
    let payload: unknown = raw;
    if (typeof raw === "string") {
      try {
        payload = JSON.parse(raw);
      } catch {
        this.log.warn("Received non-JSON payload", { raw: raw.slice(0, 120) });
        return;
      }
    }
    await this.handlePayload(payload);
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
          };

    const payload = JSON.stringify(action);
    for (const ws of this.sockets) {
      ws.send(payload);
    }
  }
}
