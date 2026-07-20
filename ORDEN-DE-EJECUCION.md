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
de auto-deploy (si falta) y corre el smoke E2E contra tu producción real. Si
algo falla, se detiene y te dice exactamente dónde.

---

## 2. Panel admin — configuración de negocio
**Acceso:** navegador (`/admin`, ya en producción tras el paso 1)

- [ ] **Fijar el tipo de cambio USD** en Config POS (Aduana Verde → Config),
  citando la fuente (ej. dólar observado del Banco Central). Mientras quede
  vacío, el sitio no muestra montos en USD — es el comportamiento correcto,
  no un error.
- [ ] **Validar los factores de emisión nuevos** (motor propio → categorías)
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

---

*Generado a partir de ETAPA3.md, deploy/AUTODEPLOY.md, deploy/WEBMAIL.md y
docs/legal/ — julio 2026.*
