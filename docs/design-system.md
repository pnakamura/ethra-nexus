# ETHRA APERTURE — Design System

> **Identidade visual** do frontend `apps/web` do Ethra Nexus.
> **Origem:** especificação fornecida em 2026-04-26, derivada de boilerplate Lovable
> (`lovable-tagger` em devDeps, meta `author = "Lovable"`).
> **Layouts:** wireframes adicionais derivados de protótipo v2 (single-page React export).
> **Propósito:** documento de referência canônico — sempre consultar antes de tocar em UI.

**Distinção de nomenclatura:**
- **Ethra Nexus** = produto / backend / codebase / infraestrutura (este monorepo)
- **ETHRA APERTURE** = identidade visual / nome da console web (camada de UI em `apps/web`)

---

## 1. Filosofia

> **"Precisão sobre decoração."**

Interface ultra-minimalista para orquestradores de IA, com identidade
**Swiss Design / Brutalist Minimalist** combinada com a precisão de um terminal.
Inspiração declarada: Figma + tipografia modernista + estética terminal.

**Princípios invioláveis:**

1. **Branco absoluto + preto absoluto + um único traço de cobalto.** Qualquer outra cor é exceção justificada (apenas status: red/gray/green).
2. **Linhas de meio pixel (hairline 0.5px) são o vocabulário de separação.** Não use box-shadow, gradientes, glow, blur ou elevação para hierarquizar.
3. **Tipografia faz o trabalho pesado.** Inter para texto, JetBrains Mono para metadata técnica.
4. **Movimento é spring, nunca ease.** Cursor de bloco, pontos pulsantes, indicadores que migram com `layoutId`.
5. **Cada pixel tem propósito funcional.** Zero ornamento.

---

## 2. Stack técnico

| Camada | Escolha | Versão |
|---|---|---|
| Framework | React + TypeScript + Vite | React 18.3, TS 5.8, Vite 5.4 |
| Styling | Tailwind CSS + CSS variables (HSL) | Tailwind 3.4 |
| Plugin de animação Tailwind | `tailwindcss-animate` | 1.0 |
| Componentes base | shadcn/ui (style: default, baseColor: slate) | — |
| Primitivos headless | Radix UI (suite completa) | 1.x / 2.x |
| Animação | Framer Motion (springs) | 12.x |
| Ícones | Lucide React (`strokeWidth: 1.25`) | 0.462 |
| Forms | react-hook-form + @hookform/resolvers + zod | 7.x / 3.x / 3.x |
| Estado server | @tanstack/react-query | 5.x |
| Data viz | recharts (com wrapper `chart.tsx` e theming via CSS vars) | 2.x |
| Toasts | sonner (preferido) + Radix Toast (legado, ambos disponíveis) | 1.x / 1.x |
| Roteamento | react-router-dom | 6.x |
| Theming | next-themes (`darkMode: ["class"]`) | 0.3 |
| Utilitário de classes | `cn()` em `@/lib/utils` (tailwind-merge + clsx) | — |

**Dependências notáveis:** cmdk (command palette via `command.tsx`), embla-carousel-react, vaul (drawer mobile), input-otp, react-day-picker (calendar), react-resizable-panels, date-fns.

---

## 3. Tokens de design

### 3.1 Cores — Light mode (definidas em `src/index.css`)

Tokens são triplos HSL (`H S% L%`) em CSS variables no `src/index.css` e consumidos pelo Tailwind via `hsl(var(--token))`. **Aliases visuais** (paper / ink / hairline / accent) coexistem com **nomes semânticos shadcn** (background / foreground / border / primary).

#### Paleta principal

| Token shadcn | Alias visual | HSL | Hex | Uso |
|---|---|---|---|---|
| `--background` | `--paper` | `0 0% 100%` | `#FFFFFF` | Fundo principal |
| `--foreground` | `--ink` | `0 0% 0%` | `#000000` | Texto e elementos sólidos |
| `--card` | — | `0 0% 100%` | `#FFFFFF` | Fundo de cards |
| `--card-foreground` | — | `0 0% 0%` | `#000000` | Texto de cards |
| `--popover` | — | `0 0% 100%` | `#FFFFFF` | Popovers, dropdowns, tooltips |
| `--popover-foreground` | — | `0 0% 0%` | `#000000` | Texto em popovers |
| `--primary` | `--accent` | `240 100% 50%` | `#0000FF` | **Cobalto — único acento** |
| `--primary-foreground` | — | `0 0% 100%` | `#FFFFFF` | Texto sobre cobalto |
| `--secondary` | — | `0 0% 96%` | `#F5F5F5` | Hover backgrounds |
| `--secondary-foreground` | — | `0 0% 0%` | `#000000` | Texto sobre secondary |
| `--muted` | — | `0 0% 96%` | `#F5F5F5` | Backgrounds neutros |
| `--muted-foreground` | — | `0 0% 45%` | `#737373` | Texto secundário, metadata |
| `--accent` | — | `240 100% 50%` | `#0000FF` | Idêntico a primary (cobalto) |
| `--accent-foreground` | — | `0 0% 100%` | `#FFFFFF` | Texto sobre accent |
| `--destructive` | — | `0 84% 50%` | `#EB1A1A` | Erros, ações destrutivas |
| `--destructive-foreground` | — | `0 0% 100%` | `#FFFFFF` | Texto sobre destructive |
| `--border` | `--hairline` | `0 0% 90%` | `#E5E5E5` | Linhas separadoras |
| `--input` | — | `0 0% 90%` | `#E5E5E5` | Borda de inputs |
| `--ring` | — | `240 100% 50%` | `#0000FF` | Focus ring (cobalto) |
| `--radius` | — | `0px` | — | Border radius universal |

