import { createAgentsDb, createWikiDb } from './lib/db'
import { createRegistryFromEnv } from './lib/provider/registry'
import { createEmbeddingsService } from './lib/embeddings'
import { WikiFsAdapter } from './lib/fs'

// ============================================================
// Bootstrap — monta dependências do runtime
//
// Migrado de @supabase/supabase-js para Drizzle ORM.
// Chamado UMA VEZ no startup do servidor.
//
// O orchestrator será reconstruído na Fase 6.
// ============================================================

export interface NexusRuntime {
  agentsDb: ReturnType<typeof createAgentsDb>
  wikiDb: ReturnType<typeof createWikiDb>
  embeddings: ReturnType<typeof createEmbeddingsService>
  fs: WikiFsAdapter
  providerRegistry: ReturnType<typeof createRegistryFromEnv>
}

export function bootstrap(): NexusRuntime {
  const agentsDb = createAgentsDb()
  const wikiDb = createWikiDb()
  const providerRegistry = createRegistryFromEnv()
  const embeddings = createEmbeddingsService()
  const fs = new WikiFsAdapter()

  return { agentsDb, wikiDb, embeddings, fs, providerRegistry }
}
