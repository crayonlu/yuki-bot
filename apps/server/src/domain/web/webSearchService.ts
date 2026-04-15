import type { BotSettings } from "@bot/shared"
import type { AppLogger } from "../../infra/logger"
import type { WebSearchResult } from "../../plugins/types"

const toWebSearchEndpoint = (apiBaseUrl: string) => {
  const parsed = new URL(apiBaseUrl)
  return `${parsed.origin}/v3/web-search`
}

export class WebSearchService {
  private readonly log

  constructor(logger: AppLogger) {
    this.log = logger.child("web-search")
  }

  async search(
    input: { query: string; settings: BotSettings; traceId: string },
    options?: { count?: number; freshness?: string; summary?: boolean }
  ): Promise<WebSearchResult> {
    const { query, settings, traceId } = input
    if (!settings.webSearchEnabled) {
      throw new Error("web search is disabled")
    }
    if (!settings.apiKey) {
      throw new Error("API key is empty, please configure it in dashboard settings.")
    }

    const endpoint = toWebSearchEndpoint(settings.apiBaseUrl)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), settings.webSearchTimeoutMs)
    const count = Math.min(
      Math.max(options?.count ?? settings.webSearchCountPerCall, 1),
      settings.webSearchCountPerCall
    )
    const freshness = options?.freshness ?? settings.webSearchFreshness
    const summary = options?.summary ?? settings.webSearchSummary

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          query,
          freshness,
          summary,
          count
        })
      })
      if (!response.ok) {
        const reason = await response.text()
        throw new Error(`web search failed(${response.status}): ${reason}`)
      }

      const data = (await response.json()) as {
        SearchData?: {
          queryContext?: { originalQuery?: string }
          webPages?: {
            value?: Array<{
              name?: string
              url?: string
              snippet?: string
              summary?: string
              siteName?: string
              datePublished?: string
            }>
          }
        }
      }
      const items = (data.SearchData?.webPages?.value ?? [])
        .filter((item) => typeof item.url === "string" && !!item.url)
        .map((item) => ({
          title: item.name ?? item.url ?? "",
          url: item.url ?? "",
          snippet: item.snippet,
          summary: item.summary,
          siteName: item.siteName,
          datePublished: item.datePublished
        }))
      this.log.info(
        "web search success",
        {
          query,
          count,
          hitCount: items.length,
          freshness,
          summary
        },
        traceId
      )
      return {
        query: data.SearchData?.queryContext?.originalQuery ?? query,
        items
      }
    } catch (error) {
      this.log.warn(
        "web search failed",
        {
          query,
          error: error instanceof Error ? error.message : String(error)
        },
        traceId
      )
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}