#### Status colors

| Token | HSL | Hex | Significado |
|---|---|---|---|
| `--status-busy` | `0 84% 50%` | `#EB1A1A` | Vermelho — agente ocupado / HITL aguardo |
| `--status-idle` | `0 0% 60%` | `#999999` | Cinza — agente ocioso / backlog |
| `--status-active` | `142 70% 40%` | `#1FAA48` | Verde — agente ativo / concluído |

> ⚠️ **Sidebar tokens** (declarados no `index.css`) usam tons azul-acinzentados slate herdados do shadcn. **Decisão pendente** (§13): alinhar à paleta APERTURE absoluta.

### 3.2 Cores — Dark mode (a refazer)

⚠️ **Decisão tomada (2026-04-26):** o dark mode atual no `index.css` é o tema padrão genérico shadcn (paleta slate azul-acinzentada) e **não preserva a identidade APERTURE**. Será refeito Aperture-aligned.

**Especificação dos tokens dark APERTURE:**

| Token | HSL recomendado | Hex | Razão |
|---|---|---|---|
| `--background` / `--paper` | `0 0% 0%` | `#000000` | Preto absoluto (inversão do light) |
| `--foreground` / `--ink` | `0 0% 100%` | `#FFFFFF` | Branco absoluto |
| `--card` | `0 0% 4%` | `#0A0A0A` | Quase-preto para superfícies elevadas |
| `--popover` | `0 0% 4%` | `#0A0A0A` | Idem |
| `--primary` / `--accent` | `240 100% 60%` | `#3333FF` | Cobalto levemente clareado para contraste em fundo preto |
| `--primary-foreground` | `0 0% 100%` | `#FFFFFF` | Mantém branco sobre cobalto |
| `--secondary` | `0 0% 10%` | `#1A1A1A` | Hover background dark |
| `--muted` | `0 0% 10%` | `#1A1A1A` | Idem |
| `--muted-foreground` | `0 0% 60%` | `#999999` | Cinza médio para metadata |
| `--border` / `--hairline` | `0 0% 18%` | `#2E2E2E` | Hairline dark, contraste suficiente |
| `--input` | `0 0% 18%` | `#2E2E2E` | Idem |
| `--ring` | `240 100% 60%` | `#3333FF` | Cobalto clareado |

**Status colors:** mesmas dos light (vermelho/cinza/verde) com leve ajuste de luminância se necessário para contraste WCAG AA em fundo preto.

**Princípios para dark APERTURE:**
- Preto absoluto + branco absoluto + cobalto preservados.
- Hairline 0.5px continua sendo o vocabulário de separação (cor `#2E2E2E`).
- Zero shadows, zero gradientes, zero glow — a identidade brutalista é a mesma, só inverte a polaridade.
- Toggle via `next-themes` (`class="dark"` no `<html>`).

### 3.3 Tipografia

| Família | Pesos | Uso |
|---|---|---|
| **Inter** | 300, 400, 500, 600, 700 | Texto de interface, headings, body |
| **JetBrains Mono** | 300, 400, 500, 600 | Labels técnicos, métricas, IDs, timestamps |

**Carregamento:** Google Fonts CDN via `@import` no topo de `src/index.css`.

> 🔧 **Otimização pendente:** considerar self-hosting (woff2 em `public/fonts/`).

**Configurações globais aplicadas em `body`:**
```css
font-family: 'Inter', system-ui, sans-serif;
font-feature-settings: "ss01", "cv11";
-webkit-font-smoothing: antialiased;
letter-spacing: -0.01em;
```

**Mono via utilitário:** `.font-mono` aplica `JetBrains Mono` + `tabular-nums`.

