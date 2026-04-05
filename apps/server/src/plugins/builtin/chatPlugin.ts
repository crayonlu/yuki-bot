import type { BotPlugin } from "../types";

const HELP_TEXT =
  "Use /ask <your question> to chat with the configured model. Example: /ask explain this error";

const URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi;

const extractUrls = (text: string) => Array.from(new Set(text.match(URL_REGEX) ?? []));

export const chatPlugin: BotPlugin = {
  id: "builtin.chat",
  name: "Chat Plugin",
  version: "0.1.0",
  commands: ["/ask", "/clean"],
  routePriority: -10,
  permissions: {
    llm: true,
    webFetch: true,
    replyPrivate: true,
    replyGroup: true,
    configRead: true
  },
  async onMessage(event, context) {
    const content = event.raw_message.trim();
    if (!content) return;
    const urls = extractUrls(content);
    const resetCommand = context.settings.chatResetCommand || "/clean";

    if (content === resetCommand) {
      context.clearHistory();
      await context.reply("Session history cleared.");
      context.log("Session history cleared");
      return;
    }

    if (content === "/ask") {
      await context.reply(HELP_TEXT);
      return;
    }

    const isAskCommand = content.startsWith("/ask ");
    const question = isAskCommand ? content.slice("/ask ".length).trim() : content;
    if (!question) {
      await context.reply(HELP_TEXT);
      return;
    }

    context.log("Dispatching ask to llm", { preview: question.slice(0, 100) });
    try {
      const webContextBlocks: string[] = [];
      for (const url of urls.slice(0, context.settings.webFetchMaxUrlsPerMessage)) {
        try {
          const fetched = await context.fetchUrl(url);
          webContextBlocks.push(
            [
              `URL: ${fetched.finalUrl}`,
              fetched.title ? `Title: ${fetched.title}` : undefined,
              `Summary: ${fetched.summary}`,
              `ContentSnippet: ${fetched.contentText.slice(0, 1800)}`,
              `ContentType: ${fetched.contentType}`
            ]
              .filter(Boolean)
              .join("\n")
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          webContextBlocks.push(`URL: ${url}\nFetchError: ${message}`);
        }
      }

      const extraContext =
        webContextBlocks.length > 0
          ? `Fetched URL context:\n\n${webContextBlocks.join("\n\n---\n\n")}`
          : undefined;
      const history = context.getRecentHistory(context.settings.memoryMaxTurns);
      const answer = await context.askLlm(question, extraContext, history);
      await context.reply(answer);
      context.appendHistoryTurn(question, answer);
      context.log("LLM reply completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await context.reply(`LLM call failed: ${message}`);
      context.log("LLM reply failed", { error: message });
    }
  }
};
