import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { OneBotWsGateway } from "./adapters/onebot/wsGateway";
import { SessionMemoryService } from "./domain/chat/sessionMemoryService";
import { ConfigService } from "./domain/config/configService";
import { ImageService } from "./domain/image/imageService";
import { LlmService } from "./domain/llm/llmService";
import { WebFetchService } from "./domain/web/webFetchService";
import { createHttpApp } from "./http/app";
import { BotDatabase } from "./infra/db/sqlite";
import { ErrorReporter } from "./infra/errorReporter";
import { AppLogger } from "./infra/logger";
import { setupPluginHotReload } from "./plugins/hotReload";
import { PluginManager } from "./plugins/pluginManager";

const PORT = Number(Bun.env.PORT ?? 3001);
const HOST = Bun.env.HOST ?? "0.0.0.0";
const dataDir = resolve("apps/server/data");
const pluginDir = resolve("apps/server/plugins");
mkdirSync(dataDir, { recursive: true });
mkdirSync(pluginDir, { recursive: true });

const db = new BotDatabase(resolve(dataDir, "bot.sqlite"));
const logger = new AppLogger(db);
const errorReporter = new ErrorReporter(logger);
const configService = new ConfigService(db);
const llmService = new LlmService(logger);
const webFetchService = new WebFetchService(logger);
const imageService = new ImageService(logger);
const sessionMemoryService = new SessionMemoryService(db);

let wsGateway: OneBotWsGateway;
const pluginManager = new PluginManager(
  db,
  configService,
  llmService,
  webFetchService,
  imageService,
  sessionMemoryService,
  logger,
  async (event, text) => {
    await wsGateway.replyTo(event, text);
  }
);
wsGateway = new OneBotWsGateway(logger, async (event, traceId) => {
  await pluginManager.handleMessage(event, traceId);
});

await pluginManager.bootstrap();

if (existsSync(pluginDir)) {
  const files = readdirSync(pluginDir);
  for (const filename of files) {
    const ext = extname(filename);
    if (![".js", ".ts", ".mjs"].includes(ext)) continue;
    const pluginId = `external.${filename.replace(ext, "")}`;
    const modulePath = resolve(pluginDir, filename);
    await pluginManager.ensureExternalPlugin(pluginId, modulePath);
  }
  setupPluginHotReload(pluginDir, pluginManager);
}

const app = createHttpApp(
  {
    db,
    logger,
    configService,
    pluginManager
  },
  wsGateway,
  errorReporter
);

app.listen({ port: PORT, hostname: HOST });

logger.child("bootstrap").info("Server started", {
  port: PORT,
  host: HOST,
  dashboardHint: "Run dashboard on another port and call /api"
});