**Padrões consistentes:**
- Métricas: `font-mono tabular-nums` (alinhamento de algarismos em colunas)
- Status labels: `uppercase` com `letter-spacing: 0.18em`
- Section headings (sidebar groups, card labels): `font-mono uppercase` com `letter-spacing: 0.14em`
- Exemplos canônicos: `07d`, `200 OK`, `87%`, `1.4ms`, `agent-01`, `$0.094`

### 3.4 Forma e bordas

**Reset global em `index.css`:**
```css
* {
  @apply border-border;
  border-width: 0;  /* ← reset crítico */
}
```

Isso desliga TODA borda por padrão. Bordas só aparecem quando explicitamente declaradas.

**Border radius universal: `0px`.** Sobrescrito em `tailwind.config.ts`. Todo componente shadcn `rounded-*` renderiza reto automaticamente.

**Hairline borders: `0.5px`.** Disponíveis via `border-hairline-*` (Tailwind utility) e classes customizadas (`.border-hairline`, `.border-r-hairline`, etc.) em `index.css`.

**Proibido:** `box-shadow`, gradientes, glow, blur, elevação Z, transformações de escala em hover.

### 3.5 Layout e espaçamento

- **Container Tailwind:** `center: true`, `padding: "2rem"`, `max-width: 1400px` no breakpoint `2xl`.
- **Espaçamento base:** escala padrão Tailwind (4px increments).
- **Breakpoints:** `sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`, `2xl: 1400px` (customizado).

### 3.6 Movimento

**Spring é o padrão** para animações de UI (Framer Motion).

- **Preset spring para painéis e drawers:**
  ```ts
  { type: "spring", stiffness: 380, damping: 32 }
  ```

- **Animações declaradas no Tailwind** (Radix Accordion):
  - `accordion-down` / `accordion-up`: 0.2s ease-out

- **Animações customizadas em `index.css`:**
  - `cursor-blink`: 1.05s steps(1) — cursor de bloco no input principal
  - `filament-pulse`: 2.4s ease-in-out — pontos pulsantes (status active, indicadores live)

- **Indicadores ativos** usam `layoutId` do Framer Motion para animação compartilhada entre estados (rota → barra de 2px de cobalto desliza para a nova posição).

- **Scrollbar customizada (`.scrollbar-minimal`):** 4px wide, track transparent, thumb na cor `--hairline`. Webkit only.

---

## 4. Componentes Aperture-native (primitives)

> Componentes específicos da identidade APERTURE, não fornecidos pelo shadcn.

### 4.1 Intent Stage — `src/components/IntentStage.tsx`
Área de input principal estilo terminal. Cursor de bloco piscando via `.terminal-cursor` (animação `cursor-blink` 1.05s).

### 4.2 Execution Filament — `src/components/ExecutionFilament.tsx`
Log de execução vertical compactado. Pontos pulsantes via `.filament-pulse` (2.4s).

### 4.3 Pulse Footer — `src/components/PulseFooter.tsx`
Barra de vitais do sistema (uptime, status, requests/s). Tipografia mono, métricas tabulares.

> ℹ️ O `ApertureSidebar` original (60px rail + 300px sub-drawer) é **substituído pelo padrão da v2** (60px rail ↔ 220px expandido com toggle persistido). Ver §5.4.

---

## 5. Estrutura de telas e padrões de layout

> **Origem:** wireframes derivados de protótipo v2 (single-page React export, recebido em 2026-04-26).
> **Linguagem:** os layouts abaixo são **estrutura** (grid, hierarquia, fluxo). A **estética visual** é a do APERTURE (§1-3) — não a do v2 original (que era cyberpunk dark).

### 5.1 Inventário de telas (10 módulos)

Sidebar de navegação organiza em 4 grupos:

| Grupo | Módulo | Path proposto | Conteúdo |
|---|---|---|---|
| **SISTEMA** | Mission Control | `/` | Overview com KPIs, agent roster, activity feed |
| | Orquestrador | `/orchestrator` | Conversa com Supervisor + log/kanban |
| | Agentes | `/agents` | CRUD e gestão com expand/collapse |
| **MÓDULOS** | Performance | `/performance` | Analytics: provider usage, decision rates, custo |
| | Automação | `/automation` | Schedulers, alinhamento estratégico, memória |
| **CONTRATO** | Budget Control | `/budget` | Hierarquia C→P→SP→PT |
| | Heartbeat | `/heartbeat` | Logs de runs, sparkline, configuração |
| | Quality Gates | `/quality` | Score, gates status, self-critique |
| | Goal Alignment | `/goals` | Metas com progresso e nudges |
| **MEMÓRIA** | Bibliotecário (Wiki) | `/wiki` | Split-screen sidebar + content + RAG query |

### 5.2 Layouts canônicos (reutilizáveis)

#### **5.2.1 Mission Control — overview pattern**

