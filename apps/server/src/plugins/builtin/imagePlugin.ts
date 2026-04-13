import type { BotPlugin } from "../types"

const HELP_TEXT =
  "Usage: /image [--model model_id] <prompt>. Example: /image --model seedream-5.0-lite a cyberpunk cat."

const parseCommand = (content: string) => {
  const body = content.slice("/image".length).trim()
  if (!body) return { ok: false as const, error: HELP_TEXT }
  if (body === "--help" || body === "-h" || body === "help") {
    return { ok: false as const, error: "__help__" }
  }

  if (body.startsWith("--model")) {
    const matched = body.match(/^--model\s+(\S+)\s+([\s\S]+)$/)
    if (!matched) {
      return { ok: false as const, error: "Invalid --model usage. " + HELP_TEXT }
    }
    const [, modelId, prompt] = matched
    return { ok: true as const, modelId, prompt: prompt.trim() }
  }
  if (body.startsWith("--bench")) {
    const prompt = body.slice("--bench".length).trim()
    return { ok: true as const, bench: true, prompt }
  }

  return { ok: true as const, modelId: undefined, bench: false, prompt: body }
}

const getHelpWithModelMap = (modelIds: string[]) => {
  const lines = modelIds.map((id, idx) => `${idx + 1}: ${id}`)
  return [
    "Usage:",
    "- /image <prompt>",
    "- /image --model <id|index> <prompt>",
    "- /image --bench <prompt>   (run all configured models)",
    "",
    "Model map:",
    ...lines
  ].join("\n")
}

const resolveModelId = (raw: string | undefined, available: string[]) => {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const index = Number(trimmed)
  if (Number.isInteger(index) && index >= 1 && index <= available.length) {
    return available[index - 1]
  }
  return trimmed
}

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
    const content = event.raw_message.trim()
    if (!content.startsWith("/image")) return

    const parsed = parseCommand(content)
    const available = context.settings.imageModelConfigs.map((item) => item.id)
    const helpText = getHelpWithModelMap(available)
    if (!parsed.ok) {
      await context.reply(parsed.error === "__help__" ? helpText : parsed.error)
      return
    }

    if (!parsed.prompt) {
      await context.reply(helpText)
      return
    }

    if (parsed.bench) {
      if (context.settings.pluginTimeoutMs < 60000) {
        await context.reply(
          `Warning: pluginTimeoutMs=${context.settings.pluginTimeoutMs} may be too small for --bench.`
        )
      }
      await context.reply(`Bench start: ${available.length} model(s)`)
      for (const modelId of available) {
        try {
          const result = await context.generateImage({
            modelId,
            prompt: parsed.prompt
          })
          await context.reply(`Model: ${result.modelId}`)
          for (const imageUrl of result.imageUrls.slice(0, 2)) {
            await context.reply(`[CQ:image,file=${imageUrl}]`)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await context.reply(`Model ${modelId} failed: ${message}`)
        }
      }
      await context.reply("Bench done.")
      return
    }

    const resolvedModelId = resolveModelId(parsed.modelId, available)
    if (resolvedModelId && !available.includes(resolvedModelId)) {
      await context.reply(`Unknown image model: ${parsed.modelId}\n\n${helpText}`)
      return
    }

    try {
      const result = await context.generateImage({
        modelId: resolvedModelId,
        prompt: parsed.prompt
      })
      for (const imageUrl of result.imageUrls.slice(0, 4)) {
        await context.reply(`[CQ:image,file=${imageUrl}]`)
      }
      context.log("Image generated", {
        modelId: result.modelId,
        count: result.imageUrls.length
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await context.reply(`Image generation failed: ${message}`)
      context.log("Image generation failed", { error: message })
    }
  }
}
