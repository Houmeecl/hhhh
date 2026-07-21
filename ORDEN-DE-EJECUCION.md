# Orden de ejecución — sicr3p

Checklist único, en el orden en que conviene hacerlo, de todo lo que quedó
pendiente y requiere una acción humana (no de código). Cada ítem indica si
necesita acceso al VPS (lo tienes tú) o solo el navegador.

---

## 1. Cerrar la versión en el VPS
**Acceso:** VPS (SSH)
**Por qué va primero:** todo lo demás (paso 2 y 5) depende de que el código
esté corriendo en producción.

```bash
cd /opt/sicr3p && git pull && bash deploy/finalizar-vps.sh
```

Este único comando instala los binarios del motor total (tesseract, poppler,
libheif), aplica las migraciones 001→019, corre los 185 tests del backend
en el propio VPS, compila el frontend, reinicia el servicio, instala el cron
de auto-deploy (si falta), corre el smoke E2E contra tu producción real, y
**expone los PDFs comerciales y de metodología por nginx** (paso 6/6) en:

```
http://<tu-dominio-o-IP>/docs/comercial/01-sicr3p-plataforma.pdf
http://<tu-dominio-o-IP>/docs/comercial/02-aduana-verde.pdf
http://<tu-dominio-o-IP>/docs/comercial/03-rep-ley-20920.pdf
http://<tu-dominio-o-IP>/docs/comercial/04-correo-corporativo.pdf
http://<tu-dominio-o-IP>/docs/metodologia/guia-metodologica-sicr3p.pdf
http://<tu-dominio-o-IP>/docs/comercial/05-informe-autoridades.pdf
http://<tu-dominio-o-IP>/docs/comercial/06-informe-financiamiento.pdf
http://<tu-dominio-o-IP>/docs/libro/            ← El Libro del proyecto (web con menú)
http://<tu-dominio-o-IP>/docs/libro/el-libro-sicr3p.pdf
```

