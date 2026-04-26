# Frontend MVP — Design Spec

**Data:** 2026-04-26
**Escopo:** primeira versão funcional do `apps/web` (ETHRA APERTURE) integrada ao backend Ethra Nexus.
**Referências:** `docs/design-system.md` (identidade visual e padrões de layout), `CLAUDE.md` (constitution), spec de session brainstorming 2026-04-26.

---

## 1. Resumo executivo

3 telas funcionais (Login, Mission Control, Agentes) + 6 sub-rotas de tab dentro do detalhe de agente. Foco em **leitura primeiro** (Mission Control), depois **gestão** (Agentes CRUD). Sem execução de tarefas pela UI nesta fase — Orquestrador, Wiki, Heartbeat, Quality, Performance, Goals e Automação ficam para fases 2-3.

**Princípio:** identidade visual ETHRA APERTURE (Swiss/Brutalist Minimalist, branco/preto/cobalto absolutos, hairline 0.5px, Inter + JetBrains Mono, spring motion) — ver `docs/design-system.md` como fonte canônica.

**Stack:** React 18 + Vite + Tailwind + shadcn/ui (47 primitivos) + Radix + Framer Motion + TanStack Query + react-router-dom v6.30 + react-hook-form + zod + sonner + next-themes.

---

## 2. Escopo

### 2.1 Dentro do MVP

| Tela | Path | Conteúdo |
|---|---|---|
| Login | `/login` | Form slug + password, fullscreen centralizado |
| Mission Control | `/mission-control` | 3 KPIs + Agent Roster + Activity Feed |
| Agentes — Lista | `/agents` | Tabela com filtros + modal "Novo Agente" |
| Agentes — Detail | `/agents/:id` | redirect para `/agents/:id/identity` |
| Agentes — Identity | `/agents/:id/identity` | Form completo de identidade |
| Agentes — Skills | `/agents/:id/skills` | Lista + add/edit/delete de skills |
| Agentes — Channels | `/agents/:id/channels` | Lista + add/edit/delete de channels |
| Agentes — Budget | `/agents/:id/budget` | Status atual + edit limite |
| Agentes — Wiki | `/agents/:id/wiki` | Form wiki_enabled, top_k, min_score, write_mode |
| Agentes — A2A | `/agents/:id/a2a` | Toggle a2a + Agent Card preview + API keys |

### 2.2 Fora do MVP (explícito)

- Telas: Performance, Heartbeat, Quality Gates, Goal Alignment, Wiki/Bibliotecário, Automação, Budget Control standalone, Orquestrador
- Cadastro de tenant pela UI (signup) — login-only
- WebSocket / SSE / real-time
- Drag-and-drop em qualquer lista
- i18n — texto fixo em pt-BR
- Mobile-optimized — responsive básico só
- Error tracking (Sentry, etc.)
- Analytics de uso
- Onboarding/tour
- Notificações (push, email)
- Refresh token — usuário relogga toda 24h
- Acessibilidade avançada (auditoria screen reader)

---

## 3. Estrutura de pastas

