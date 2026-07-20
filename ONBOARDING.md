# Welcome to sicr3p

## How We Use Claude

Based on Claude's usage over the last 30 days:

Work Type Breakdown:
  _TODO — no hay sesiones locales escaneadas todavía (el trabajo ha corrido en sesiones remotas). Cuando el equipo acumule uso local, regenerar esta sección con `/team-onboarding`._

Top Skills & Commands:
  _TODO — sin datos de comandos locales aún._

Top MCP Servers:
  _TODO — sin datos de llamadas locales aún._

## Your Setup Checklist

### Codebases
- [ ] hhhh (monorepo sicr3p) — github.com/houmeecl/hhhh
      Estructura: `backend/` (Node/Express + PostgreSQL), `frontend/` (React + Vite),
      `portable/` (edición standalone), `deploy/` (VPS: auto-deploy, smoke E2E, webmail),
      `docs/` (comerciales y legales).

### MCP Servers to Activate
- [ ] GitHub — PRs, issues, CI y revisiones del repo houmeecl/hhhh. Se activa al
      conectar la cuenta de GitHub en la configuración de Claude Code.

### Skills to Know About
- Subagentes del repo (`.claude/agents/`): el proyecto define agentes propios que
  Claude usa según la tarea —
  - `backend` — motor de cálculo, PostgreSQL, seguridad JWT, REP, cadena de hash.
  - `frontend` — páginas públicas, panel admin, terminal POS; regla de copy es-CL.
  - `diseno` — UI/UX y marca (prohíbe la palabra "huella").
  - `revisor` — auditoría final antes de cada push (copy, secretos, honestidad).
  - `decisor` — política de decisiones autónomas cuando el usuario no responde.
  - `investigacion` — normativa (REP, GHG Protocol, ISO 14064) con fuentes.
  - `operaciones` — VPS, nginx, pm2, respaldos.
  - `marketing` / `informes` / `datos` — pre-lanzamiento, PDFs defendibles, BigQuery.

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
