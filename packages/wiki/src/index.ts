// @ethra-nexus/wiki — pure logic (no DB dependency)
//
// Sub-fase 5a: embedding + index generator.
// Sub-fase 5b: extract (LLM extrai páginas de documento bruto).

export { embed } from './embedding'
export { generateStrategicIndex } from './index-generator'
export type { PageSummary } from './index-generator'
export { extractPagesFromContent } from './extract'
export type {
  ExtractedPage,
  ExtractResult,
  PageType,
  PageConfidence,
} from './extract'