```
apps/web/
├── src/
│   ├── components/
│   │   ├── ui/                         # 47 primitivos shadcn (cópia do boilerplate)
│   │   └── aperture/                   # compostos APERTURE
│   │       ├── sidebar.tsx             # 60↔220px collapsable
│   │       ├── page-header.tsx         # breadcrumb + title + LIVE badge
│   │       ├── kpi-card.tsx
│   │       ├── agent-roster-card.tsx
│   │       ├── activity-feed.tsx
│   │       ├── status-pill.tsx
│   │       └── theme-toggle.tsx
│   ├── pages/
│   │   ├── login.tsx
│   │   ├── mission-control.tsx
│   │   ├── not-found.tsx               # 404 minimalista
│   │   └── agents/
│   │       ├── list.tsx                # /agents
│   │       ├── detail.tsx              # /agents/:id (layout com Tabs + Outlet)
│   │       └── tabs/
│   │           ├── identity.tsx
│   │           ├── skills.tsx
│   │           ├── channels.tsx
│   │           ├── budget.tsx
│   │           ├── wiki.tsx
│   │           └── a2a.tsx
│   ├── hooks/
│   │   ├── use-auth.ts                 # Context+useReducer, login/logout/state
│   │   ├── use-agents.ts               # list/get/create/update/archive
│   │   ├── use-agent-budget.ts
│   │   ├── use-aios-events.ts
│   │   └── use-mobile.ts               # já no boilerplate
│   ├── lib/
│   │   ├── api.ts                      # fetch wrapper + JWT interceptor
│   │   ├── utils.ts                    # cn() (já no boilerplate)
│   │   ├── skills-built-in.ts          # lista hardcodada de skills
│   │   └── schemas/
│   │       ├── auth.ts
│   │       ├── agent.ts
│   │       ├── aios-event.ts
│   │       ├── budget.ts
│   │       └── env.ts                  # validação de import.meta.env
│   ├── providers/
│   │   ├── auth-provider.tsx
│   │   └── query-client.tsx
│   ├── routes.tsx                      # config de routing (data router)
│   ├── App.tsx                         # ThemeProvider + providers + RouterProvider + Toaster
│   ├── main.tsx
│   └── index.css                       # CSS vars APERTURE light + DARK refeito + utilitários
├── components.json                     # do boilerplate
├── tailwind.config.ts                  # do boilerplate
├── tsconfig.json                       # ENDURECIDO para strict
├── tsconfig.app.json                   # ENDURECIDO
├── tsconfig.node.json                  # já strict
├── vite.config.ts                      # criar (path alias @/* → ./src/*)
└── package.json
```

**Path alias:** `@/*` → `./src/*` em todos os tsconfigs e vite.config.ts.

---

## 4. Bootstrap (PR isolada antes do MVP)

Para evitar misturar setup com features, bootstrap é PR separada:

1. `mkdir apps/web` + `package.json` herdando deps necessárias do export Lovable
2. `vite.config.ts` com `@vitejs/plugin-react-swc` + path alias `@/*` → `./src/*`
3. Copiar para `src/`: `components/ui/*` (47 arquivos), `index.css` (com tokens dark **refeitos Aperture-aligned** conforme §3.2 do design-system.md), `lib/utils.ts`, `hooks/use-mobile.ts`
4. Copiar configs raiz: `components.json`, `tailwind.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
5. **Endurecer TS strict** em todos os tsconfigs — alinha com `CLAUDE.md`. Esperado: ajustes menores nos primitivos shadcn (são geralmente strict-friendly)
6. Remover `App.css` (Vite default) e `lovable-tagger` das devDependencies
7. Atualizar `index.html`: title "ETHRA APERTURE — AI Orchestration Console", remover meta tags com referências a Lovable
8. Wire up no Turborepo (adicionar `apps/web` como workspace, scripts `dev`/`build`/`typecheck`/`lint`/`test`)
9. CI: estender `.github/workflows/ci.yml` para incluir `apps/web` em typecheck/lint/build (não no e2e)
10. Smoke test: `App.tsx` mínima com `<h1>ETHRA APERTURE</h1>` carrega via `npm run dev`

**Saída esperada:** repo com `apps/web` rodando `vite dev` mostrando uma página em branco styled. CI verde para o novo workspace.

---

## 5. Auth & Routing

### 5.1 Fluxo de autenticação

1. Usuário em `/login` submete `{ slug, password }` → `POST /api/v1/auth/login`
2. Resposta `200 OK` → `{ token, tenant: { id, name, slug } }`
3. Frontend guarda em `localStorage`:
   - `ethra.token` = token
   - `ethra.tenant` = JSON stringificado do tenant
4. Navega para `state.from` (se vinha de redirect) ou `/mission-control`
5. Subsequentes requests adicionam `Authorization: Bearer ${token}` via interceptor
6. **401 em qualquer call** → CustomEvent `ethra:unauthorized` → `AuthProvider` faz logout → toast "Sessão expirada" → redirect `/login`
7. **Logout manual:** limpa `localStorage`, `queryClient.clear()`, navigate `/login`

### 5.2 Estado de auth

```ts
type AuthState = {
  token: string | null
  tenant: { id: string; name: string; slug: string } | null
  isAuthenticated: boolean
  role: 'admin' | null
}
```

Implementação: **Context + useReducer** persistido em `localStorage`. Não usar Zustand — Context cobre o caso de uso.

### 5.3 Mapa de rotas

```
/login                              public
/                                   protected → redirect /mission-control
/mission-control                    protected
/agents                             protected
/agents/:id                         protected → redirect /agents/:id/identity
/agents/:id/identity                protected
/agents/:id/skills                  protected
/agents/:id/channels                protected
/agents/:id/budget                  protected
/agents/:id/wiki                    protected
/agents/:id/a2a                     protected
*                                   404 page
```

**Routing config:** `react-router-dom` com data routers (`createBrowserRouter` + `RouterProvider`).

**ProtectedRoute:** wrapper que checa `useAuth().isAuthenticated`. False → `<Navigate to="/login" replace state={{ from: location }} />`.

**Tabs do agente:** rotas nested renderizadas via `<Outlet />` em `agents/detail.tsx`. Click em tab muda URL → deep link funciona.

### 5.4 Layout shell (rotas protegidas)

```
┌──────────────────────────────────────────────┐
│  ┌────────────┐                              │
│  │            │  ┌─────────────────────────┐│
│  │ Aperture   │  │ <Outlet />              ││
│  │ Sidebar    │  └─────────────────────────┘│
│  │ (60↔220)   │                              │
│  │            │                              │
│  │ ──────────│                              │
│  │ ☀ ☾       │                              │
│  │ ● operator │                              │
│  └────────────┘                              │
└──────────────────────────────────────────────┘
```

- `<AppShell>` envolve rotas protegidas: `<Sidebar /> + <Outlet />` em flex.
- Sidebar mostra **apenas os 2 itens ativos do MVP** (Mission Control, Agentes), agrupados sob o header "SISTEMA". Outros grupos da sidebar canônica (MÓDULOS, CONTRATO, MEMÓRIA) não aparecem nesta fase.
- Theme toggle (icon button Sun/Moon Lucide) no footer da sidebar.
- Login **NÃO** usa shell — fullscreen centered.

---

## 6. Páginas

### 6.1 Login (`/login`)

**Layout:** fullscreen centralizado. Card hairline com:
- Wordmark "ETHRA APERTURE" (mono uppercase, tracking 0.2em)
- Sub: "Console de Orquestração"
- Form: `slug` (input com prefix `@` mono cinza) + `password`
- Botão "ENTRAR" cobalto fullwidth com spinner durante submit

**Form (react-hook-form + zod):**
```ts
const LoginSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'slug inválido'),
  password: z.string().min(1, 'obrigatório'),
})
```

**Submit:** `POST /api/v1/auth/login` → guarda token + redirect.

**Edge cases:**
- Usuário já autenticado acessa `/login` → redirect imediato `/mission-control`
- Erro 4xx/5xx → toast sonner com mensagem do backend

### 6.2 Mission Control (`/mission-control`)

**PageHeader:** breadcrumb "ETHRA NEXUS · MISSION CONTROL" + título "Dashboard Operacional" + sub "Tenant {name} · {date longo}". Direita: LIVE badge cobalto pulsante (`filament-pulse`) + timestamp atualizando 1s.

**Grid:**

```
┌──────────┬──────────┬──────────┐
│ Total    │ Ativos   │ Gasto    │
│ Agentes  │ Agentes  │ Mensal   │
│   12     │   7      │ R$ 84,32 │
└──────────┴──────────┴──────────┘