```
┌────────────────────────────────────────────────────────────┐
│ [BREADCRUMB · MÓDULO]              [● LIVE · 14:32:15]    │
│ Título Principal                                            │
│ Subtítulo / contexto da sessão                              │
├────────────────────────────────────────────────────────────┤
│ ┌──────────┬──────────┬──────────┬──────────┐             │
│ │ KPI 1    │ KPI 2    │ KPI 3    │ KPI 4    │  4 cards    │
│ │ 68%      │ 94/100   │ 12/15    │ 99.8%    │             │
│ │ Meta:80% │ +3 acima │ 3 risco  │ 847 ok   │             │
│ └──────────┴──────────┴──────────┴──────────┘             │
├────────────────────────────────────────────────────────────┤
│ ┌──────────────────┬─────────────────────────┐            │
│ │ AGENT ROSTER     │ Módulos · Status (5x grid)│           │
│ │ ─────────────    │ ─────────────────────────│            │
│ │ • Supervisor     │ ACTIVITY FEED            │            │
│ │   running        │ 14:32 ⚠ Budget desvio   │            │
│ │   tokens bar     │ 14:28 ✓ Quality OK      │            │
│ │ • Heartbeat      │ ...                      │            │
│ │ • ...            │ ─────────────────────────│            │
│ │                  │ HEARTBEAT 24h sparkline  │            │
│ └──────────────────┴─────────────────────────┘            │
└────────────────────────────────────────────────────────────┘
```

**Tradução APERTURE:**
- KPI cards: `border-hairline` (sem `cut-corner` clip-path da v2). Métricas em `font-mono` cor `--ink`. Cobalto reservado para destaque pontual (e.g., trend positivo).
- Agent roster cards: hairline borders + barra vertical 2px cobalto à esquerda quando ativo. Status dot 1.5×1.5px no canto. Tokens bar usa cobalto (não verde).
- Activity feed: lista vertical com timestamp mono à esquerda (`text-muted-foreground`), conteúdo body, hairline divisores. Status dot à direita.
- Heartbeat sparkline: barras de 2px cobalto, gap de 1px. Anomalia usa `--status-busy` (única exceção à paleta absoluta — mesmo padrão da v2).

#### **5.2.2 Split-screen com tabs (Orquestrador, Wiki)**

```
┌──────────────────────────────────────────────────────────┐
│ Header com badge de status                                 │
├────────────────────────┬─────────────────────────────────┤
│                        │ [Tab1] [Tab2]                    │
│ ESQUERDA               │ ────────────────────────────────│
│ (chat / lista de docs) │ DIREITA                          │
│                        │ (log linear OU kanban)           │
│                        │                                  │
│ ─────────────────      │ ────────────────────────────────│
│ [input + send]         │ HITL approval card (se aplicável)│
└────────────────────────┴─────────────────────────────────┘
```

- Grid: `grid-template-columns: 1fr 1fr` (50/50, Orquestrador) ou `260px 1fr` (sidebar fixa + main, Wiki).
- Divisor central: `border-r-hairline`.
- Cada coluna scroll independente; header e footer fixos por coluna.

