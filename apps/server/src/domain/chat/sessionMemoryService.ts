import type { ChatMessage, OneBotMessageEvent } from "@bot/shared"
import type { BotDatabase } from "../../infra/db/sqlite"

export class SessionMemoryService {
  constructor(private readonly db: BotDatabase) {}

  getSessionKey(event: OneBotMessageEvent): string {
    if (event.message_type === "group" && event.group_id) {
      return `group:${event.group_id}`
    }
    return `private:${event.user_id}`
  }

  getRecentHistory(event: OneBotMessageEvent, maxTurns: number): ChatMessage[] {
    const sessionKey = this.getSessionKey(event)
    const messageLimit = Math.max(1, maxTurns) * 2
    return this.db.listSessionMessages(sessionKey, messageLimit)
  }

  appendTurn(event: OneBotMessageEvent, userText: string, assistantText: string): void {
    const sessionKey = this.getSessionKey(event)
    this.db.appendSessionMessage(sessionKey, "user", userText)
    this.db.appendSessionMessage(sessionKey, "assistant", assistantText)
  }

  clear(event: OneBotMessageEvent): void {
    const sessionKey = this.getSessionKey(event)
    this.db.clearSessionMessages(sessionKey)
    this.db.clearVisionEvidences(sessionKey)
  }

  appendVisionEvidence(
    event: OneBotMessageEvent,
    input: {
      messageId?: string
      imageUrls: string[]
      summary: string
      details?: string
    }
  ): void {
    const sessionKey = this.getSessionKey(event)
    this.db.appendVisionEvidence({
      sessionKey,
      ...input
    })
  }

  getRecentVisionEvidences(event: OneBotMessageEvent, limit: number) {
    const sessionKey = this.getSessionKey(event)
    return this.db.listVisionEvidences(sessionKey, limit)
  }
}
