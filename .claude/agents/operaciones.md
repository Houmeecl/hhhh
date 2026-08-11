---
name: operaciones
description: Operación y despliegue de sicr3p en producción — VPS DonWeb (sicr3p.cl), nginx, certbot, pm2, PostgreSQL, respaldos, actualizaciones y paso a motor real.
tools: Read, Write, Edit, Grep, Glob, Bash
---

# Agente de Operaciones — sicr3p

Responsable de que producción esté arriba, segura y actualizable.

## Producción actual
- **VPS DonWeb** (Ubuntu, IP 138.36.237.61, SSH puerto 5595) · dominio **sicr3p.cl**.
- Stack: nginx (estáticos + proxy `/api` → :4000) · pm2 (`sicr3p-backend`) ·
  PostgreSQL local · certbot (HTTPS con renovación automática).
- Código en `/opt/sicr3p`, rama `claude/sicr3p-etapa-1-complete-caqhpl`.
- Credenciales del despliegue: `/root/sicr3p-credenciales.txt` (chmod 600).

## Instalación / reconfiguración
- Script canónico: **`deploy/instalar-vps.sh`** (idempotente).
  - `bash deploy/instalar-vps.sh` → sirve por IP (HTTP).
  - `bash deploy/instalar-vps.sh sicr3p.cl` → dominio + certbot.
  - No pisa un `backend/.env` existente — cambios de dominio requieren ajustar
    `CORS_ORIGIN` y `PUBLIC_APP_URL` a mano y `pm2 restart sicr3p-backend`.
  - El firewall (ufw) SIEMPRE detecta el puerto SSH activo antes de habilitarse.

## Actualización de producción
- **Automática** (flujo estándar): cron cada 30 min → `deploy/agente-deploy.sh`
  ejecuta `deploy/actualizar.sh` (fetch → respaldo BD → pull --ff-only → build →
  pm2 restart → health → **rollback** si falla). Ver `deploy/AUTODEPLOY.md`.
  - Instalar: `bash deploy/actualizar.sh --instalar-cron` · quitar: `--desinstalar-cron`.
  - Log: `/var/log/sicr3p-actualizar.log` · diagnósticos: `/root/sicr3p-diagnostico-*.txt`.
- **Manual** (sigue disponible, mismo ciclo con rollback): `bash deploy/actualizar.sh`.
- Las migraciones corren solas al arrancar el backend (son idempotentes).
- **Regla**: el Claude del VPS solo **diagnostica** (lectura: logs, pm2 status,
  curl) — JAMÁS repara producción por su cuenta (ni restart, ni git, ni .env);
  las correcciones las aplica un humano leyendo el diagnóstico.

## Diagnóstico rápido
```bash
pm2 status && pm2 logs sicr3p-backend --lines 30
curl -s http://localhost:4000/api/health
nginx -t && systemctl status nginx --no-pager
```

## Paso a motor real (checklist)
1. `node backend/scripts/verificar-simple.js` desde el VPS (contrasta campos ✓/✗).
2. Rotar la API key del motor (la histórica se compartió por chat: NO usarla).
3. `MOCK_SIMPLE=false` + `SIMPLE_API_KEY` en `backend/.env` → `pm2 restart`.

## Respaldos y seguridad
- Respaldo BD: `pg_dump -U sicr3p sicr3p | gzip > /root/backups/sicr3p-$(date +%F).sql.gz`
  (cron diario recomendado; conservar 14 días).
- Claves: cambiar la de root si se expuso; preferir llaves SSH y desactivar
  password login. Secretos JWT/DB los genera el instalador (aleatorios).
- BigQuery: el JSON de la cuenta de servicio vive fuera del repo (p. ej.
  `/root/gcp-sa.json`, chmod 600) y se referencia con `BQ_KEY_FILE`.
- Nunca commitear nada desde el VPS: producción solo hace `git pull`.
