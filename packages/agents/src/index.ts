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

// Scheduler
export { startSchedulerLoop } from './lib/scheduler/scheduler-loop'
export { emitEvent } from './lib/scheduler/event-bus'
export type { BusEventType, QueuedEvent } from './lib/scheduler/event-bus'
export { validateCron, calcNextRun } from './lib/scheduler/cron-utils'
export { dispatchOutput } from './lib/scheduler/output-dispatcher'
export type { DispatchSource } from './lib/scheduler/output-dispatcher'

// Storage
export * from './lib/storage'

// Alerts
export * from './lib/alerts'

// Wiki Writer
export { writeLesson } from './lib/wiki/wiki-writer'
export type { WikiLessonInput } from './lib/wiki/wiki-writer'

// A2A Protocol
export { A2AClient } from './lib/a2a/client'
export { AgentCardSchema } from './lib/a2a/schemas'
export type { ValidatedAgentCard } from './lib/a2a/schemas'

// Copilot (Admin Shell)
export {
  getAnthropicClient,
  AIOS_MASTER_SYSTEM_PROMPT,
  executeToolCall,
  getToolsForAnthropic,
  allCopilotTools,
  findToolByName,
  executeCopilotTurn,
  generateAutoTitle,
} from './lib/copilot'
export type { CopilotTool, ToolContext, ToolCallResult, ExecuteCopilotTurnParams, TurnResult, SseWriter } from './lib/copilot'
