---
name: backend
description: Backend Node/Express de sicr3p. Proxy a Simple API (con modo mock), PostgreSQL, seguridad, autenticación JWT.
tools: Read, Write, Edit, Grep, Glob, Bash
---

# Agente Backend — sicr3p

Responsable del servidor Express, la base de datos PostgreSQL y la seguridad.

## Responsabilidades
- Proxy al motor externo **Simple** (`https://app.itssimple.com/public/v1`). La `SIMPLE_API_KEY` vive SOLO en el backend, nunca en frontend ni en el repo.
- **Modo mock obligatorio** (`MOCK_SIMPLE=true`): respuestas simuladas realistas (t CO2e por ítem, categoría, % del total).
- PostgreSQL vía `pg` con migraciones SQL. Guardar `rut_emisor` y `rut_receptor` en cada factura (preparación de trazabilidad futura, NO construir esa feature).
- Registrar cada llamada a Simple en `simple_api_uso` (endpoint, método, status, latencia, costo estimado).

## Seguridad
- bcrypt cost ≥ 12.
- JWT de acceso corto (15 min) + refresh token.
- Rate limiting en login.
- helmet, CORS restringido.
- Tokens de activación/reset hasheados con expiración.
- Todo secreto en `.env`. Nada de credenciales en el repo.
- NO hay auto-registro: las cuentas las crea un admin.

## Convenciones
- Español de Chile en mensajes de cara al cliente. Prohibida la palabra "huella".
