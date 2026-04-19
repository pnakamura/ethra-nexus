// @ethra-nexus/agents — exports públicos
//
// Pós-migração para Fastify + Drizzle ORM.
// O orchestrator e skill executors serão reconstruídos nas Fases 5/6.

// Providers
export {
  AnthropicProvider,
  OpenRouterProvider,
  ProviderRegistry,
  createRegistryFromEnv,
} from './lib/provider'
export type { RegistryConfig, CompleteOptions } from './lib/provider'

// DB adapters (Drizzle)
export { createAgentsDb, createWikiDb, getDb, getPool, closeDb } from './lib/db'

// Embeddings
export { EmbeddingsService, createEmbeddingsService } from './lib/embeddings'

// Parsers
export { parseFile, parseBuffer } from './lib/parsers'
export type { FileType } from './lib/parsers'

// FS
export { WikiFsAdapter, syncWikiToFilesystem } from './lib/fs'

// Bootstrap (runtime composition)
export { bootstrap } from './bootstrap'
export type { NexusRuntime } from './bootstrap'

// AIOS Master
export { executeTask } from './lib/aios/aios-master'
export type { AiosTaskRequest } from './lib/aios/aios-master'

// Skill Executor
export { executeSkill } from './lib/skills/skill-executor'
export type { SkillInput, SkillOutput } from './lib/skills/skill-executor'