#### **5.2.3 Kanban board — 4 colunas**

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ ● BACKLOG  3 │ ● EM EXEC  2 │ ● HITL    2  │ ● CONCLUÍDO 5│
├──────────────┼──────────────┼──────────────┼──────────────┤
│ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐│
│ │ Título   │ │ │ Título   │ │ │ Título   │ │ │ Título   ││
│ │ ──────   │ │ │ ──────   │ │ │ ──────   │ │ │ ──────   ││
│ │ 🤖 Agente│ │ │ 🤖 Agente│ │ │ 🤖 Agente│ │ │ 🤖 Agente││
│ │ [tag][tag│ │ │ [tag]    │ │ │ [tag]    │ │ │ [tag]    ││
│ │ ●  HITL  │ │ │ ●  14:41 │ │ │ ●  HITL  │ │ │ ●  14:28 ││
│ └──────────┘ │ └──────────┘ │ └──────────┘ │ └──────────┘│
│ + tarefa     │ ...          │ ...          │ ...          │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

**Coluna header:**
- Status dot 6px (cor da coluna) + label `font-mono uppercase tracking-[0.12em]` + contador mono à direita.
- Border bottom hairline na cor da coluna (com 44/255 alpha).

**Card anatomia:**
- Border + `border-l-2 border-l-[cobalto]` (módulo accent — APERTURE usa cobalto único; HITL usa `--status-busy`).
- Background: card padrão. HITL usa `--secondary` para diferenciar.
- Título: `font-cond` (nesse projeto = Inter 600), 11px, line-height 1.35.
- Linha agente: ícone 11px + agent name `font-mono` 8px + módulo badge (mono 8px com hairline border).
- Tags: `font-mono` 7px, hairline borders, padding 1px 5px.
- Footer: priority dot 5px + (HITL badge ou timestamp `font-mono` 7px).

**Cores das colunas (semânticas):**
- Backlog: `--muted-foreground` (cinza)
- Em Execução: cobalto `--primary` (com `filament-pulse`)
- HITL Aguardo: `--status-busy` (atenção)
- Concluído: `--status-active` (cinza claro)

#### **5.2.4 HITL approval card (inline, dentro de log)**

Padrão para human-in-the-loop:

```
┌────────────────────────────────────────────────────────┐
│ ⚠ HUMAN-IN-THE-LOOP · APROVAÇÃO NECESSÁRIA            │
│ ────────────────────────────────────────────────────  │
│ Texto descritivo da ação aguardando aprovação          │
│ ────────────────────────────────────────────────────  │
│ [✓ CONFIRMAR]  [CANCELAR]                              │
└────────────────────────────────────────────────────────┘
```

- Border-left 2px cobalto (atenção, não destrutivo). Background `--secondary` para diferenciar do log normal.
- Botão primário: cobalto (`--primary` background + `--primary-foreground` texto).
- Botão secundário: hairline border + texto `--muted-foreground`.
- Header em `font-mono uppercase tracking-[0.12em]` cor cobalto.

#### **5.2.5 Lista de agentes com expand/collapse**

```
┌────────────────────────────────────────────────────────────┐
│ 🤖 Agent Name  [TYPE]  [STATUS]      tokens · cost  ▼     │ ← collapsed
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ 🤖 Agent Name  [TYPE]  [STATUS]      tokens · cost  ▲     │
├────────────────────────────────────────────────────────────┤
│ ┌────────────┬────────────────┬────────────────────────┐  │
│ │ ÚLTIMA EXEC│ MEMÓRIA ADAPT  │ SYSTEM PROMPT          │  │
│ │ Tokens In  │ ┌────────────┐ │ ┌────────────────────┐ │  │
│ │ Tokens Out │ │ texto...   │ │ │ texto...           │ │  │
│ │ Custo      │ └────────────┘ │ └────────────────────┘ │  │
│ │ Duração    │ SKILLS:        │ [EDITAR] [DESATIVAR]   │  │
│ │ Status     │ [skill][skill] │                        │  │
│ └────────────┴────────────────┴────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

- Animação de expansão: spring `(stiffness: 380, damping: 32)`.
- Chevron `▼` rotaciona 180° ao abrir.
- Border-left 2px na cor do tipo (cobalto para todos no APERTURE; tipo é apenas badge label).
- Conteúdo expandido em grid 3 colunas com hairline divisores verticais.

### 5.3 Padrões transversais

- **Header de página**: breadcrumb mono uppercase `tracking-[0.15em]` + título cond + subtítulo body. Direita: badge LIVE animado (`filament-pulse` cobalto) + timestamp mono.
- **KPI cards**: 4 ou 5 em grid. Label mono uppercase + valor mono large + sub-texto body. Cobalto para destaque, `--status-busy` para alertas.
- **Activity feed/log**: timeline vertical com timestamp mono fixo à esquerda (largura fixa), conteúdo body, status dot à direita. Hairline divisores entre itens.
- **Sparkline charts**: barras de 2px, gap 1px, altura proporcional. Cobalto para normal, `--status-busy` para anomalia. Sem labels de eixo — só extremos `48 runs atrás | Agora` em mono 8px.
- **Status pills inline**: dot 1.5×1.5px (`background` colorido) + label mono uppercase `tracking-[0.18em]`.
- **Empty states e botões "+ adicionar"**: `border-dashed border-hairline` + `font-mono` cinza.
- **Tabela**: header mono uppercase 8px, hairline divisores, linha alertada com border-left 2px `--status-busy` + background `--secondary`.

### 5.4 Sidebar de navegação

A v2 substitui o `ApertureSidebar` original. Especificação atualizada:

- **Largura colapsável**: 60px (rail) ↔ 220px (expandido). Toggle persistido em cookie `sidebar:state` (max-age 7 dias).
- **Atalho de teclado**: `Cmd/Ctrl + B` toggle.
- **Header**: logo + nome do produto (mono uppercase tracking 0.2em) + versão mono pequeno.
- **Grupos de seção**: `font-mono uppercase` 9px com `tracking-[0.14em]` cor `--muted-foreground`. Padding 10px 8px 4px.
- **Item ativo**: `border-l-2 border-l-[--primary]` + background `--secondary` + animação compartilhada via `layoutId` (barra cobalto desliza para nova posição ao mudar rota).
- **Item normal**: cor `--muted-foreground`. Hover: cor `--foreground` + background `--secondary`.
- **Badges**: contador (mono 9px, hairline border, padding 1px 5px) ou dot animado (`filament-pulse` cor cobalto/verde quando há alerta).
- **Footer**: status dot pulsante + label mono uppercase 9px ("SYS OPERATIONAL").
- **Mobile** (md: e abaixo): vira drawer via shadcn `Sheet` (ver §6.1).

### 5.5 Theme toggle (light / dark)

Toggle disponível em todas as telas. Posicionamento sugerido: footer da sidebar OU cabeçalho de página (à direita do badge LIVE).

**Implementação:**
- `next-themes` já instalado. Wrapper `<ThemeProvider attribute="class" defaultTheme="system">` no root.
- Switch shadcn (`@/components/ui/switch.tsx`) ou ícone Lucide `Sun`/`Moon` com transição.
- `font-mono uppercase` label `LIGHT | DARK | AUTO` ao lado.
- Persistência: `localStorage` (next-themes default). Sem flash on load (`suppressHydrationWarning` no `<html>`).

---

## 6. Linguagem de interação

### Status pills
- **Ponto colorido `1.5×1.5px`** (quase imperceptível, mas presente — usa `--status-*`).
- **Label** em `font-mono uppercase` com `letter-spacing: 0.18em`.

### Hover
- **Sempre troca de cor de fundo** para `--secondary`.
- **Nunca:** elevação, sombra, escala, mudança de border-radius.

### Active states
- **Barra vertical `2px`** em cobalto à esquerda do item.
- **Animação compartilhada** via Framer Motion `layoutId`.

### Métricas e dados numéricos
- **Sempre** `font-mono tabular-nums`.
- Padding zero entre dígitos.
- Exemplos: `07d`, `200 OK`, `87%`, `1.4ms`, `$0.094`, `20m6s`.

### Ícones
- **Lucide React** com `strokeWidth: 1.25` (linhas finas, consistentes com o hairline).
- Tamanhos típicos: `14px`, `16px`, `18px`. Não usar `24px` exceto em contextos hero.

### Cursor de input
- **Cursor de bloco** (não barra) em inputs primários (IntentStage). Implementação via pseudo-elemento.

### Selection (highlight de texto)
- `::selection` usa `--primary` (cobalto) como background e `--primary-foreground` (branco) como texto.

---

## 7. shadcn/ui — configuração e uso

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

**Estrutura:**
- Componentes shadcn primitivos: `@/components/ui/*`
- Componentes APERTURE (identidade própria): `@/components/*`
- Componentes Aperture compostos (kanban, agent-list, kpi-card, etc.): `@/components/aperture/*`
- Helper de classe: `@/lib/utils.ts` exporta `cn()` (tailwind-merge + clsx)

**Adicionar novo componente shadcn:**
```bash
npx shadcn-ui@latest add <component>
```

**Padrão de customização (importante):**
- **Border radius:** `tailwind.config.ts` força todos a `0px`. **Não precisa editar componente.**
- **Box shadow:** componentes geram `shadow-sm`/`shadow-md`/`shadow-lg`. Para fidelidade APERTURE, sobrescrever no uso (`className="shadow-none"`) ou editar componente.

### 7.1 Sidebar primitive (shadcn) — `@/components/ui/sidebar.tsx`

Sistema completo de sidebar fornecido pelo shadcn. **Base do `ApertureSidebar` (§5.4).**

**Subcomponentes exportados:** `SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarFooter`, `SidebarContent`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarMenuBadge`, etc.

**Features prontas:** Provider context, persistência via cookie (`sidebar:state`, 7 dias), keyboard shortcut `Cmd/Ctrl+B`, modo mobile via `Sheet`, variants (`sidebar | floating | inset`), collapsible (`offcanvas | icon | none`).

**Adaptação APERTURE:** sobrescrever cores via CSS variables `--sidebar-*` (atualmente desalinhadas — ver §13).

### 7.2 Toast — duas implementações coexistem

⚠️ **Decisão recomendada (pendente):** padronizar em **Sonner** e remover Radix Toast (3 arquivos: `toast.tsx`, `toaster.tsx`, `use-toast.ts`).

---

## 8. Inventário de componentes disponíveis e a construir

### 8.1 shadcn primitivos (já no boilerplate)

47 componentes em `@/components/ui/`. Lista completa:

`accordion`, `alert`, `alert-dialog`, `aspect-ratio`, `avatar`, `badge`, `breadcrumb`, `button`, `calendar`, `card`, `carousel`, `chart` (recharts wrapper), `checkbox`, `collapsible`, `command` (cmdk palette), `context-menu`, `dialog`, `drawer` (vaul), `dropdown-menu`, `form` (react-hook-form), `hover-card`, `input`, `input-otp`, `label`, `menubar`, `navigation-menu`, `pagination`, `popover`, `progress`, `radio-group`, `resizable`, `scroll-area`, `select`, `separator`, `sheet`, `sidebar`, `skeleton`, `slider`, `sonner`, `switch`, `table`, `tabs`, `textarea`, `toast` (legado), `toggle`, `toggle-group`, `tooltip`.

**Variants do Button:** `default | destructive | outline | secondary | ghost | link`. Sizes: `default (h-10) | sm (h-9) | lg (h-11) | icon (h-10 w-10)`.

### 8.2 APERTURE compostos (a construir, baseados em §5)

Componentes próprios da identidade, construídos a partir dos primitivos shadcn + padrões de §5:

| Componente | Path proposto | Composto de |
|---|---|---|
| `ApertureSidebar` | `@/components/aperture/sidebar.tsx` | shadcn `Sidebar` + tokens APERTURE |
| `KpiCard` | `@/components/aperture/kpi-card.tsx` | div + hairline border + métricas mono |
| `AgentRosterCard` | `@/components/aperture/agent-roster-card.tsx` | card com status dot + tokens bar |
| `ActivityFeed` | `@/components/aperture/activity-feed.tsx` | lista timeline com hairline divisores |
| `Sparkline` | `@/components/aperture/sparkline.tsx` | array de barras 2px, sem libs |
| `KanbanBoard` | `@/components/aperture/kanban/board.tsx` | grid 4 cols + dnd-kit |
| `KanbanCard` | `@/components/aperture/kanban/card.tsx` | card com módulo accent + tags + HITL flag |
| `HitlApprovalCard` | `@/components/aperture/hitl-approval.tsx` | card inline com botões primário/secundário |
| `AgentListItem` | `@/components/aperture/agent-list-item.tsx` | collapse com 3-col content |
| `PageHeader` | `@/components/aperture/page-header.tsx` | breadcrumb + título + LIVE badge |
| `StatusPill` | `@/components/aperture/status-pill.tsx` | dot + label mono uppercase |
| `ThemeToggle` | `@/components/aperture/theme-toggle.tsx` | next-themes + Switch ou icon button |
| `IntentStage` | `@/components/aperture/intent-stage.tsx` | input com cursor de bloco (já em spec original) |
| `ExecutionFilament` | `@/components/aperture/execution-filament.tsx` | log compacto com pulse (já em spec original) |
| `PulseFooter` | `@/components/aperture/pulse-footer.tsx` | barra de vitais (já em spec original) |

> 📌 Drag-and-drop no kanban: usar `@dnd-kit/core` + `@dnd-kit/sortable` (não está no boilerplate ainda; adicionar).

---

## 9. Estrutura de pastas (proposta para o monorepo)

```
apps/web/
├── src/
│   ├── components/
│   │   ├── ui/                       # shadcn primitivos (47)
│   │   └── aperture/                 # compostos APERTURE
│   │       ├── sidebar.tsx
│   │       ├── kpi-card.tsx
│   │       ├── activity-feed.tsx
│   │       ├── sparkline.tsx
│   │       ├── kanban/
│   │       │   ├── board.tsx
│   │       │   └── card.tsx
│   │       ├── hitl-approval.tsx
│   │       ├── agent-list-item.tsx
│   │       ├── page-header.tsx
│   │       ├── status-pill.tsx
│   │       ├── theme-toggle.tsx
│   │       ├── intent-stage.tsx
│   │       ├── execution-filament.tsx
│   │       └── pulse-footer.tsx
│   ├── pages/                        # rotas (10 módulos)
│   │   ├── mission-control.tsx
│   │   ├── orchestrator.tsx
│   │   ├── agents.tsx
│   │   ├── performance.tsx
│   │   ├── automation.tsx
│   │   ├── budget.tsx
│   │   ├── heartbeat.tsx
│   │   ├── quality.tsx
│   │   ├── goals.tsx
│   │   └── wiki.tsx
│   ├── hooks/
│   │   ├── use-mobile.ts
│   │   └── use-toast.ts
│   ├── lib/
│   │   ├── utils.ts                  # cn() helper
│   │   ├── api.ts                    # cliente HTTP para apps/server
│   │   └── schemas/                  # zod schemas
│   ├── index.css                     # CSS variables (light + dark APERTURE) + utilitários
│   └── main.tsx
├── components.json
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
└── vite.config.ts
```

**Path alias:** `@/*` → `./src/*` (configurado em todos os tsconfigs).

**Arquivo a remover na migração:** `App.css` é leftover Vite default.

---

## 10. TypeScript — política

A configuração desta spec **não usa TypeScript strict**:

```jsonc
// tsconfig.app.json (atual)
"strict": false,
"noUnusedLocals": false,
"noUnusedParameters": false,
"noImplicitAny": false
```

⚠️ **Conflito com `CLAUDE.md`** do Ethra Nexus, que exige strict: true. **Decisão (recomendada):** endurecer para strict ao migrar para o monorepo, refatorando o que vier do export Lovable.

---

## 11. Integração com o backend Ethra Nexus

**API:** Fastify em `apps/server`, prefixo `/api/v1`, autenticação JWT via header `Authorization: Bearer <token>`.

**Endpoints típicos para a UI:**

| Método | Path | Uso na UI |
|---|---|---|
| POST | `/api/v1/auth/signup` | Cadastro de tenant (tela de onboarding) |
| POST | `/api/v1/auth/login` | Login (slug + password) |
| GET | `/api/v1/agents` | Lista agentes (Mission Control roster, Agentes page) |
| POST | `/api/v1/agents` | Cria agente |
| PATCH | `/api/v1/agents/:id` | Edita identidade/wiki config |
| GET | `/api/v1/agents/:id/budget` | Budget Control card por agente |
| PATCH | `/api/v1/agents/:id/budget` | Atualiza limite mensal |
| POST | `/api/v1/aios/execute` | Executa skill (foreground) |
| GET | `/api/v1/aios/events` | Activity feed + execution log |
| POST | `/api/v1/agents/:id/wizard/sessions` | Onboarding wizard |

**Pattern recomendado:**
- Cliente HTTP em `@/lib/api.ts` com interceptor de token JWT.
- Hooks de query em `@/hooks/use-*.ts` envolvendo TanStack Query.
- Schemas Zod em `@/lib/schemas/*.ts` para validar respostas.
- Toasts de erro via Sonner.

---

## 12. Acessibilidade

- **Contraste light:** preto sobre branco = 21:1 (AAA). Cobalto sobre branco = 8.59:1 (AAA large, AA small).
- **Contraste dark:** branco sobre preto = 21:1 (AAA). Cobalto `#3333FF` sobre preto = 8.6:1 (AAA large, AA small).
- **Focus visible:** ring em cobalto via `--ring`. Componentes shadcn usam `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. **Nunca remover outline sem substituir.**
- **Tamanho mínimo de toque:** 44×44px em alvos interativos. Componentes shadcn padrão (h-10 = 40px) ficam logo abaixo — preferir `size="lg"` (h-11 = 44px) em mobile.
- **Tipografia mínima:** 14px para texto, 12px aceitável apenas para metadata mono em desktop.
- **Radix garante** teclado e ARIA por padrão em todos os primitivos.

---

## 13. Pendências e decisões abertas

### Decisões já tomadas

- ✅ **Layouts:** adotar wireframes do protótipo v2 (Mission Control, Orquestrador split-screen, Kanban 4-col, etc.) traduzidos para a estética APERTURE.
- ✅ **Theme toggle:** light + dark obrigatórios. Dark mode será refeito Aperture-aligned (ver §3.2) — não usar o genérico shadcn atual.
- ✅ **Sidebar:** padrão de 60px ↔ 220px da v2 substitui o ApertureSidebar 60+300px da spec original.

### Decisões pendentes

- [ ] **Sidebar tokens** (`--sidebar-*` no `index.css`): alinhar à paleta APERTURE absoluta (atualmente azul-acinzentados slate herdados do shadcn).
- [ ] **Toast:** padronizar em Sonner e remover Radix Toast legado (3 arquivos).
- [ ] **Box shadows nos componentes shadcn:** sobrescrever no uso ou editar cada componente?
- [ ] **TypeScript strict:** endurecer ao migrar para o monorepo (recomendado).
- [ ] **Fonts:** auto-hospedar (woff2 em `public/fonts/`) ou manter Google Fonts CDN.
- [ ] **App.css:** confirmar remoção (leftover Vite default).
- [ ] **DnD lib:** confirmar `@dnd-kit/core` para o kanban.
- [ ] **Routing:** react-router-dom 6.x já no boilerplate; confirmar estrutura de rotas (data routers vs. tradicional).

### Não trazido pelo boilerplate (precisa adicionar)

- [ ] `@dnd-kit/core` + `@dnd-kit/sortable` (kanban drag-and-drop).
- [ ] (opcional) `@vercel/analytics` ou similar para telemetria de UI.

---

## 14. Histórico

- **2026-04-26 (criação)** — Documento criado a partir de spec textual + arquivos de configuração (`tailwind.config.ts`, `components.json`, `tsconfig*`, `package.json`, `index.html`).
- **2026-04-26 (expansão tokens + componentes)** — Integrados `index.css` (tokens completos light + dark), `App.css`, e os 47 componentes shadcn do boilerplate.
- **2026-04-26 (layouts + dark mode firme)** — Adicionada §5 com layouts da v2 (Mission Control, Orquestrador split-screen, Kanban 4-col, HITL approval, expand de agente, sparkline, etc.) traduzidos para a linguagem APERTURE. Dark mode definido como Aperture-aligned (ver §3.2). Theme toggle marcado como requisito firme. Sidebar atualizada para padrão 60↔220px.
