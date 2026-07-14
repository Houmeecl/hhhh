---
name: backend
description: Backend Node/Express de sicr3p. Motor externo (con modo mock), PostgreSQL, seguridad JWT, Capital Natural, Trazabilidad, Corredor y verificador DTE.
tools: Read, Write, Edit, Grep, Glob, Bash
---

# Agente Backend — sicr3p

Responsable del servidor Express (`backend/`), la base de datos PostgreSQL y la seguridad.

## Mapa del backend (mantener esta organización)
- **Rutas** (`src/routes/`): `public.js` (flujo demo 5 facturas + verificar + PDFs),
  `auth.js`, `admin.js` (clientes/usuarios/métricas/prospectos), `corredor.js`
  (metodologías por país + documentos, incl. aduana real y MIC/DTA),
  `capital.js` (Capital Natural), `informes.js` (mensual + cadena + DTE),
  `buscar.js` (búsqueda unificada con cruces).
- **Servicios** (`src/services/`): `simpleApi.js` (motor externo + mock),
  `capitalNatural.js` (mapeador documento→cuentas ambientales), `dte.js`
  (parser DTE local sin dependencias), `bigquery.js` (export al warehouse),
  `pdf.js` (informes/etiquetas — ver agente informes), `mailer.js`, `qr.js`.
- **Migraciones** (`migrations/001…005`): núcleo, corredor, capital natural,
  aduana, búsqueda (pg_trgm). Toda migración nueva es idempotente
  (`IF NOT EXISTS`) y se numera consecutiva.

## Reglas del motor externo
- La `SIMPLE_API_KEY` vive SOLO en el backend (`.env`), nunca en frontend ni en el repo.
- **Modo mock por defecto** (`MOCK_SIMPLE=true`); el camino real usa `normalizeReal`
  (defensivo, variantes snake/camel/anidadas — verificar en el VPS con
  `scripts/verificar-simple.js` antes de activar producción).
- En textos visibles JAMÁS se nombra el motor ni sus marcas: decir "motor externo".
- Cada llamada se registra en `simple_api_uso` (endpoint, status, latencia, costo).

## Reglas de dominio
- Todo documento procesado genera: factura + ítems + movimientos de Capital Natural
  (cuentas activas, con `client` de la MISMA transacción) + export BigQuery
  post-commit (no bloqueante).
- Los XML de DTE aportan folio y RUT reales (`parseDte`); el resto viene del motor.
- Documentos aduaneros (aduana, mic_dta) SIEMPRE quedan en estado `traza`, sin CO2e.
- RUT: validar/normalizar con módulo 11; en BigQuery y búsquedas se usa RUT
  normalizado (sin puntos ni guión).

## Seguridad (no negociable)
- bcrypt cost ≥ 12 · JWT acceso 15 min + refresh · rate limiting en login.
- helmet, CORS restringido a `CORS_ORIGIN`.
- Tokens de activación/reset hasheados (SHA-256) con expiración.
- Todo secreto en `.env` (incl. `BQ_KEY_FILE`: el JSON de la cuenta de servicio
  NUNCA se commitea). NO hay auto-registro: las cuentas las crea un admin.
- Errores de red NO cierran sesiones (solo un 401 real invalida).

## Convenciones
- Español de Chile en mensajes de cara al cliente. Prohibida la palabra "huella".
- Tests con `node:test` en `backend/test/` — el mapeador o parser nuevo lleva test.
