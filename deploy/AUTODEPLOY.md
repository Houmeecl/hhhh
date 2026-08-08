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
          → health: /api/health debe responder "ok":true (reintenta 80 s)
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
| Commits en cuarentena (no se reintentan) | `/var/lib/sicr3p/commits-fallidos` |

Códigos de salida de `actualizar.sh`: `0` sin cambios o actualizado ·
`1` falló y se hizo rollback (producción quedó en el commit anterior, **en la
rama**, sin detached HEAD) · `2` **crítico**: ni el rollback pasó el health —
intervención manual (el log trae los pasos).

## Cuarentena: por qué un commit que falló no se reintenta solo

Cuando un deploy falla y se revierte, el SHA de ese commit queda anotado en
`/var/lib/sicr3p/commits-fallidos` y **el ciclo siguiente no lo vuelve a
intentar**. Sin esto, el cron reintentaba el mismo commit roto cada 30 minutos
para siempre — con su `pg_dump` completo, sus dos `npm ci`, su build y su
`pm2 restart` en cada vuelta — porque tras el rollback `HEAD` nunca vuelve a
coincidir con `origin/<rama>`.

La cuarentena se levanta sola de tres maneras: llega un commit nuevo (solo se
compara el SHA exacto, así que un commit distinto se despliega normalmente),
un deploy termina bien, o se levanta a mano:

```bash
bash /opt/sicr3p/deploy/actualizar.sh --reintentar
```

Eso último es para cuando la causa del fallo **no estaba en el código** — un
`.env` mal puesto, el registry de npm caído, un disco lleno — y no quieres
tener que inventar un commit nuevo para desbloquear.

Mientras un commit está en cuarentena, el log deja **un aviso al día** (no uno
cada media hora, que lo haría ilegible; y no cero, que dejaría producción
congelada en silencio con el cron reportando éxito).

> **Ojo con el primer ciclo tras cambiar este script.** Si el deploy que trae
> una versión nueva de `actualizar.sh` es justo el que falla, el rollback
> restaura en disco la versión anterior — que puede no tener la cuarentena. Es
> inherente a cualquier script de deploy que se actualiza a sí mismo: conviene
> mirar el log del ciclo siguiente en vez de darlo por hecho.

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
`SICR3P_LOCK`, `SICR3P_RESTART_CMD`, `SICR3P_CUARENTENA`; y `SICR3P_SKIP_BUILD=1` (salta npm/build,
**solo para ensayos locales**, nunca en el VPS). El wrapper acepta además
`SICR3P_DIAG_DIR`.

## Respaldos y restauración

Dos scripts, dos frecuencias distintas:

- **`deploy/respaldo.sh`** — cron diario (03:00, instalado por `instalar-vps.sh`).
  Genera `sicr3p-AAAA-MM-DD.sql.gz` en `/root/backups` y poda lo mayor a 14 días.
  También poda ahí mismo los `pre-deploy-*.sql.gz` que genera `actualizar.sh`
  antes de cada deploy (uno por commit, cron cada 30 min) — antes de esto esos
  archivos **nunca se borraban solos**, con el patrón de nombre distinto al del
  respaldo diario, y podían llenar el disco sin que nadie lo notara. El script
  ahora también deja una advertencia en el log si el disco supera 85% de uso.
- **`deploy/restaurar.sh`** — manual, dos modos:
  - **Ensayo** (default, no destructivo): restaura un `.sql.gz` en una base
    nueva (`sicr3p_restaurado_<fecha>`) y compara conteos de tablas y de
    `facturas` contra la base real, sin tocarla. Se borra sola al terminar
    (`--conservar` la deja para inspección).
  - **`--reemplazar`** (destructivo, solo para recuperación real): pide
    escribir la palabra `REEMPLAZAR`, toma un respaldo de seguridad de lo que
    haya en la base actual antes de tocar nada, y recién ahí la borra y la
    reconstruye desde el archivo indicado.

  **Ensayo verificado en local el 2026-08-08** contra un dump real de la BD de
  desarrollo (`bash deploy/restaurar.sh` con y sin `--reemplazar`, este último
  contra una base descartable): ambos modos restauran de verdad (77 tablas,
  133 filas de `facturas` coinciden con el original) y `--reemplazar`
  efectivamente reemplaza el contenido anterior, no lo mezcla. **Falta
  ensayarlo en el VPS real** — mismo comando, mismo resultado esperado, pero
  contra el Postgres de producción; requiere acceso al VPS que esta sesión no
  tiene.

- **Copia off-site**: hoy los respaldos viven en el mismo disco que la base
  (`/root/backups`, VPS DonWeb). Si el disco muere, se pierde la base y los
  14 días de respaldo a la vez. Pendiente (acción humana, no de código):
  sincronizar `/root/backups` a un destino fuera del VPS —cifrado en tránsito
  y en reposo— con algo simple como `rclone`/`restic` hacia un bucket S3
  compatible o un segundo servidor, en un cron aparte después de las 03:05
  (cuando `respaldo.sh` ya terminó). No se implementa aquí porque requiere
  elegir y pagar el destino (decisión del operador), pero el script de
  restauración ya está listo para leer un archivo bajado desde ahí igual que
  uno local.