┌────────────────────┬────────────────────┐
│ AGENT ROSTER       │ ACTIVITY FEED       │
│ ────────────────   │ ────────────────    │
│ • Atendimento      │ 14:32 ✓ ...         │
│   running          │ 14:28 ⚠ ...         │
│   tokens bar       │ ...                 │
└────────────────────┴────────────────────┘
```

**3 KPI cards:**
- Total de agentes — `count(agents)`
- Agentes ativos — `count(agents WHERE status='active')`
- Gasto mensal total — `sum(budgets.spent_usd)` do mês corrente

**Data fetching:**
- `GET /api/v1/agents` alimenta KPIs (count) + Roster
- **Budget por agente:** `GET /api/v1/agents/:id/budget` em paralelo via `useQueries`. KPI de gasto mostra skeleton até soma resolver.
- `GET /api/v1/aios/events?limit=10` alimenta Activity Feed
- **Polling:** Activity Feed `refetchInterval: 10_000`. KPIs/Roster: `refetchOnWindowFocus`.

**Empty states:**
- Sem agentes: card central + CTA "Criar primeiro agente" → `/agents`
- Sem atividade: linha mono cinza "Nenhuma atividade recente."

### 6.3 Agentes — Lista (`/agents`)

**PageHeader:** "AGENTES" + título "Agentes" + sub "{n} agentes ({m} ativos)". Direita: botão "+ NOVO AGENTE" cobalto.

**Toolbar:** input de busca (nome/slug) + filtro de status (Active / Archived / All).

**Tabela** (shadcn Table):

| Nome | Slug | Role | Status | Modelo | Skills | Channels | Budget % | Atividade |

- Hover: `bg-secondary` + cursor pointer → click → `/agents/:id/identity`
- Action menu (`⋯`): Editar, Arquivar, Restaurar (se archived)

**Modal "Novo Agente"** (shadcn Dialog):
- Campos mínimos: `name`, `slug`, `role` (select)
- `POST /api/v1/agents` → fecha modal + navigate `/agents/:newId/identity`
- Skills/channels/budget ficam para tela de edit

### 6.4 Agentes — Detail (`/agents/:id/{tab}`)

**Layout:**

```
┌────────────────────────────────────────────────────────┐
│ AGENTES · Atendimento                                  │
│ Atendimento                            [⋯ AÇÕES]      │
│ atendimento · ACTIVE · claude-sonnet-4-6                │
├────────────────────────────────────────────────────────┤
│ [Identidade][Skills][Channels][Budget][Wiki][A2A]      │
├────────────────────────────────────────────────────────┤
│  <Outlet /> → conteúdo da tab                           │
└────────────────────────────────────────────────────────┘
```

`/agents/:id` → redirect `/agents/:id/identity`. Tabs são links que mudam URL.

#### 6.4.1 Tab `identity`

Form com: `name`, `slug` (read-only após criação), `role`, `model` (select), `system_prompt` (textarea), `system_prompt_extra` (opcional), `response_language` (select), `tone` (select), `restrictions` (multi-input), `description`, `avatar_url`, `tags` (multi-input). Salvar → `PATCH /api/v1/agents/:id`.

#### 6.4.2 Tab `skills`

Lista de skills atribuídas: badge `skill_name` + switch `enabled` + preview de `skill_config` (expand via Collapsible para editar JSON) + delete (com AlertDialog confirm). Botão "+ Adicionar skill" abre Popover com select de skills built-in (lista hardcodada em `lib/skills-built-in.ts` espelhando `packages/core`). API: `POST/PATCH/DELETE /api/v1/agents/:id/skills`.

#### 6.4.3 Tab `channels`

Lista similar. Tipos: whatsapp / webchat / email. Form condicional ao tipo (whatsapp pede `evolution_instance`, email pede `address`, webhook pede `endpoint_url` https). API: `POST/PATCH/DELETE /api/v1/agents/:id/channels`.

#### 6.4.4 Tab `budget`

Card central: "Gasto este mês" valor mono large + barra horizontal hairline com % usado + valor de limite cobalto. Form: `monthly_limit_usd` (input number, step 0.01). Salvar → `PATCH /api/v1/agents/:id/budget`. Sem histórico (backend só expõe mês corrente).

#### 6.4.5 Tab `wiki`

Form: `wiki_enabled` (switch), `wiki_top_k` (slider 1-20, valor mono visível), `wiki_min_score` (slider 0-1 step 0.01), `wiki_write_mode` (radio group: `manual | supervised | auto`). Salvar → `PATCH /api/v1/agents/:id`.

#### 6.4.6 Tab `a2a`

Switch `a2a_enabled`. Quando ON: card com Agent Card preview (link para `/.well-known/agent.json?tenant_slug={slug}` em nova aba) + lista de API keys (`GET /api/v1/a2a/keys` filtrada por agent_id) + botão "+ Nova API Key" → modal → key mostrada **uma única vez** em mono com botão copiar → toast "Esta chave não será mostrada de novo".

### 6.5 404 (`*` route)

Tela minimalista fullscreen, sem sidebar shell:
- Texto centralizado: `404` em `font-mono` very large + linha "Página não encontrada" body.
- Link "← VOLTAR" mono uppercase tracking 0.18em — `navigate(-1)` ou home se não tem histórico.
- Sem ilustrações, sem ornamento (alinha com brutalismo).

---

## 7. State management & data flow

### 7.1 Distribuição de estado

| Tipo | Mecanismo | Onde |
|---|---|---|
| Auth (token, tenant, role) | Context + useReducer | persistido em localStorage |
| Server state | TanStack Query | cache em memória |
| Form state | react-hook-form | local ao componente |
| UI local (modais, dropdowns) | useState | local |

### 7.2 Convenções de query keys

- `['agents']` — lista
- `['agent', id]` — um agente
- `['agent', id, 'budget']` — budget de agente
- `['aios-events']` — feed
- `['a2a', 'keys', agentId]` — API keys de agente

### 7.3 QueryClient defaults

```ts
{
  staleTime: 30_000,
  retry: 1,
  refetchOnWindowFocus: true,
}
```

### 7.4 API client (`lib/api.ts`)

```ts
const BASE = import.meta.env.VITE_API_URL ?? '/api/v1'

