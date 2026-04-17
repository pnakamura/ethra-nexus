// ============================================================
// Input Validation — regras centralizadas
//
// REGRA: toda entrada do usuário, LLM, ou sistema externo
// deve passar por validação antes de ser usada.
// Nenhuma exceção. Nenhum "confia que vem certo".
// ============================================================

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
const CRON_PATTERN = /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/

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
  if (!normalized.startsWith(normalizedBase)) {
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
