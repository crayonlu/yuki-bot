import type { BotPlugin } from "../src/plugins/types";

const plugin: BotPlugin = {
  id: "external.example-hello",
  name: "Example Hello",
  version: "0.1.0",
  commands: ["/hello"],
  async onMessage(event, context) {
    if (event.raw_message !== "/hello") return;
    await context.reply("hello from external plugin");
  }
};

export default plugin;
