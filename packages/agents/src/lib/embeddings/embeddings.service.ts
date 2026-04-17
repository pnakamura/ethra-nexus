import OpenAI from 'openai'
import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'

// ============================================================
// Embeddings Service
//
// Gera embeddings vetoriais para busca semântica (pgvector).
// Default: OpenAI text-embedding-3-small com dimensions=1536
// (compatível com a coluna vector(1536) nas tabelas wiki)
//
// Migrado de @supabase/supabase-js para Drizzle ORM direto.
// ============================================================

export interface EmbeddingsConfig {
  provider: 'openai' | 'openrouter'
  model: string
  dimensions: number
  apiKey: string
  baseUrl?: string
}

const DEFAULT_CONFIG: Omit<EmbeddingsConfig, 'apiKey'> = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 1536,
}

export class EmbeddingsService {
  private client: OpenAI
  private config: EmbeddingsConfig

  constructor(config: Partial<EmbeddingsConfig> & { apiKey: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
    })
  }

  async generate(text: string): Promise<number[]> {
    const truncated = text.slice(0, 30000)

    const response = await this.client.embeddings.create({
      model: this.config.model,
      input: truncated,
      dimensions: this.config.dimensions,
    })

    const embedding = response.data[0]?.embedding
    if (!embedding) throw new Error('Embeddings API returned empty result')

    return embedding
  }

  async upsertPageEmbedding(table: string, pageId: string, embedding: number[]): Promise<void> {
    const db = getDb()
    const vectorStr = `[${embedding.join(',')}]`
    await db.execute(
      sql.raw(`UPDATE ${table} SET embedding = '${vectorStr}'::vector WHERE id = '${pageId}'`),
    )
  }
}

export function createEmbeddingsService(): EmbeddingsService {
  const apiKey = process.env['OPENAI_API_KEY'] ?? process.env['OPENROUTER_API_KEY']
  if (!apiKey) throw new Error('OPENAI_API_KEY or OPENROUTER_API_KEY required for embeddings')

  const isOpenRouter = !process.env['OPENAI_API_KEY']

  return new EmbeddingsService({
    apiKey,
    provider: isOpenRouter ? 'openrouter' : 'openai',
    baseUrl: isOpenRouter ? 'https://openrouter.ai/api/v1' : undefined,
  })
}
