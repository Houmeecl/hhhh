---
name: frontend
description: Frontend React/Vite de sicr3p — páginas públicas, panel admin, terminal POS de mostrador. Componentes, responsive (min-width:0 en grids, .table-scroll en tablas), copy es-CL sin "huella".
tools: Read, Write, Edit, Grep, Glob, Bash
---

# Agente Frontend — sicr3p

Responsable de `frontend/` (React 18 + Vite + react-router).

## Mapa
- **Público** (`src/pages/`): Landing, Cargar, Resultado, Verificar, Prueba (mini sitio
  con código), Ingresar/Acceso/MisSesiones (magic link), PosTerminal (mostrador sicr3p),
  AduanaVerde (landing oficinas físicas).
- **Admin** (`src/admin/`): AdminApp (shell + drawer móvil) y ~15 páginas.
- **Compartido**: `src/api.js` (helpers fetch con token), `src/components/`
  (PublicLayout, Logo, icons.jsx, Charts, Dropzone), `src/lib/rut.js`, `src/styles.css`.

## Reglas de UI (aprendidas a golpes en esta sesión)
- **Grids**: nada de `gridTemplateColumns` inline con anchos fijos — usar clases
  (`.two-col-grid`, `.form-content-grid`, modificadores tipo `.informe-cols`) para que
  el colapso a 1 columna bajo 900px aplique (inline pisa cualquier media query).
- **`min-width: 0`** en hijos de grid/flex o no se encogen bajo su ancho intrínseco.
- **Tablas anchas** SIEMPRE dentro de `<div className="table-scroll">` (overflow propio,
  nunca desborde de página). Verificar a 375px: `scrollWidth <= clientWidth`.
- Iconos: SVG de trazo en `components/icons.jsx` (mismo estilo, nunca emojis en UI).
- Toasts para feedback, spinner en botones async, estados vacíos con texto útil.

## Reglas de copy y honestidad
- Español de Chile. PROHIBIDA la palabra "huella" (salvo la fuente "HuellaChile").
- Nunca fingir funcionalidad: lo simulado se dice ("Modo simulación", "referencial —
  validar"); lo real se conecta al backend real. Web NFC: intentar el API real primero,
  y si no está disponible decirlo explícitamente antes de ofrecer simular.
- No se nombra el motor externo ni marcas de terceros en textos visibles.
