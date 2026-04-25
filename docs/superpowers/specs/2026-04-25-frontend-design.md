# Ethra Nexus — Frontend Design Spec

**Data:** 2026-04-25  
**Status:** Aprovado

---

## 1. Tech Stack

| Camada | Tecnologia |
|--------|-----------|
| Framework | React 18 + TypeScript 5 strict |
| Build | Vite |
| Roteamento | React Router v6 |
| Server state | TanStack Query v5 |
| Auth state | React Context (AuthContext) + localStorage JWT |
| HTTP | Axios com interceptors (token inject + 401 redirect) |
| Forms | React Hook Form + Zod |
| UI base | shadcn/ui (Radix UI primitives) |
| Estilos | Tailwind CSS |
| Ícones | Lucide React |
| Toasts | Sonner |
| Dark mode | next-themes (class strategy) |
| Charts | Recharts |
| Animações | tailwindcss-animate + classes customizadas nexus-whisper |

**Localização:** `apps/web/src/`

---

## 2. Páginas e Roteamento

### Rotas públicas (sem auth)
| Rota | Componente | Arquivo |
|------|-----------|---------|
| `/login` | LoginPage | `pages/LoginPage.tsx` |
| `/signup` | SignupPage | `pages/SignupPage.tsx` |

### Rotas privadas (requerem JWT válido)
| Rota | Componente | Arquivo |
|------|-----------|---------|
| `/` | redirect → `/dashboard` | — |
| `/dashboard` | DashboardPage | `pages/DashboardPage.tsx` |
| `/agents` | AgentsPage | `pages/AgentsPage.tsx` |
| `/agents/new` | AgentNewPage | `pages/AgentNewPage.tsx` |
| `/agents/:id` | AgentDetailPage | `pages/AgentDetailPage.tsx` |
| `/agents/:id/budget` | redirect → AgentDetailPage (aba Budget) | — |
| `/wiki` | WikiPage | `pages/WikiPage.tsx` |
| `/settings` | SettingsPage | `pages/SettingsPage.tsx` |

**Layout wrapper:** `components/layout/AppLayout.tsx` — envolve todas as rotas privadas, renderiza Sidebar + main content.

**Guard:** `components/auth/PrivateRoute.tsx` — redireciona `/login` se não autenticado.

---

## 3. Fluxo de Autenticação

### Login
1. Usuário preenche email + senha em `LoginPage`
2. POST `/api/v1/auth/login` → `{ token, tenant_id, user_id }`
3. `AuthContext.login(token)` salva no localStorage
4. Axios interceptor injeta `Authorization: Bearer <token>` em todas as requisições
5. Interceptor de resposta: status 401 → `AuthContext.logout()` → redirect `/login`
6. Redirect para `/dashboard`

### Signup
1. Usuário preenche nome, email, senha em `SignupPage`
2. POST `/api/v1/auth/signup` → `{ token, tenant_id, user_id }`
3. Mesmo fluxo de persistência do login
4. Redirect para `/dashboard`

> **Nota backend:** O endpoint `/api/v1/auth/signup` precisa ser criado (não existe ainda).

### Logout
- Botão na parte inferior da Sidebar
- `AuthContext.logout()` → remove token do localStorage → redirect `/login`

---

## 4. Design System — "Surface of Consciousness" (adaptado)

Baseado no visual language do repositório nexus-whisper, adaptado para interface de produto.

### Paleta de cores

```css
/* Light mode */
--background:        HSL(45 33% 97%);   /* paper cream */
--foreground:        HSL(0 0% 20%);     /* ink dark */
--accent:            HSL(218 90% 45%);  /* cobalt */
--accent-glow:       HSL(218 90% 45% / 0.2);
--border:            HSL(45 33% 88%);   /* paper border */
--card:              #ffffff;
--muted:             HSL(45 20% 93%);
--muted-foreground:  HSL(0 0% 55%);

/* Status */
--status-active:     #22c55e;
--status-warning:    #f59e0b;
--status-error:      #ef4444;

/* Dark mode */
--background:        HSL(0 0% 8%);
--foreground:        HSL(45 33% 92%);
--border:            HSL(0 0% 18%);
--card:              HSL(0 0% 11%);
```

### Tipografia

