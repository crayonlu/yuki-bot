import type { BotSettings } from "@bot/shared"
import type { AppLogger } from "../../infra/logger"
import type { WebSearchResult } from "../../plugins/types"
import { runWithRetry } from "../common/retry"

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
    const count = Math.min(
      Math.max(options?.count ?? settings.webSearchCountPerCall, 1),
      settings.webSearchCountPerCall
    )
    const freshness = options?.freshness ?? settings.webSearchFreshness
    const summary = options?.summary ?? settings.webSearchSummary
    const providers = [...new Set(settings.webSearchProviders)]
    let lastError: Error | undefined

    for (const provider of providers) {
      try {
        const result = await this.searchByProvider(provider, {
          query,
          count,
          freshness,
          summary,
          settings,
          traceId
        })
        this.log.info(
          "web search success",
          {
            provider,
            query,
            count,
            hitCount: result.items.length,
            freshness,
            summary
          },
          traceId
        )
        if (result.items.length > 0) {
          return result
        }
        lastError = new Error(`provider ${provider} returned zero results`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        lastError = error instanceof Error ? error : new Error(message)
        this.log.warn(
          "web search provider failed, trying next",
          {
            provider,
            query,
            error: message
          },
          traceId
        )
      }
    }
    throw lastError ?? new Error("all web search providers failed")
  }

  private async searchByProvider(
    provider: "serper" | "tavily" | "serpapi",
    input: {
      query: string
      count: number
      freshness: string
      summary: boolean
      settings: BotSettings
      traceId: string
    }
  ): Promise<WebSearchResult> {
    if (provider === "serper") return this.searchWithSerper(input)
    if (provider === "tavily") return this.searchWithTavily(input)
    return this.searchWithSerpApi(input)
  }

  private async searchWithSerper(input: {
    query: string
    count: number
    freshness: string
    summary: boolean
    settings: BotSettings
    traceId: string
  }): Promise<WebSearchResult> {
    const { query, count, freshness, summary, settings } = input
    if (!settings.webSearchSerperApiKey) {
      throw new Error("Serper API key is empty")
    }
    const endpoint = "https://google.serper.dev/search"
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), settings.webSearchTimeoutMs)
    try {
      const timeRange = (() => {
        if (freshness === "oneDay") return "d"
        if (freshness === "oneWeek") return "w"
        if (freshness === "oneMonth") return "m"
        if (freshness === "oneYear") return "y"
        return undefined
      })()
      const response = await runWithRetry({
        attempts: 2,
        delayMs: 400,
        shouldRetry: (message) => /429|timeout|aborted|overload/i.test(message),
        task: () =>
          fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": settings.webSearchSerperApiKey
            },
            signal: controller.signal,
            body: JSON.stringify({
              q: query,
              num: count,
              tbs: timeRange,
              autocorrect: true
            })
          })
      })
      if (!response.ok) {
        const reason = await response.text()
        throw new Error(`serper failed(${response.status}): ${reason}`)
      }
      const data = (await response.json()) as {
        searchParameters?: { q?: string }
        organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>
        answerBox?: { title?: string; link?: string; snippet?: string }
        knowledgeGraph?: { title?: string; description?: string; website?: string }
      }
      const organicItems = (data.organic ?? [])
        .filter((item) => typeof item.link === "string" && !!item.link)
        .map((item) => ({
          title: item.title ?? item.link ?? "",
          url: item.link ?? "",
          snippet: item.snippet,
          summary: summary ? item.snippet : undefined,
          datePublished: item.date
        }))
      const answerBoxItem =
        data.answerBox?.link || data.answerBox?.snippet
          ? [
              {
                title: data.answerBox?.title ?? "Answer Box",
                url: data.answerBox?.link ?? "",
                snippet: data.answerBox?.snippet,
                summary: summary ? data.answerBox?.snippet : undefined
              }
            ]
          : []
      const knowledgeItem =
        data.knowledgeGraph?.website || data.knowledgeGraph?.description
          ? [
              {
                title: data.knowledgeGraph?.title ?? "Knowledge Graph",
                url: data.knowledgeGraph?.website ?? "",
                snippet: data.knowledgeGraph?.description,
                summary: summary ? data.knowledgeGraph?.description : undefined
              }
            ]
          : []
      return {
        query: data.searchParameters?.q ?? query,
        items: [...answerBoxItem, ...knowledgeItem, ...organicItems].slice(0, count)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async searchWithTavily(input: {
    query: string
    count: number
    freshness: string
    summary: boolean
    settings: BotSettings
    traceId: string
  }): Promise<WebSearchResult> {
    const { query, count, settings, summary } = input
    if (!settings.webSearchTavilyApiKey) {
      throw new Error("Tavily API key is empty")
    }
    const endpoint = "https://api.tavily.com/search"
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), settings.webSearchTimeoutMs)
    try {
      const response = await runWithRetry({
        attempts: 2,
        delayMs: 400,
        shouldRetry: (message) => /429|timeout|aborted|overload/i.test(message),
        task: () =>
          fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            signal: controller.signal,
            body: JSON.stringify({
              api_key: settings.webSearchTavilyApiKey,
              query,
              max_results: count,
              search_depth: "basic",
              include_answer: false,
              include_images: false,
              include_raw_content: false
            })
          })
      })
      if (!response.ok) {
        const reason = await response.text()
        throw new Error(`tavily failed(${response.status}): ${reason}`)
      }
      const data = (await response.json()) as {
        query?: string
        results?: Array<{
          title?: string
          url?: string
          content?: string
          published_date?: string
        }>
      }
      const items = (data.results ?? [])
        .filter((item) => typeof item.url === "string" && !!item.url)
        .map((item) => ({
          title: item.title ?? item.url ?? "",
          url: item.url ?? "",
          snippet: item.content,
          summary: summary ? item.content : undefined,
          datePublished: item.published_date
        }))
      return {
        query: data.query ?? query,
        items: items.slice(0, count)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async searchWithSerpApi(input: {
    query: string
    count: number
    freshness: string
    summary: boolean
    settings: BotSettings
    traceId: string
  }): Promise<WebSearchResult> {
    const { query, count, freshness, summary, settings } = input
    if (!settings.webSearchSerpApiKey) {
      throw new Error("SerpAPI key is empty")
    }
    const endpoint = new URL("https://serpapi.com/search.json")
    endpoint.searchParams.set("engine", "google")
    endpoint.searchParams.set("q", query)
    endpoint.searchParams.set("num", String(count))
    endpoint.searchParams.set("api_key", settings.webSearchSerpApiKey)
    if (freshness === "oneDay") endpoint.searchParams.set("tbs", "qdr:d")
    if (freshness === "oneWeek") endpoint.searchParams.set("tbs", "qdr:w")
    if (freshness === "oneMonth") endpoint.searchParams.set("tbs", "qdr:m")
    if (freshness === "oneYear") endpoint.searchParams.set("tbs", "qdr:y")
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), settings.webSearchTimeoutMs)
    try {
      const response = await runWithRetry({
        attempts: 2,
        delayMs: 400,
        shouldRetry: (message) => /429|timeout|aborted|overload/i.test(message),
        task: () =>
          fetch(endpoint.toString(), {
            method: "GET",
            signal: controller.signal
          })
      })
      if (!response.ok) {
        const reason = await response.text()
        throw new Error(`serpapi failed(${response.status}): ${reason}`)
      }
      const data = (await response.json()) as {
        search_parameters?: { q?: string }
        organic_results?: Array<{
          title?: string
          link?: string
          snippet?: string
          date?: string
        }>
        answer_box?: {
          title?: string
          link?: string
          snippet?: string
        }
      }
      const answerItem =
        data.answer_box?.link || data.answer_box?.snippet
          ? [
              {
                title: data.answer_box?.title ?? "Answer Box",
                url: data.answer_box?.link ?? "",
                snippet: data.answer_box?.snippet,
                summary: summary ? data.answer_box?.snippet : undefined
              }
            ]
          : []
      const organicItems = (data.organic_results ?? [])
        .filter((item) => typeof item.link === "string" && !!item.link)
        .map((item) => ({
          title: item.title ?? item.link ?? "",
          url: item.link ?? "",
          snippet: item.snippet,
          summary: summary ? item.snippet : undefined,
          datePublished: item.date
        }))
      return {
        query: data.search_parameters?.q ?? query,
        items: [...answerItem, ...organicItems].slice(0, count)
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
