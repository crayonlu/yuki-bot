import type { ConfigService } from "../domain/config/configService"
import type { BotDatabase } from "../infra/db/sqlite"
import type { AppLogger } from "../infra/logger"
import type { PluginManager } from "../plugins/pluginManager"

export type AppDeps = {
  db: BotDatabase
  logger: AppLogger
  configService: ConfigService
  pluginManager: PluginManager
}
