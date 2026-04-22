# Fase 21BC — Gerenciamento Individual de Skills e Canais

**Data:** 2026-04-21  
**Status:** Aprovado  
**Escopo:** Endpoints individuais de CRUD para skills e canais de um agente

---

## Contexto

A Fase 21A adicionou upsert bulk de skills e canais via `POST /agents` e `PATCH /agents/:id`. Não existe endpoint para adicionar, atualizar ou remover uma skill ou canal individualmente após a criação do agente.

Esta fase fecha esse gap com 6 endpoints novos: 3 para skills, 3 para canais.

---

## Decisões de design

- **Dois arquivos separados:** `agent-skills.ts` e `agent-channels.ts` — um arquivo por recurso, evita crescer `agents.ts` (já ~280 linhas)
- **POST = criar estritamente:** retorna 409 se já existe. Para atualizar, usar PATCH. Semântica limpa e previsível
- **PATCH = atualizar parcialmente:** apenas campos enviados são atualizados
- **DELETE = hard delete:** remove o registro. Para desabilitar sem remover, usar `PATCH` com `enabled: false`
- **Agente arquivado → 404:** nenhuma operação em agentes arquivados
- **Reutilização de validators:** `isValidSkillId`, `isValidChannelType`, `validateChannelConfig` já em `agents.types.ts`

---

## Arquivos modificados / criados

| Arquivo | Operação |
|---|---|
| `apps/server/src/routes/agent-skills.ts` | Criar |
| `apps/server/src/routes/agent-channels.ts` | Criar |
| `apps/server/src/app.ts` | Modificar — registrar os dois novos módulos |
| `apps/server/src/__tests__/e2e/agents.test.ts` | Modificar — adicionar testes dos 6 endpoints |

---

## Endpoints — Skills

Todos os endpoints verificam que o agente existe e pertence ao `tenant_id` do JWT antes de operar.

### POST /agents/:id/skills

Adiciona uma nova skill ao agente.

**Body:**
```typescript
{
  skill_id: string                          // obrigatório
  enabled?: boolean                         // default: true
  provider_override?: { provider: string; model: string }
  max_tokens_per_call?: number
  max_calls_per_hour?: number
  timeout_ms?: number
}
```

**Fluxo:**
1. Verificar agente existe + pertence ao tenant + não arquivado (404)
2. Validar `skill_id` com `isValidSkillId()` (400)
3. `INSERT INTO agent_skills` — se já existe, retornar 409
4. Retornar 201 com o registro criado

**Resposta 201:**
```json
{
  "data": {
    "id": "uuid",
    "agent_id": "uuid",
    "tenant_id": "uuid",
    "skill_name": "wiki:query",
    "skill_config": { "provider_override": null, "max_tokens_per_call": null, "max_calls_per_hour": null, "timeout_ms": null },
    "enabled": true,
    "created_at": "..."
  }
}
```

**Erros:**
- `400` — `skill_id` inválido
- `404` — agente não existe neste tenant ou está arquivado
- `409` — skill já existe neste agente (usar PATCH para atualizar)

---

### PATCH /agents/:id/skills/:skill_name

Atualiza config de uma skill existente.

**Body:** todos opcionais — apenas campos enviados são atualizados
```typescript
{
  enabled?: boolean
  provider_override?: { provider: string; model: string } | null
  max_tokens_per_call?: number | null
  max_calls_per_hour?: number | null
  timeout_ms?: number | null
}
```

**Fluxo:**
1. Verificar agente existe + pertence ao tenant + não arquivado (404)
2. Verificar skill existe neste agente (404)
3. Construir `partialConfig` apenas com os campos enviados no body (excluindo `enabled`)
4. `UPDATE agent_skills SET enabled = (se enviado), skill_config = skill_config || $partialConfig WHERE agent_id = :id AND skill_name = :skill_name AND tenant_id = :tenantId`
   — o operador `||` do JSONB faz merge shallow: chaves enviadas substituem, chaves ausentes preservadas
5. Retornar 200 com registro atualizado

**Resposta 200:** mesmo shape do POST 201.

**Erros:**
- `404` — agente ou skill não existe

---

### DELETE /agents/:id/skills/:skill_name

Remove uma skill do agente.

**Fluxo:**
1. Verificar agente existe + pertence ao tenant + não arquivado (404)
2. Verificar skill existe neste agente (404)
3. `DELETE FROM agent_skills WHERE agent_id = :id AND skill_name = :skill_name AND tenant_id = :tenantId`
4. Retornar 204 No Content