## Futuro (no implementado)

Enviar el diagnóstico por correo al fallar (Resend o el webmail del VPS), para
no depender de entrar por SSH a leer `/root/sicr3p-diagnostico-*.txt`.


## Requisito del motor propio para fotos y escaneos (OCR)

El cálculo de facturas fotografiadas, PDFs escaneados y fotos HEIC usa
binarios locales en el propio servidor (nada sale a terceros). Instalarlos
UNA vez en el VPS:

```bash
apt install -y tesseract-ocr tesseract-ocr-spa poppler-utils libheif-examples
```

- `tesseract-ocr` + `-spa`: OCR de imágenes y escaneos (español + inglés).
- `poppler-utils` (pdftoppm): rasteriza PDFs escaneados para pasarles OCR.
- `libheif-examples` (heif-convert): convierte fotos HEIC de iPhone a JPG.

Sin estos binarios el sistema no falla: cada camino se detecta solo
(`ocrDisponible()`, `rasterPdfDisponible()`, `heicDisponible()`) y el
documento sigue el camino siguiente.

## CI propio del VPS (tests antes de desplegar)

El repositorio no depende del CI de GitHub (hoy bloqueado por la cuenta):
`actualizar.sh` corre los **tests del backend en el propio VPS, ANTES de
reiniciar** el servicio. Si algún test falla, el deploy no avanza y se hace
rollback — el código malo jamás llega a producción. Los tests son puros
(node:test, segundos de duración; los de OCR se saltan solos si faltan los
binarios). `SICR3P_SKIP_TESTS=1` los omite (solo para ensayos).

El pipeline completo del VPS queda: commits nuevos → respaldo BD → pull →
**tests** → build → restart → health → **smoke E2E** → OK (o rollback en
cualquier tropiezo).

## Smoke test E2E post-deploy

Después de cada deploy exitoso (health OK), `actualizar.sh` corre
`deploy/smoke-e2e.mjs`: un recorrido REAL contra producción que exige
backend sano, calculadora con tarifa y categorías vivas, **cadena de
integridad intacta**, frontend sirviendo la portada, **el login rechazando
credenciales inválidas con 401 (no 500)** y la verificación pública del
último documento respondiendo. Si cualquiera falla, el deploy **se
revierte** con el rollback normal (el rollback en sí solo se evalúa con el
health, para no entrar en bucles).

- El detalle de cada check queda en el log (`/var/log/sicr3p-actualizar.log`),
  una línea ✓/✗ por check.
- `SICR3P_SKIP_SMOKE=1` lo omite (solo para ensayos).
- **Check de login**: no necesita ninguna cuenta real ni credencial guardada
  en el VPS — manda un email/clave que no existe y solo exige que la ruta
  responda 401 (o 429 si el limitador ya está activo por tráfico real), en
  vez de un 500. Detecta el caso real que preocupaba: un deploy que deja el
  login roto (`JWT_ACCESS_SECRET` mal generado, tabla `usuarios` inaccesible)
  y que antes solo se notaba cuando un cliente intentaba entrar.
- **Nivel de escritura (opcional, requiere un paso manual una sola vez)**:
  con `SICR3P_SMOKE_ESCRITURA=1` el smoke además sube una factura de prueba
  por el flujo público real y exige motor propio + QR + sello. Para
  activarlo:
  1. En el panel admin, **Accesos → Códigos**, crear un código de acceso
     permanente con créditos (ej. "SMOKE — no borrar", créditos altos para
     que no se agote) — este código es justamente lo que exige el flujo
     público real, no un atajo.
  2. En el VPS, agregar `SICR3P_SMOKE_ESCRITURA=1` y
     `SICR3P_SMOKE_CODIGO=<el código creado>` al entorno del cron de
     `agente-deploy.sh` (por ejemplo en `/etc/environment`, o exportadas
     antes de la línea del crontab).
  3. Confirmar corriendo el smoke a mano una vez (ver abajo) antes de dejarlo
     en automático.
  Costo honesto: cada corrida deja una sesión real marcada
  "SMOKE TEST — sicr3p" **encadenada para siempre** (la cadena de hash no
  permite borrar sin romperse). Por eso viene apagado por defecto; actívalo
  solo si aceptas ese registro por deploy. **Pendiente**: sin el paso 1
  (creación manual del código), este nivel sigue sin poder activarse — no es
  resoluble solo con código.
- Correrlo a mano en cualquier momento:
  `node /opt/sicr3p/deploy/smoke-e2e.mjs`

## Apagar el motor externo (independencia total)

Cuando el panel "Motor propio" muestre ~100% de independencia sostenida,
poner en `backend/.env`:

```bash
MOTOR_EXTERNO=off
```

y reiniciar pm2. Desde ese momento ningún documento del cliente sale a un
motor de terceros: lo ilegible se **rechaza en el momento** (HTTP 422, sin
registro parcial) y se pide reescanear el documento — todos los datos de
una factura salen siempre de la lectura automática, nunca de un tipeo
humano. Con la tasa de rechazo bajo control, `SIMPLE_API_KEY` puede
eliminarse del .env.