class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('ethra.token')
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...init.headers,
    },
  })

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('ethra:unauthorized'))
    throw new ApiError('Sessão expirada', 401)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
    throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get:    <T>(path: string)            => request<T>(path),
  post:   <T>(path: string, body: any) => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: any) => request<T>(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: <T>(path: string)            => request<T>(path, { method: 'DELETE' }),
}
```

### 7.5 Zod usage

| Caso | Validar com zod? |
|---|---|
| Form input do usuário | **Sim** |
| Response da API | **Não** (overhead desnecessário; tipos via `z.infer`) |
| Decode do JWT/localStorage | **Sim** (parse defensivo) |
| Variáveis de ambiente | **Sim** (falha rápido no boot) |

Single source of truth: `schemas/agent.ts` exporta `AgentSchema` + `type Agent = z.infer<typeof AgentSchema>`.

### 7.6 Mutations

`useMutation` com `onSuccess` invalidando queryKey relevante:

```ts
const createAgent = useMutation({
  mutationFn: (input: CreateAgentInput) => api.post('/agents', input),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  onError: (err: ApiError) => toast.error(err.message),
})
```

**Mutations otimistas** em UI rápidas (toggle skill enabled, mudar wiki_enabled): `onMutate` atualiza cache, `onError` faz rollback.

---

## 8. Theme

### 8.1 Setup

```tsx
// App.tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <RouterProvider router={router} />
      <Toaster />
    </AuthProvider>
  </QueryClientProvider>
