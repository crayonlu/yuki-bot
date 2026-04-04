import type { BotSettings } from "@bot/shared";
import type { AppLogger } from "../../infra/logger";

export class LlmService {
  private readonly log;

  constructor(logger: AppLogger) {
    this.log = logger.child("llm-service");
  }

  async generateReply(input: {
    userText: string;
    extraContext?: string;
    settings: BotSettings;
    traceId: string;
  }): Promise<string> {
    const { settings } = input;
    if (!settings.apiKey) {
      throw new Error("API key is empty, please configure it in dashboard settings.");
    }

    const reply = await this.callOpenAiCompatible(input);
    return reply.trim();
  }

  private async callOpenAiCompatible(input: {
    userText: string;
    extraContext?: string;
    settings: BotSettings;
    traceId: string;
  }) {
    const { settings, userText, extraContext, traceId } = input;
    const endpoint = settings.apiBaseUrl.replace(/\/$/, "") + "/chat/completions";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: "system", content: settings.systemPrompt },
            {
              role: "user",
              content: extraContext
                ? `${userText}\n\n${extraContext}`
                : userText
            }
          ],
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const reason = await response.text();
        throw new Error(`LLM request failed(${response.status}): ${reason}`);
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("LLM response is empty");
      }
      return content;
    } catch (error) {
      this.log.error(
        "OpenAI-compatible call failed",
        {
          providerId: settings.providerId,
          endpoint,
          error: error instanceof Error ? error.message : String(error)
        },
        traceId
      );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

}