`docs/legal/` **nunca** se expone ahí (son borradores marcados "NO PUBLICAR
SIN ABOGADO"). Si algo falla, el script se detiene y te dice exactamente
dónde.

---

## 2. Panel admin — configuración de negocio
**Acceso:** navegador (`/admin`, ya en producción tras el paso 1)

- [ ] **Tipo de cambio USD**: menú **Accesos externos → pestaña Terminales
  → tarjeta "Tarifa de compensación y tipo de cambio"**. Lo más simple:
  marca la casilla **"Actualizar el dólar automáticamente"** y guarda — el
  servidor trae el dólar observado del Banco Central (vía mindicador.cl)
  al instante y lo renueva solo cada 6 horas. Si prefieres fijarlo a mano,
  deja la casilla desmarcada e ingresa el valor citando la fuente. Mientras
  no haya valor, el sitio no muestra montos en USD — comportamiento
  correcto, no un error.
- [ ] **Validar los factores de emisión nuevos**: menú **Motor propio**
  contra sus fuentes oficiales descargadas, y subirlos de
  `avalada_referencial` a `validada_oficial` uno por uno. Los que necesitan
  revisión: gas natural, GLP, kerosene/jet, refrigerantes R-134a/R-410A,
  residuos, agua, vuelos corto/largo, marítimo (ver Anexo II de
  `docs/metodologia/guia-metodologica-sicr3p.pdf`).

---

## 3. Correo corporativo (contacto@sicr3p.cl)
**Acceso:** panel DNS del dominio + navegador; en paralelo con 1-2

- [ ] Reemplazar el TXT SPF actual por:
  `v=spf1 mx include:spf.hostmar.com ~all`
- [ ] Crear el TXT `_dmarc`:
  `v=DMARC1; p=quarantine; rua=mailto:postmaster@sicr3p.cl`
- [ ] Abrir ticket a DonWeb pidiendo rDNS de 138.36.237.61 → mail.sicr3p.cl
  y confirmación de puerto 25 saliente abierto.
- [ ] En el VPS: `bash deploy/instalar-webmail.sh`
- [ ] Probar en mail-tester.com hasta lograr ≥9/10.

Detalle completo, con la alternativa Zoho si DonWeb no cumple: `deploy/WEBMAIL.md`.

---

## 4. Revisión legal
**Acceso:** ninguno técnico — solo abogado; en paralelo con todo lo anterior

- [ ] Que un abogado revise `docs/legal/POLITICA-DE-PRIVACIDAD.md` y
  `docs/legal/TERMINOS-DE-SERVICIO.md` antes de publicarlos en el sitio.
  Los puntos marcados `[REVISAR ABOGADO]` son las decisiones jurídicas
  pendientes (plazos, jurisdicción, transferencias internacionales, etc.).

---

## 5. Independencia total del motor (a futuro)
**Acceso:** VPS; depende del paso 1 y de tiempo real en producción

- [ ] Observar el % de independencia en el panel "Motor propio" durante
  varias semanas.
- [ ] Cuando esté ~100% sostenido (o la cola de revisión esté bajo control):
  poner `MOTOR_EXTERNO=off` en `backend/.env`, reiniciar, y evaluar dar de
  baja el contrato de itssimple (`SIMPLE_API_KEY` deja de ser necesaria).

---

## 6. GitHub Actions — prioridad baja, no bloquea nada
**Acceso:** navegador, cuenta Houmeecl

No es urgente: la producción está protegida por el CI propio del VPS (tests
antes de cada deploy) + el smoke E2E después, con rollback automático — eso
no depende de GitHub. El ticket verde del PR es cosmético.

Diagnóstico hecho hasta ahora: 3 intentos (2 commits vacíos + 1 re-run
manual) dieron el mismo resultado exacto — ningún runner se asigna nunca
(`runner_id: 0`, `billable.total_ms: 0`, falla en 2-3 s). Ya se descartaron
permisos de Actions deshabilitados y límite de gasto en $0 como causa única.

**Si quieres seguir insistiendo:** abre
`github.com/Houmeecl/hhhh/actions/runs/29749686169` en el navegador,
logueado como Houmeecl, y pega el mensaje de texto que aparece arriba de la
lista de pasos (la API de GitHub no lo expone; solo la interfaz web lo
muestra).

### Alternativa real: runner propio en el VPS (sortea el bloqueo)

`ci.yml` ya quedó apuntando a `runs-on: self-hosted`. Un runner self-hosted
es tu propio VPS conectándose a buscar trabajo — si el bloqueo es solo de
asignación de máquinas alojadas por GitHub, esto lo evita por completo.
Esta parte **requiere que la hagas tú**: necesita tu sesión de navegador
logueada y acceso a la terminal del VPS — dos cosas que este entorno nunca
tuvo.

1. Ve a `github.com/Houmeecl/hhhh/settings/actions/runners/new`, elige
   **Linux x64**. GitHub te muestra un bloque de comandos con un token de
   un solo uso (válido ~1 hora).
2. En el VPS, en una carpeta aparte (ej. `/opt/gh-runner`, NO dentro de
   `/opt/sicr3p`), pega y corre esos mismos comandos tal cual los entrega
   GitHub (descarga, extrae, `./config.sh --url ... --token ...`).
3. Para que quede corriendo siempre (no solo mientras tengas la terminal
   abierta):
   ```bash
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```
4. Confirma que aparece "Idle" en
   `github.com/Houmeecl/hhhh/settings/actions/runners`.
5. Haz cualquier commit a la rama (o pide un re-run) — el próximo build
   debería tomarlo tu runner en segundos.

**Nota de seguridad:** el runner corre en una carpeta propia, separada de
`/opt/sicr3p`; no toca pm2 ni nginx ni la base de datos de producción.
Consume CPU/disco brevemente durante cada corrida de CI, nada más.

---

*Generado a partir de ETAPA3.md, deploy/AUTODEPLOY.md, deploy/WEBMAIL.md y
docs/legal/ — julio 2026.*
