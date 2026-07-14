# Equipo de subagentes — sicr3p

Organigrama del equipo y división de funciones. Cada agente es dueño de su área;
si una tarea cruza áreas, el orquestador la divide y el **revisor** siempre audita
antes del push.

| Agente | Función (dueño de…) | Archivos principales |
|---|---|---|
| **diseno** | Marca, UI/UX, logo, paleta oficial, tipografía, patrón de páginas admin, landing, copy visual, SEO on-page | `frontend/src/**`, `prelanzamiento-empresas/public/**`, PDFs (estilo) |
| **backend** | API Express, PostgreSQL/migraciones, motor externo (mock/real), seguridad JWT, dominio (Capital Natural, DTE, Corredor, aduana) | `backend/src/**`, `backend/migrations/**` |
| **informes** | Los 4 PDF (consolidado, mensual, Estado de Capital Natural, etiqueta QR), libro mayor contable, metodología citable | `backend/src/services/pdf.js`, `qr.js` |
| **datos** | Export a BigQuery, búsqueda por RUT con cruces, modelo SEEA, evolución a Elasticsearch | `backend/src/services/bigquery.js`, `routes/buscar.js`, `bigquery/schema.sql` |
| **operaciones** | Producción en el VPS (sicr3p.cl): despliegue, nginx/certbot/pm2, actualizaciones, respaldos, paso a motor real | `deploy/instalar-vps.sh`, `scripts/verificar-simple.js` |
| **marketing** | Pre-lanzamiento (códigos de piloto), copy LinkedIn/email/clips, KPIs, keywords | `prelanzamiento-empresas/MARKETING.md` |
| **revisor** | Auditoría de cierre: copy prohibido, secretos, alcance, localización, docs coherentes, tests verdes | todo el repo (solo lectura) |

## Reglas transversales (aplican a TODOS)
1. **Prohibido "huella"** de cara al cliente (única excepción: "HuellaChile").
   Decir: contabilidad de carbono · trazabilidad · resultado incorporado.
2. **El motor externo no se nombra** en nada visible ("motor externo" a lo más).
3. **Secretos solo en `.env`** / fuera del repo (API keys, JSON GCP, credenciales VPS).
4. Español de Chile; números es-CL; RUT con módulo 11.
5. Disclaimer en informes: "no constituye una verificación de tercera parte acreditada".
6. **"Aduana verde" está fuera del alcance en todas las etapas** (decisión de negocio).
7. Todo cierre pasa por el **revisor** + `npm test` verde + build sin errores.

## Flujos típicos (quién entra en cada uno)
- **Feature nueva de producto** → backend → diseno (UI) → informes (si hay PDF) →
  datos (si genera datos cruzables: hook BigQuery + índice de búsqueda) → revisor.
- **Cambio de marca/copy** → diseno (+ marketing si es campaña) → revisor.
- **Incidente en producción** → operaciones (diagnóstico pm2/nginx/BD) →
  backend si es bug de código → operaciones actualiza el VPS.
- **Campaña** → marketing (copy/estrategia) → diseno (piezas) → revisor.