```css
/* Headings — nome do agente, títulos de página */
font-family: 'Playfair Display', Georgia, serif;
font-weight: 400;

/* Body, labels, inputs */
font-family: 'Inter', system-ui, sans-serif;
font-weight: 300;

/* Valores numéricos, código */
font-family: ui-monospace, 'Fira Code', monospace;
```

Google Fonts: `Playfair+Display:ital,wght@0,400;0,600;1,400` + `Inter:wght@300;400;500;600`

### Textura de papel

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(circle at 1px 1px, HSL(0 0% 0% / 0.015) 1px, transparent 0),
    radial-gradient(circle at 3px 3px, HSL(0 0% 0% / 0.008) 1px, transparent 0);
  background-size: 3px 3px, 7px 7px;
  z-index: 9999;
}
```

### Animações

```css
/* Status ativo — breathing glow */
.halo-pulse {
  animation: halo-pulse 6s ease-in-out infinite;
}
@keyframes halo-pulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-glow); }
  50%       { box-shadow: 0 0 12px 4px var(--accent-glow); }
}

/* Nav item ativo — cobalt underline */
.cobalt-underline {
  position: relative;
}
.cobalt-underline::after {
  content: '';
  position: absolute;
  bottom: -2px; left: 0; right: 0;
  height: 2px;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}

/* Fade de componentes ao montar */
.mist-in {
  animation: mist-in 0.4s ease forwards;
}
@keyframes mist-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Logo/brand — phantom letters */
.phantom-letter {
  animation: phantom 1.4s ease forwards;
}
@keyframes phantom {
  from { opacity: 0; filter: blur(4px); }
  to   { opacity: 1; filter: blur(0); }
}
```

### Componentes shadcn/ui usados

| Componente | Uso |
|-----------|-----|
| Button | Ações primárias (cobalt fill), outline, ghost |
| Card | Container de KPIs, listagens |
| Badge | Status de agentes (ativo/pausado) + halo-pulse |
| Tabs | Seções da página de detalhe de agente |
| Dialog | Confirmações, formulários compactos |
| Tooltip | Labels da sidebar icon-only |
| Skeleton | Loading states de cards/listas |
| Separator | Divisores visuais |
| Avatar | Avatar do usuário na sidebar |
| Input/Textarea | Formulários de agente |
| Select | Dropdowns de skill, canal, modelo |
| Switch | Toggle de status ativo/inativo |
| Slider | Threshold de budget |
| Progress | Budget percent_used |
| Toast (Sonner) | Confirmações de ação |

---

## 5. Estrutura de Layout

### Sidebar (`components/layout/Sidebar.tsx`)
- Largura: 56px (collapsed, icon-only) → 200px (expanded, on hover)
- Transição: `transition: width 200ms ease`
- Itens de navegação: Dashboard, Agents, Wiki, Settings
- Item ativo: fundo cobalt tint + `.cobalt-underline`
- Rodapé: avatar do usuário + botão logout
- Tooltip (shadcn/ui) em cada ícone quando collapsed

### AppLayout (`components/layout/AppLayout.tsx`)
```
┌──────────┬─────────────────────────────────────┐
│ Sidebar  │  <main>                             │
│  56px    │    <Outlet />                       │
│ (expand) │                                     │
└──────────┴─────────────────────────────────────┘
```

---

## 6. Páginas em Detalhe

### DashboardPage
- 3 KPI cards: Agentes ativos, Execuções do mês, Custo USD
- Lista de agentes recentes com status badge + `.halo-pulse` no verde
- Data fetching: `useQuery(['dashboard'], fetchDashboard)`
- Loading: Skeleton cards

### AgentsPage
- Lista completa de agentes com busca (input filter client-side)
- Botão "+ Novo Agente" → `/agents/new`
- Cada linha: nome (Playfair), role badge, status badge, ações (Editar, Excluir)

### AgentDetailPage — Split Layout
```
┌──────────────┬─────────────────────────────────┐
│ Menu lateral │  Conteúdo da seção ativa        │
│  fixo 200px  │                                 │
│              │                                 │
│ • Identidade │  Formulário ou dados            │
│ • Skills     │  com React Hook Form + Zod      │
│ • Wiki       │                                 │
│ • Budget     │                                 │
│ • Feedback   │                                 │
└──────────────┴─────────────────────────────────┘
```
- Seção **Identidade**: nome, role, system_prompt, status toggle
- Seção **Skills**: lista de skills atribuídas, adicionar/remover
- Seção **Wiki**: status da wiki, botão ingest, últimas páginas
- Seção **Budget**: Progress bar (percent_used), limit_usd input, histórico
- Seção **Feedback**: lista de feedbacks com rating stars, avg_rating
- Persistência de seção ativa: URL hash (`#identity`, `#skills`, `#wiki`, `#budget`, `#feedback`)
- `useMutation` para salvar cada seção individualmente

