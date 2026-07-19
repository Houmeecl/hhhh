# Auto-deploy del VPS (sicr3p)

Actualización automática de producción: un cron revisa cada 30 minutos si la rama
de producción tiene commits nuevos y, si los hay, actualiza el VPS solo — con
respaldo previo, health check y **rollback automático** si algo sale mal.

## Qué hace

Cada 30 minutos, `deploy/agente-deploy.sh` ejecuta `deploy/actualizar.sh`:

```
fetch → ¿commits nuevos en origin/<rama>? → no: sale en silencio
      → sí: respaldo BD pre-deploy (pg_dump, no bloqueante)
          → git pull --ff-only        (jamás merge ni force)
          → build backend (npm ci --omit=dev) + frontend (vite build)
          → pm2 restart sicr3p-backend
          → health: /api/health debe responder "ok":true (reintenta 30 s)
                    y la portada debe cargar
          → OK: log "actualizado A → B"
          → FALLO: ROLLBACK al commit previo (rebuild + restart + re-health)
```

Si el deploy falla y hay rollback, el wrapper invoca `claude` (si está instalado
en el VPS) en modo **solo lectura** para dejar un **diagnóstico escrito** —
causa probable, evidencia y corrección sugerida — que un humano revisa y aplica.
El agente de diagnóstico **no repara nada**: no reinicia servicios, no toca git.

## Instalación (en el VPS, como root)

```bash
cd /opt/sicr3p && git pull
bash deploy/actualizar.sh --instalar-cron
```

Eso agrega al crontab de root: `*/30 * * * * /opt/sicr3p/deploy/agente-deploy.sh`.
También se puede correr una pasada manual cuando se quiera:

```bash
bash deploy/actualizar.sh
```

## Dónde mirar

| Qué | Dónde |
|-----|-------|
| Log de cada corrida (sin cambios / actualizado / rollback) | `/var/log/sicr3p-actualizar.log` |
| Diagnósticos del agente tras un fallo | `/root/sicr3p-diagnostico-AAAA-MM-DD-HHMM.txt` |
| Respaldos pre-deploy de la BD | `/root/backups/pre-deploy-AAAA-MM-DD-HHMM.sql.gz` |

Códigos de salida de `actualizar.sh`: `0` sin cambios o actualizado ·
`1` falló y se hizo rollback (producción quedó en el commit anterior, en
detached HEAD; volver con `git checkout <rama>`) · `2` **crítico**: ni el
rollback pasó el health — intervención manual (el log trae los pasos).

## Desinstalar

```bash
bash /opt/sicr3p/deploy/actualizar.sh --desinstalar-cron
```

## ADVERTENCIA (leer antes de activar)

Con el auto-deploy activo, **todo push a la rama de producción
(`claude/sicr3p-etapa-1-complete-caqhpl`) llega a producción en ≤ 30 minutos**.
La rama debe recibir **solo trabajo verificado** (tests + E2E en verde, como es
la práctica de esta sesión). El rollback protege contra builds rotos y backends
que no levantan, pero no contra bugs lógicos que pasan el health check.

## Ajustes (variables de entorno)

`actualizar.sh` acepta sobreescribir por entorno: `SICR3P_DIR`, `SICR3P_RAMA`,
`SICR3P_LOG`, `SICR3P_HEALTH_URL`, `SICR3P_FRONT_URL`, `SICR3P_BACKUP_DIR`,
`SICR3P_LOCK`, `SICR3P_RESTART_CMD`; y `SICR3P_SKIP_BUILD=1` (salta npm/build,
**solo para ensayos locales**, nunca en el VPS). El wrapper acepta además
`SICR3P_DIAG_DIR`.

## Futuro (no implementado)

Enviar el diagnóstico por correo al fallar (Resend o el webmail del VPS), para
no depender de entrar por SSH a leer `/root/sicr3p-diagnostico-*.txt`.
