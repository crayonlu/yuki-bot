import type { BotPlugin } from "../types";

export const echoPlugin: BotPlugin = {
  id: "builtin.echo",
  name: "Echo Plugin",
  version: "0.1.0",
  permissions: {
    replyPrivate: true,
    replyGroup: true
  },
  async onMessage(event, context) {
    if (!event.raw_message.startsWith("/ping")) return;
    await context.reply("pong");
    context.log("Handled /ping");
  }
};
