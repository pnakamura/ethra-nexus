// ============================================================
// Input Validation — regras centralizadas
//
// REGRA: toda entrada do usuário, LLM, ou sistema externo
// deve passar por validação antes de ser usada.
// Nenhuma exceção. Nenhum "confia que vem certo".
// ============================================================

import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import type { WikiPageType, WikiConfidence, WikiScope } from '../types/wiki.types'

// ── Wiki Scope ───────────────────────────────────────────────

const WIKI_SCOPE_PATTERN = /^(system|agent-[a-z0-9][a-z0-9-]{0,62})$/

export function validateWikiScope(scope: string): WikiScope {
  if (!WIKI_SCOPE_PATTERN.test(scope)) {
    throw new SecurityValidationError(
      `Invalid wiki scope: "${scope}". Must be "system" or "agent-{slug}" with lowercase alphanumeric and hyphens.`,
    )
  }
  return scope as WikiScope
}

// ── Wiki Page Path ───────────────────────────────────────────

// Permite: letras minúsculas, números, hífens, barras (1 nível de profundidade)
// Rejeita: .., ~, paths absolutos, caracteres especiais, sequências perigosas
const WIKI_PATH_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,3}$/

export function validateWikiPath(path: string): string {
  if (!path || path.length > 256) {
    throw new SecurityValidationError(`Wiki path too long or empty: ${path.length} chars`)
  }

  if (path.includes('..') || path.includes('~') || path.startsWith('/') || path.startsWith('\\')) {
    throw new SecurityValidationError(`Path traversal detected in wiki path: "${path}"`)
  }

  if (!WIKI_PATH_PATTERN.test(path)) {
    throw new SecurityValidationError(
      `Invalid wiki path: "${path}". Use lowercase alphanumeric, hyphens, and forward slashes only. Max 3 levels deep.`,
    )
  }

  return path
}

// ── Wiki Page Type ───────────────────────────────────────────

const VALID_PAGE_TYPES: ReadonlySet<string> = new Set<WikiPageType>([
  'entidade', 'conceito', 'procedimento', 'faq', 'resposta', 'alerta', 'politica', 'log',
])

export function validatePageType(type: string): WikiPageType {
  if (!VALID_PAGE_TYPES.has(type)) {
    throw new SecurityValidationError(
      `Invalid page type: "${type}". Must be one of: ${[...VALID_PAGE_TYPES].join(', ')}`,
    )
  }
  return type as WikiPageType
}

// ── Wiki Confidence ──────────────────────────────────────────

const VALID_CONFIDENCES: ReadonlySet<string> = new Set<WikiConfidence>([
  'alta', 'media', 'baixa', 'pendente',
])

export function validateConfidence(confidence: string): WikiConfidence {
  if (!VALID_CONFIDENCES.has(confidence)) {
    throw new SecurityValidationError(
      `Invalid confidence level: "${confidence}". Must be: alta, media, baixa, or pendente`,
    )
  }
  return confidence as WikiConfidence
}

// ── Cron Expression ──────────────────────────────────────────

// Aceita: 5 campos (min hora dia mês diaDaSemana)
// Cada campo: * | */N | número | range | lista | combinações com step (ex: 1-5/2)
const CRON_PATTERN = /^(\*(?:\/[0-9]+)?|[0-9,\-\/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-\/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-\/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-\/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-\/]+)$/

export function validateCronExpression(cron: string): string {
  if (!CRON_PATTERN.test(cron.trim())) {
    throw new SecurityValidationError(`Invalid cron expression: "${cron}"`)
  }

  const parts = cron.trim().split(/\s+/)

  // Impede execuções mais frequentes que 1/minuto (DoS)
  if (parts[0] === '*' && parts[1] === '*') {
    throw new SecurityValidationError(
      `Cron expression too frequent: "${cron}". Minimum interval is 1 minute.`,
    )
  }

  return cron.trim()
}

// ── Tenant Slug ──────────────────────────────────────────────

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

