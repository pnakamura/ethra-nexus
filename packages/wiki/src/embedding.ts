import OpenAI from 'openai'

// ============================================================
// Embedding — gera vetor para busca semântica
//
// OpenAI text-embedding-3-small com 1536 dimensões
// (compatível com vector(1536) nas tabelas wiki_*)
// ============================================================

const MODEL = 'text-embedding-3-small'
const DIMENSIONS = 1536
const MAX_INPUT_CHARS = 30000

let client: OpenAI | null = null

function getClient(): OpenAI {
  if (client) return client
  const apiKey = process.env['OPENAI_API_KEY']
  if (!apiKey) throw new Error('OPENAI_API_KEY required')
  client = new OpenAI({ apiKey })
  return client
}

export async function embed(text: string): Promise<number[]> {
  const truncated = text.slice(0, MAX_INPUT_CHARS)
  const response = await getClient().embeddings.create({
    model: MODEL,
    input: truncated,
    dimensions: DIMENSIONS,
  })
  const vector = response.data[0]?.embedding
  if (!vector) throw new Error('Embedding API returned empty result')
  return vector
}
