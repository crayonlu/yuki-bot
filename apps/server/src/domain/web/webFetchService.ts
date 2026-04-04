import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { BotSettings } from "@bot/shared";
import type { AppLogger } from "../../infra/logger";
import type { WebFetchResult } from "../../plugins/types";

const PRIVATE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const stripHtml = (input: string) =>
  input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const extractTagContent = (html: string, regex: RegExp) => {
  const match = html.match(regex);
  return match?.[1] ? stripHtml(match[1]) : undefined;
};

const cutText = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}...(truncated)`;

const isPrivateIpv4 = (ip: string) => {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
};

const isPrivateIpv6 = (ip: string) => {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.replace("::ffff:", "");
    if (isIP(mapped) === 4) return isPrivateIpv4(mapped);
  }
  return false;
};

const isPrivateIp = (ip: string) => {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return false;
};

const assertPublicHostname = async (hostname: string) => {
  if (!hostname) throw new Error("URL hostname is empty");
  const lower = hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(lower) || lower.endsWith(".local")) {
    throw new Error(`Blocked private hostname: ${hostname}`);
  }

  const literalIpVersion = isIP(hostname);
  if (literalIpVersion !== 0 && isPrivateIp(hostname)) {
    throw new Error(`Blocked private IP: ${hostname}`);
  }

  const resolved = await lookup(hostname, { all: true });
  if (resolved.length === 0) {
    throw new Error(`Cannot resolve hostname: ${hostname}`);
  }
  for (const item of resolved) {
    if (isPrivateIp(item.address)) {
      throw new Error(`Blocked private resolved IP: ${hostname} -> ${item.address}`);
    }
  }
};

const toAbsoluteRedirect = (currentUrl: string, location: string) => {
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    throw new Error(`Invalid redirect target: ${location}`);
  }
};

export class WebFetchService {
  private readonly log;

  constructor(logger: AppLogger) {
    this.log = logger.child("web-fetch");
  }

  async fetchUrl(url: string, settings: BotSettings, traceId: string): Promise<WebFetchResult> {
    if (!settings.webFetchEnabled) {
      throw new Error("web fetch is disabled");
    }

    let currentUrl = url.trim();
    if (!/^https?:\/\//i.test(currentUrl)) {
      throw new Error("only http/https URL is supported");
    }

    let redirects = 0;
    while (true) {
      const parsed = new URL(currentUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error(`unsupported protocol: ${parsed.protocol}`);
      }
      await assertPublicHostname(parsed.hostname);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), settings.webFetchTimeoutMs);
      try {
        const response = await fetch(parsed.toString(), {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "user-agent": "qq-bot-webfetch/0.1"
          }
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location) throw new Error("redirect response missing location header");
          redirects += 1;
          if (redirects > settings.webFetchMaxRedirects) {
            throw new Error(`redirect limit exceeded: ${settings.webFetchMaxRedirects}`);
          }
          currentUrl = toAbsoluteRedirect(parsed.toString(), location);
          continue;
        }

        if (!response.ok) {
          throw new Error(`fetch failed(${response.status})`);
        }

        const contentType = response.headers.get("content-type") ?? "application/octet-stream";
        const contentLength = Number(response.headers.get("content-length") ?? "0");
        if (contentLength > settings.webFetchMaxBytes) {
          throw new Error(`response too large: ${contentLength} bytes`);
        }

        const rawText = await response.text();
        const textBytes = new TextEncoder().encode(rawText).length;
        if (textBytes > settings.webFetchMaxBytes) {
          throw new Error(`response too large: ${textBytes} bytes`);
        }

        const normalized = this.normalizeContent(parsed.toString(), contentType, rawText);
        this.log.info(
          "web fetch success",
          {
            url,
            finalUrl: parsed.toString(),
            contentType,
            bytes: textBytes
          },
          traceId
        );
        return normalized;
      } catch (error) {
        this.log.warn(
          "web fetch failed",
          {
            url,
            finalUrl: currentUrl,
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

  private normalizeContent(url: string, contentType: string, rawText: string): WebFetchResult {
    if (contentType.includes("text/html")) {
      const title =
        extractTagContent(rawText, /<title[^>]*>([\s\S]*?)<\/title>/i) ??
        extractTagContent(
          rawText,
          /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i
        );
      const description =
        extractTagContent(
          rawText,
          /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i
        ) ??
        extractTagContent(
          rawText,
          /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i
        );
      const contentText = cutText(stripHtml(rawText), 12000);
      const summaryBase = description || contentText;
      return {
        url,
        finalUrl: url,
        title,
        summary: cutText(summaryBase, 380),
        contentText,
        contentType
      };
    }

    if (contentType.includes("application/json")) {
      const compact = cutText(rawText.trim(), 12000);
      return {
        url,
        finalUrl: url,
        title: "JSON Resource",
        summary: cutText(compact, 380),
        contentText: compact,
        contentType
      };
    }

    const plain = cutText(rawText.trim(), 12000);
    return {
      url,
      finalUrl: url,
      title: "Text Resource",
      summary: cutText(plain, 380),
      contentText: plain,
      contentType
    };
  }
}

