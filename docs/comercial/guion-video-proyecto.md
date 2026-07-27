# Guion — Video story: qué es sicr3p (proyecto completo)

> Pieza narrativa que explica el proyecto entero, no un solo flujo. Se produce en
> dos formatos desde las mismas escenas: **16:9** (1280×720, ~2:15, web/YouTube/
> presentaciones) y **9:16** (720×1280, ~70 s, story para redes, escenas condensadas).
> Sin narración de voz: este entorno de producción no genera audio — los textos van
> quemados en pantalla y este guion sirve tal cual para grabar una voz en off después.
> Todo lo que aparece en pantalla es la plataforma real corriendo; el CO2e del
> resultado es el que calcula el motor en vivo, no un número de guion.

Producción: `deploy/grabar-story-proyecto.mjs` (graba) + `deploy/render-story-proyecto.mjs`
(monta). Salidas: `docs/video/sicr3p-proyecto-16x9.mp4` y `docs/video/sicr3p-proyecto-9x16.mp4`.

---

## Escena 0 — Gancho (tarjeta, 10 s) `[16:9 y 9:16]`

**Pantalla:** tarjeta navy, sin app.

Textos:
1. «Te piden demostrar tu carbono y tu trazabilidad.»
2. «Y las planillas y los PDF sueltos no son evidencia.»
3. «Esto es sicr3p.»

## Escena 1 — Qué es (landing real, 18 s) `[16:9 y 9:16]`

**Pantalla:** `/` (landing sicr3p), scroll suave del hero a la sección Servicios.

Subtítulos:
1. «sicr3p lee tus documentos reales — facturas, PDF, fotos.»
2. «Calcula tu CO2e con factores que citan su fuente.»
3. «Y sella cada registro en una cadena de integridad pública.»

## Escena 2 — Contabilidad de carbono en vivo (25 s) `[16:9 y 9:16]`

**Pantalla:** `/cargar` — se completan RUT/empresa/correo, se carga un documento
XML real, se envía; la secuencia de envío corre y aparece el resultado con las
t CO2e calculadas.

Subtítulos:
1. «Cargas el documento. Nada se digita a mano.»
2. «La plataforma lo lee y clasifica cada ítem.»
3. «El CO2e que ves lo calculó el motor recién, con este documento.»

## Escena 3 — Verificación del trámite + REP (15 s) `[16:9]`

**Pantalla:** `/verificar/:id` del trámite recién creado — hash, eslabón, detalle.

Subtítulos:
1. «Cada trámite queda sellado: hash, eslabón, cadena.»
2. «Con la declaración REP (Ley 20.920) cuando corresponde.»

## Escena 4 — Pasaporte de Origen y expediente del Corredor (15 s) `[16:9 y 9:16]`

**Pantalla:** `/lote/:codigo` público de un lote documental del Corredor
Bioceánico — cadena de custodia, documentos del expediente y semáforo.

Subtítulos:
1. «Para carga que cruza fronteras: el Corredor Bioceánico.»
2. «Expediente documental completo, con semáforo de completitud.»
3. «Los archivos siguen privados; el estado es público.»

## Escena 5 — Torre de control (15 s) `[16:9]`

**Pantalla:** `/torre/:codigo` — login con serial y clave de torre, mapa del
corredor con camiones reales de la flota demo.

Subtítulos:
1. «La torre de control sigue cada camión, paso a paso.»
2. «Cada paso queda sellado en la cadena del lote.»

## Escena 6 — Un panel para cada actor (12 s, capturas reales) `[16:9]`

**Pantalla:** capturas reales de los paneles (dashboard admin, mostrador) con
movimiento suave.

Subtítulos:
1. «Cada actor tiene su acceso: operación, mostrador presencial,»
2. «puerto, mandante y agencia de aduanas — cada uno ve solo lo suyo.»

## Escena 7 — Nada pide confianza (12 s) `[16:9 y 9:16]`

**Pantalla:** `/cadena` — explorador público de la cadena de integridad.

Subtítulos:
1. «Nada de esto pide que confíes en nuestra palabra.»
2. «La cadena completa es pública: cualquiera la puede recorrer.»

## Escena 8 — Cierre honesto + CTA (12 s, tarjeta) `[16:9 y 9:16]`

**Pantalla:** tarjeta navy de cierre.

Textos:
1. «sicr3p no certifica ni reemplaza a un verificador acreditado.»
2. «Deja tu evidencia calculada, citada y sellada — para que cualquiera la compruebe.»
3. «sicr3p.cl · contacto@sicrep.cl»

---

## Corte vertical 9:16 (~70 s)

Mismas escenas, condensadas: E0 (6 s) → E1 (12 s) → E2 (20 s) → E4 (12 s) →
E7 (8 s) → E8 (10 s). Viewport móvil real (el sitio es responsive) — no es un
recorte del horizontal, se graba aparte.

## Nota de producción

- Sin audio (sin TTS ni micrófono en el entorno de producción). Para narrar:
  grabar voz en off leyendo los subtítulos de cada escena sobre el video montado.
- Datos en pantalla: documento XML estructuralmente equivalente a un DTE 33, con
  datos ilustrativos; el cálculo, el hash y la cadena que se muestran son reales,
  producidos por la plataforma en el momento de la grabación. La flota de la torre
  es la demo oficial (`demo-torre`).
- Reglas de copy verificadas: sin «huella» (solo HuellaChile si apareciera), sin
  prometer certificación ni «listo para tu verificador», sicr3p nunca presentado
  como agencia de aduanas ni autoridad.