export function validateSlug(slug: string): string {
  if (!SLUG_PATTERN.test(slug)) {
    throw new SecurityValidationError(
      `Invalid slug: "${slug}". Must be 3-64 chars, lowercase alphanumeric and hyphens, cannot start/end with hyphen.`,
    )
  }

  // Rejeita slugs reservados
  const RESERVED_SLUGS = new Set([
    'admin', 'api', 'system', 'root', 'null', 'undefined',
    'login', 'auth', 'health', 'status', 'webhook', 'internal',
  ])

  if (RESERVED_SLUGS.has(slug)) {
    throw new SecurityValidationError(`Slug "${slug}" is reserved and cannot be used.`)
  }

  return slug
}

// ── File System Path Safety ──────────────────────────────────

export function validateFileSystemPath(
  inputPath: string,
  allowedBase: string,
): string {
  // Normaliza separadores
  const normalized = inputPath.replace(/\\/g, '/')

  // Rejeita path traversal
  if (normalized.includes('..') || normalized.includes('~')) {
    throw new SecurityValidationError(`Path traversal detected: "${inputPath}"`)
  }

  // Verifica que o path resultante está dentro do diretório permitido
  const normalizedBase = allowedBase.replace(/\\/g, '/')
  if (!normalized.startsWith(normalizedBase + '/') && normalized !== normalizedBase) {
    throw new SecurityValidationError(
      `Path "${inputPath}" escapes allowed directory "${allowedBase}"`,
    )
  }

  return normalized
}

// ── Content Length Limits ────────────────────────────────────

export function validateContentLength(
  content: string,
  maxLength: number,
  fieldName: string,
): string {
  if (content.length > maxLength) {
    throw new SecurityValidationError(
      `${fieldName} exceeds maximum length: ${content.length} > ${maxLength}`,
    )
  }
  return content
}

// ── UUID Format ──────────────────────────────────────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateUUID(value: string, fieldName: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new SecurityValidationError(`Invalid UUID for ${fieldName}: "${value}"`)
  }
  return value
}

// ── Error Class ──────────────────────────────────────────────

export class SecurityValidationError extends Error {
  readonly code = 'SECURITY_VALIDATION_ERROR' as const

  constructor(message: string) {
    super(message)
    this.name = 'SecurityValidationError'
  }
}

const BLOCKED_RANGES: readonly RegExp[] = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fe[89ab][0-9a-f]:/i,   // fe80::/10 link-local
  /^fc/i,                   // fc00::/7  unique-local
  /^fd/i,                   // fd00::/8  unique-local (assigned)
]

export async function validateExternalUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new SecurityValidationError('URL inválida')
  }
  if (parsed.protocol !== 'https:') {
    throw new SecurityValidationError('A2A agents devem usar HTTPS')
  }
  let addresses: LookupAddress[]
  try {
    addresses = await lookup(parsed.hostname, { all: true })
  } catch {
    throw new SecurityValidationError(`DNS resolution failed for host: ${parsed.hostname}`)
  }
  for (const { address } of addresses) {
    if (BLOCKED_RANGES.some((re) => re.test(address))) {
      throw new SecurityValidationError(`IP bloqueado para agente A2A: ${address}`)
    }
  }
}

// ── MIME Type ────────────────────────────────────────────

const MIME_RE = /^[a-z]+\/[a-z0-9\-+.]+$/i

export function validateMimeType(input: string): string {
  if (typeof input !== 'string' || !MIME_RE.test(input)) {
    throw new SecurityValidationError('Invalid mime_type')
  }
  return input
}

// ── Expires At ───────────────────────────────────────────

export function validateExpiresAt(input: string | null | undefined): Date | null {
  if (input === null || input === undefined) return null
  const d = new Date(input)
  if (isNaN(d.getTime())) {
    throw new SecurityValidationError('Invalid expires_at: must be ISO8601')
  }
  if (d.getTime() <= Date.now() + 60_000) {
    throw new SecurityValidationError('Invalid expires_at: must be at least 1 minute in the future (not in the past)')
  }
  return d
}