**Erros:**
- `404` — agente ou skill não existe

---

## Endpoints — Canais

Mesmo padrão de skills. `:channel_type` como chave em vez de `:skill_name`.

### POST /agents/:id/channels

**Body:**
```typescript
{
  channel_type: string    // obrigatório — validado contra VALID_CHANNEL_TYPES
  enabled?: boolean       // default: true
  config: Record<string, unknown>  // obrigatório — validado por validateChannelConfig()
}
```

**Fluxo:**
1. Verificar agente existe + pertence ao tenant + não arquivado (404)
2. Validar `channel_type` com `isValidChannelType()` (400)
3. Validar `config` com `validateChannelConfig()` (400)
4. `INSERT INTO agent_channels` — se já existe, retornar 409
5. Retornar 201 com o registro criado

**Resposta 201:**
```json
{
  "data": {
    "id": "uuid",
    "agent_id": "uuid",
    "tenant_id": "uuid",
    "channel_type": "whatsapp",
    "enabled": true,
    "config": { "evolution_instance": "..." },
    "created_at": "...",
    "updated_at": "..."
  }
}
```

**Erros:**
- `400` — `channel_type` inválido ou `config` incompleto
- `404` — agente não existe neste tenant ou está arquivado
- `409` — canal deste tipo já existe neste agente

---

### PATCH /agents/:id/channels/:channel_type

**Body:**
```typescript
{
  enabled?: boolean
  config?: Record<string, unknown>  // merge parcial — campos enviados substituem os existentes
}
```

**Fluxo:**
1. Verificar agente + canal existem e pertencem ao tenant (404)
2. Se `config` enviado: validar com `validateChannelConfig(channel_type, mergedConfig)` (400)
3. `UPDATE agent_channels SET enabled = ..., config = config || $patch, updated_at = NOW()`
4. Retornar 200 com registro atualizado

**Resposta 200:** mesmo shape do POST 201.

---

### DELETE /agents/:id/channels/:channel_type

**Fluxo:**
1. Verificar agente + canal existem e pertencem ao tenant (404)
2. `DELETE FROM agent_channels WHERE agent_id = :id AND channel_type = :channel_type AND tenant_id = :tenantId`
3. Retornar 204 No Content

---

## Validação de config de canal no PATCH

No PATCH de canal, a validação de `config` usa o config **merged** (existente + patch), não só o patch enviado. Isso evita regressão: um PATCH parcial não pode remover campos obrigatórios que já existiam.

Exemplo: whatsapp requer `evolution_instance`. Um `PATCH { config: { webhook_url: "..." } }` deve validar o config resultante, não apenas o patch.

---

## Testes

Adicionados em `apps/server/src/__tests__/e2e/agents.test.ts`:

```
POST /agents/:id/skills
  ✓ retorna 201 com skill criada
  ✓ retorna 400 para skill_id inválido
  ✓ retorna 404 para agente de outro tenant
  ✓ retorna 404 para agente arquivado
  ✓ retorna 409 para skill já existente

PATCH /agents/:id/skills/:skill_name
  ✓ atualiza enabled
  ✓ atualiza skill_config parcialmente
  ✓ retorna 404 para skill inexistente

DELETE /agents/:id/skills/:skill_name
  ✓ remove skill (204)
  ✓ retorna 404 para skill inexistente

POST /agents/:id/channels
  ✓ retorna 201 com canal criado
  ✓ retorna 400 para channel_type inválido
  ✓ retorna 400 para config inválido (whatsapp sem evolution_instance)
  ✓ retorna 404 para agente de outro tenant
  ✓ retorna 409 para canal já existente

PATCH /agents/:id/channels/:channel_type
  ✓ atualiza enabled
  ✓ atualiza config parcialmente
  ✓ retorna 404 para canal inexistente

DELETE /agents/:id/channels/:channel_type
  ✓ remove canal (204)
  ✓ retorna 404 para canal inexistente
```

---

## Critérios de aceite

- [ ] `npm run typecheck` passa sem erros
- [ ] `npm run lint` passa sem warnings
- [ ] Testes unitários (validators) passam
- [ ] `POST` retorna 409 quando skill/canal já existe
- [ ] `PATCH` de canal valida o config merged (não só o patch)
- [ ] `DELETE` de agente arquivado retorna 404
- [ ] Agente de outro tenant retorna 404 em todas as operações

---

*Spec gerada em 2026-04-21 — aprovada pelo usuário antes da implementação.*