### LoginPage / SignupPage
- Centralizado, card 400px max-width
- Logo "Ethra Nexus" com `.phantom-letter` no carregamento
- Formulário com React Hook Form + Zod validation
- Link de alternância Login ↔ Signup

---

## 7. Data Fetching — TanStack Query

### Query keys e endpoints

```typescript
// Agentes
['agents']                    → GET /api/v1/agents
['agents', id]                → GET /api/v1/agents/:id
['agents', id, 'budget']      → GET /api/v1/agents/:id/budget
['agents', id, 'feedback']    → GET /api/v1/agents/:id/feedback
['agents', id, 'skills']      → GET /api/v1/agents/:id/skills
['agents', id, 'channels']    → GET /api/v1/agents/:id/channels

// Dashboard
['dashboard']                 → GET /api/v1/dashboard
// Prerequisito backend: endpoint novo, retorna { agents_active, executions_month, cost_usd_month, recent_agents[] }
```

### Mutations (invalidam queries após sucesso)
- `createAgent` → invalida `['agents']`
- `updateAgent` → invalida `['agents', id]`
- `updateBudget` → invalida `['agents', id, 'budget']`
- `postFeedback` → invalida `['agents', id, 'feedback']`
- `deleteAgent` → invalida `['agents']`

---

## 8. Estrutura de Arquivos

```
apps/web/src/
├── components/
│   ├── auth/
│   │   └── PrivateRoute.tsx
│   ├── layout/
│   │   ├── AppLayout.tsx
│   │   └── Sidebar.tsx
│   ├── agents/
│   │   ├── AgentCard.tsx
│   │   ├── AgentForm.tsx
│   │   ├── AgentStatusBadge.tsx
│   │   ├── sections/
│   │   │   ├── IdentitySection.tsx
│   │   │   ├── SkillsSection.tsx
│   │   │   ├── WikiSection.tsx
│   │   │   ├── BudgetSection.tsx
│   │   │   └── FeedbackSection.tsx
│   ├── dashboard/
│   │   ├── KpiCard.tsx
│   │   └── AgentActivityList.tsx
│   └── ui/                   ← shadcn/ui components (gerados)
├── contexts/
│   └── AuthContext.tsx
├── hooks/
│   ├── useAgents.ts          ← TanStack Query wrappers
│   ├── useAgent.ts
│   ├── useBudget.ts
│   └── useFeedback.ts
├── lib/
│   ├── api.ts                ← axios instance + interceptors
│   ├── queryClient.ts        ← TanStack Query config
│   └── schemas/              ← Zod schemas por entidade
│       ├── agent.schema.ts
│       └── auth.schema.ts
├── pages/
│   ├── LoginPage.tsx
│   ├── SignupPage.tsx
│   ├── DashboardPage.tsx
│   ├── AgentsPage.tsx
│   ├── AgentNewPage.tsx
│   ├── AgentDetailPage.tsx
│   ├── WikiPage.tsx
│   └── SettingsPage.tsx
├── styles/
│   └── globals.css           ← design tokens + animações nexus-whisper
├── App.tsx                   ← Router + QueryClientProvider + ThemeProvider
└── main.tsx
```

---

## 9. Critérios de Aceite

- [ ] `npm run typecheck` passa sem erros em `apps/web`
- [ ] Todas as páginas têm loading state (Skeleton ou spinner)
- [ ] Erro de rede exibe toast via Sonner
- [ ] 401 redireciona para `/login` automaticamente
- [ ] Dark mode funcional via toggle na sidebar
- [ ] Sidebar expande/colapsa com transição suave
- [ ] Formulários validam com Zod antes de submeter
- [ ] Budget Progress bar reflete `percent_used` da API
