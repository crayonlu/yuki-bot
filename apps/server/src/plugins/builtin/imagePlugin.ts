import type { BotPlugin } from "../types";

const HELP_TEXT =
  "Usage: /image [--model model_id] <prompt>. Example: /image --model seedream-5.0-lite a cyberpunk cat.";

const parseCommand = (content: string) => {
  const body = content.slice("/image".length).trim();
  if (!body) return { ok: false as const, error: HELP_TEXT };

  if (body.startsWith("--model")) {
    const matched = body.match(/^--model\s+(\S+)\s+([\s\S]+)$/);
    if (!matched) {
      return { ok: false as const, error: "Invalid --model usage. " + HELP_TEXT };
    }
    const [, modelId, prompt] = matched;
    return { ok: true as const, modelId, prompt: prompt.trim() };
  }

  return { ok: true as const, modelId: undefined, prompt: body };
};

export const imagePlugin: BotPlugin = {
  id: "builtin.image",
  name: "Image Plugin",
  version: "0.1.0",
  commands: ["/image"],
  routePriority: 90,
  permissions: {
    imageGenerate: true,
    replyPrivate: true,
    replyGroup: true,
    configRead: true
  },
  async onMessage(event, context) {
    const content = event.raw_message.trim();
    if (!content.startsWith("/image")) return;

    const parsed = parseCommand(content);
    if (!parsed.ok) {
      await context.reply(parsed.error);
      return;
    }

    if (!parsed.prompt) {
      await context.reply(HELP_TEXT);
      return;
    }

    const available = context.settings.imageModelConfigs.map((item) => item.id);
    if (parsed.modelId && !available.includes(parsed.modelId)) {
      await context.reply(
        `Unknown image model: ${parsed.modelId}\nAvailable: ${available.join(", ")}`
      );
      return;
    }

    try {
      const result = await context.generateImage({
        modelId: parsed.modelId,
        prompt: parsed.prompt
      });
      for (const imageUrl of result.imageUrls.slice(0, 4)) {
        await context.reply(`[CQ:image,file=${imageUrl}]`);
      }
      context.log("Image generated", {
        modelId: result.modelId,
        count: result.imageUrls.length
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await context.reply(`Image generation failed: ${message}`);
      context.log("Image generation failed", { error: message });
    }
  }
};