</ThemeProvider>
```

### 8.2 Tokens

`index.css` tem dois blocos: `:root` (light) e `.dark` (dark APERTURE-aligned conforme §3.2 do `docs/design-system.md`). Dark mode **NÃO** usa o slate genérico do shadcn — refazer com:
- `--background`: `0 0% 0%` (preto absoluto)
- `--foreground`: `0 0% 100%` (branco absoluto)
- `--primary`: `240 100% 60%` (#3333FF — cobalto clareado para contraste WCAG AAA)
- `--border` / `--hairline`: `0 0% 18%` (#2E2E2E)
- E demais conforme tabela completa do design-system.md

### 8.3 Toggle

`<ThemeToggle>` em `components/aperture/theme-toggle.tsx`: icon button Lucide `Sun`/`Moon` que troca via `useTheme()`. Posição: footer da sidebar.

**Switch brusco, sem transição CSS** — alinha com brutalismo APERTURE.

---

## 9. Error handling

| Origem | Tratamento |
|---|---|
| 401 | interceptor → CustomEvent → AuthProvider → logout + toast "Sessão expirada" |
| 4xx (não 401) | `useMutation`/`useQuery` `onError` → `toast.error(error.message)` |
| 5xx | toast.error("Erro no servidor, tente novamente") |
| Network error | toast.error("Erro de conexão") |
| Form validation | inline abaixo do field via react-hook-form + `<FormMessage>` |
| Render error | `errorElement` do react-router-dom v6.30 data router |

---

## 10. Loading & empty states

- **Lista/grid (primeira load):** skeletons via `skeleton.tsx`
- **Refetch silencioso:** sem skeleton, mantém dado velho
- **Mutation em curso:** botão disabled + spinner Lucide `Loader2 animate-spin`
- **Empty states:** mono cinza + texto + CTA opcional. Sem ilustrações.

---

## 11. Testes

| Tipo | Lib | Cobertura |
|---|---|---|
| Unit | vitest | `lib/utils.ts`, schemas, helpers |
| Hooks | vitest + @testing-library/react | use-auth, use-agents, etc. |
| Components | @testing-library/react | KpiCard, ActivityFeed, StatusPill, ThemeToggle |
| Integration | @testing-library/react + msw | Login form, Agent create modal, Identity tab |
| E2E | (Playwright, fora do MVP) | — |

**Cobertura mínima alvo:** 60%. MSW como devDependency para mockar API nos testes de integration.

---

## 12. CI integration

- `apps/web` adicionado como workspace (npm workspaces ou pnpm)
- Scripts no `package.json`: `dev`, `build`, `typecheck`, `lint`, `test`, `test:watch`
- CI atual já roda Turbo em todos os workspaces — só precisa garantir que `apps/web` tenha os scripts esperados
- E2E job continua só para `apps/server`

---

## 13. Deploy

**Estratégia:** build estático servido pelo nginx do stack Docker existente.

- `Dockerfile` ganha stage `web-builder` que roda `vite build` em `apps/web` → output em `dist/`
- `nginx.conf`:
  - `/api/*` → proxy para `apps/server:3000`
  - resto → serve `dist/` com SPA fallback (`try_files $uri /index.html`)
- 1 imagem, 1 deploy, mesma URL pública

Sem CDN / Vercel / Netlify nessa fase.

---

## 14. Critérios de aceite (Definition of Done)

**Auth e shell**
- [ ] `/login` aceita slug + password e autentica contra backend real
- [ ] Após login, redireciona para `/mission-control` (ou `state.from`)
- [ ] Sidebar colapsa/expande, persiste em cookie, atalho `Cmd/Ctrl+B`
- [ ] Theme toggle funciona, persiste em localStorage, dark é Aperture-aligned
- [ ] Logout limpa storage, invalida cache TQ, redireciona `/login`
- [ ] 401 dispara logout automático + toast "Sessão expirada"

**Mission Control**
- [ ] 3 KPIs com dado real + skeleton durante loading
- [ ] Agent Roster: até 10 ativos com modelo, status, tokens bar, custo
- [ ] Activity Feed: últimos eventos com timestamp, status dot, body
- [ ] Polling 10s no feed (verificar via DevTools Network)
- [ ] Empty states funcionam (sem agentes / sem atividade)

**Agentes**
- [ ] `/agents` lista com filtros (search + status)
- [ ] Modal "Novo Agente" cria + redireciona para Identity
- [ ] Tab Identity: carrega + edita + salva
- [ ] Tab Skills: add/edit/delete com config JSON
- [ ] Tab Channels: add/edit/delete (whatsapp, webchat, email)
- [ ] Tab Budget: status atual + edit limite
- [ ] Tab Wiki: edita wiki_enabled, top_k, min_score, write_mode
- [ ] Tab A2A: toggle, lista keys, cria nova (mostrada uma vez)
- [ ] Arquivar agente com AlertDialog confirm
- [ ] Restaurar agente arquivado
- [ ] Mutations otimistas (UI atualiza antes da resposta)

**Cross-cutting**
- [ ] TypeScript `strict: true` em todos os tsconfigs
- [ ] `npm run build` passa sem warnings
- [ ] `npm run test` passa com cobertura ≥ 60%
- [ ] CI verde nos 5 jobs (incluindo apps/web build)
- [ ] Build estático integrado ao Docker stack
- [ ] Smoke test manual em prod: login → ver agente → editar → salvar → ver mudança

---

## 15. Riscos e decisões abertas

1. **TS strict no boilerplate Lovable** — alguns primitivos shadcn podem ter warnings. Mitigação: bootstrap PR endurece tudo, ~1-2 dias de ajustes esperados.

2. **N+1 budgets na Mission Control** — se tenant tem 50 agentes, 50 requests paralelos. Mitigação se virar problema: criar `GET /api/v1/dashboard/summary` agregado no backend (~1 dia).

3. **Token de 24h sem refresh** — UX trade-off aceito; refresh token vira fase 2.

4. **Lovable origin contamination** — confirmar que `lovable-tagger` é removido das devDeps e meta tags do `index.html` na PR de bootstrap.

5. **Skills built-in hardcodadas** — sincronização manual com `packages/core`. Se o backend ganhar/perder skills, frontend precisa update. Aceito por enquanto; criar endpoint backend depois se virar atrito.

---

## 16. Anexos

### 16.1 Endpoints backend consumidos

| Método | Path | Tela |
|---|---|---|
| POST | `/api/v1/auth/login` | Login |
| GET | `/api/v1/agents` | Mission Control + Lista |
| POST | `/api/v1/agents` | Modal "Novo Agente" |
| GET | `/api/v1/agents/:id` | Tab Identity (carregar) |
| PATCH | `/api/v1/agents/:id` | Tabs Identity, Wiki, A2A |
| DELETE | `/api/v1/agents/:id` | Arquivar |
| GET | `/api/v1/agents/:id/budget` | Mission Control + Tab Budget |
| PATCH | `/api/v1/agents/:id/budget` | Tab Budget |
| POST | `/api/v1/agents/:id/skills` | Tab Skills |
| PATCH | `/api/v1/agents/:id/skills/:skill` | Tab Skills |
| DELETE | `/api/v1/agents/:id/skills/:skill` | Tab Skills |
| POST | `/api/v1/agents/:id/channels` | Tab Channels |
| PATCH | `/api/v1/agents/:id/channels/:type` | Tab Channels |
| DELETE | `/api/v1/agents/:id/channels/:type` | Tab Channels |
| GET | `/api/v1/aios/events?limit=10` | Activity Feed |
| GET | `/api/v1/a2a/keys` | Tab A2A |
| POST | `/api/v1/a2a/keys` | Tab A2A |
| DELETE | `/api/v1/a2a/keys/:id` | Tab A2A |

### 16.2 Variáveis de ambiente

```bash
# .env.local (development)
VITE_API_URL=http://localhost:3000/api/v1

# .env.production (build)
VITE_API_URL=/api/v1
```

Validação no boot via `schemas/env.ts`:

```ts
export const EnvSchema = z.object({
  VITE_API_URL: z.string().url().or(z.string().startsWith('/')).default('/api/v1'),
})
export const env = EnvSchema.parse(import.meta.env)
```

### 16.3 Skills built-in (espelho do `packages/core`)

```ts
// lib/skills-built-in.ts
export const BUILT_IN_SKILLS = [
  'wiki:query',
  'wiki:ingest',
  'wiki:lint',
  'channel:respond',
  'channel:proactive',
  'report:generate',
  'monitor:health',
  'monitor:alert',
  'data:analyze',
  'data:extract',
] as const
```

Custom skills permitidas via `custom:{slug}` (validação regex no form).

---

## 17. Próximos passos

1. **Spec self-review** — placeholder scan, consistency check (próxima ação)
2. **User review** — usuário aprova o spec
3. **Writing-plans** — invocar skill para gerar plano de tasks
4. **Subagent-driven-development** — executar plano task por task
