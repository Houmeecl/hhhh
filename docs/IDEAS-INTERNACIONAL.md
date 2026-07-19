# Ideas de internacionalización — Aduana Verde imprescindible

Ideas **evaluadas** (no lluvia genérica) para que Aduana Verde y la plataforma sicr3p
se vuelvan imprescindibles para exportadores y mandantes con exposición internacional.
Cada idea declara: qué es, por qué vuelve imprescindible el servicio, **qué organismo o
norma avala la metodología** (nunca a sicr3p — regla de honestidad del repo), qué existe
ya en el repositorio como base, qué falta para hacerla real y el esfuerzo estimado
(S/M/L). Los prerrequisitos externos (credenciales, clientes, textos normativos
descargados) se nombran sin maquillaje: nada de esto es un "certificado" ni una
declaración oficial mientras no exista el respaldo correspondiente.

Contexto de partida (ya construido en este repo): motor de cálculo propio (XML/PDF/OCR)
con clasificación por Alcance GHG 1/2/3, declaración REP por componentes, cadena de
hash pública, sello SVG multilingüe, POS con compensación voluntaria, API para
mandantes con permisos finos y webhooks, registro de fuentes metodológicas avaladas
(migración `018_metodologias_avaladas.sql`) e i18n es/en/pt de las superficies públicas.

---

## 1. CBAM — Mecanismo de Ajuste en Frontera por Carbono (Reglamento UE 2023/956)

**Qué es.** La UE cobra en frontera el carbono incorporado de ciertos productos
importados: hierro y acero, aluminio, cemento, fertilizantes, hidrógeno y electricidad
(Anexo I del reglamento — el cobre **no** está incluido hoy). El período transitorio de
reporte rige desde octubre de 2023; el régimen definitivo (obligación económica) corre
desde 2026 — la simplificación aprobada por la UE en 2025 agregó un umbral de minimis
(~50 t/año por importador) y desplazó la compra efectiva de certificados CBAM a 2027:
**validar contra el texto consolidado vigente antes de citar fechas a un cliente**.

**Por qué vuelve imprescindible a Aduana Verde.** El declarante CBAM es el importador
europeo, pero el dato lo tiene (o no lo tiene) el exportador: si no entrega emisiones
incorporadas reales y trazables, el importador usa valores por defecto castigados y el
producto chileno pierde competitividad. Aduana Verde es el **punto de captura del dato
por embarque**: el exportador sale del mostrador con sus emisiones calculadas, encadenadas
con hash y verificables por QR — legibles en inglés por el importador (i18n de este ciclo).
El gancho natural en la región: los proyectos de hidrógeno verde de Antofagasta con
destino europeo, que nacerán con esta exigencia puesta.

| Campo | Detalle |
|-------|---------|
| Aval | Reglamento (UE) 2023/956 (CBAM) + su reglamentación de implementación. Metodología de emisiones incorporadas definida por la Comisión Europea. |
| Base en el repo | Motor propio con factores citados por fuente (`motor_categorias` + `fuentes_metodologicas`), cadena de hash (`services/cadenaHash.js`), comprobante verificable multilingüe, módulo Corredor para la traza del embarque (MIC/DTA, `documentos_corredor`). |
| Qué falta | Captura estructurada por embarque: producto (código NC), masa, emisiones directas e indirectas del proceso productivo — un dato que el DTE no trae y requiere formulario propio. Metodología CBAM oficial descargada y citada en `fuentes_metodologicas`. Y sobre todo: un exportador real de un sector del Anexo I. **sicr3p entrega la BASE de datos trazable; la declaración CBAM oficial la presenta el importador UE en el registro CBAM — jamás prometer lo contrario.** |
| Esfuerzo | **L** (formulario por embarque + export para el importador + metodología citada). |

## 2. ISO 14083 / GLEC Framework v3 — emisiones de transporte por envío

**Qué es.** ISO 14083:2023 es la norma internacional para cuantificar y reportar
emisiones de las operaciones de la cadena de transporte; el GLEC Framework v3 (Smart
Freight Centre, alineado con ISO 14083) es su implementación práctica y **el idioma de
los freight forwarders**: emisiones por envío, por modo y por tramo, en t-km.

**Por qué vuelve imprescindible a Aduana Verde.** El corredor bioceánico
(Antofagasta ↔ AR/PY/BR) mueve carga que cruza cuatro jurisdicciones; los operadores
logísticos internacionales ya cotizan y reportan en lenguaje GLEC. Si el comprobante
Aduana Verde de un embarque habla ese idioma (t CO2e por envío con factor por modo
citado), el forwarder y el dueño de la carga pueden usarlo directamente en sus propios
reportes — nadie más ofrece eso en un mostrador del corredor.

| Campo | Detalle |
|-------|---------|
| Aval | ISO 14083:2023 + GLEC Framework v3 (Smart Freight Centre). Ya registrado como fuente `glec_v3` en `fuentes_metodologicas` (estado `avalada_referencial`). |
| Base en el repo | Módulo Corredor completo (migración `002_corredor.sql`): metodologías por país CL/AR/PY/BR en borrador con toggle, documentos con MIC/DTA como traza. Categoría `maritimo_contenedor` del motor con factor GLEC v3 citado (0,012 kgCO2e/t-km, referencial — validar). Hoy, sin t-km reales, aplica el método por gasto. |
| Qué falta | Capturar **masa y distancia por envío** (los t-km reales) en el flujo del Corredor — el MIC/DTA trae parte del dato. Factores por modo carretero, ferroviario y fluvial (hidrovía PY) desde el GLEC v3 descargado. Subir `glec_v3` a `validada_oficial` solo cuando el documento vigente esté descargado. |
| Esfuerzo | **M** (campos por envío + factores por modo; la infraestructura de traza ya existe). |

## 3. ISSB IFRS S2 / NCG 461 (CMF) — el Alcance 3 que piden bolsas y bancos

**Qué es.** IFRS S2 (ISSB, 2023) exige a las empresas reportantes divulgar emisiones de
Alcance 1, 2 y **3** según GHG Protocol. En Chile, la NCG 461 de la CMF ya obliga a las
sociedades listadas a incluir sostenibilidad en la memoria anual, y la CMF ha señalado
la convergencia hacia ISSB (validar el estado normativo vigente antes de afirmarlo a un
cliente). El Alcance 3 de un mandante son las emisiones de sus **proveedores**.

**Por qué vuelve imprescindible a Aduana Verde.** El mandante listado (minera, retail)
no puede inventar su Alcance 3: necesita datos de proveedores, y sus proveedores chicos
no responden plataformas web — sí pasan por un mostrador. El dato capturado en Aduana
Verde ya llega al mandante por la API de sicr3p (clave propia, lista blanca por RUT,
webhooks) con trazabilidad por documento. Falta solo el formato que su equipo de
reporte pueda citar.

| Campo | Detalle |
|-------|---------|
| Aval | IFRS S2 (ISSB, Fundación IFRS) + GHG Protocol Corporate Value Chain (Scope 3) Standard; localmente NCG 461 (CMF). GHG Protocol ya registrado en `fuentes_metodologicas` (`ghg_protocol_2004`). |
| Base en el repo | API mandantes v2 (`routes/mandante.js`: X-Api-Key, `mandante_proveedores`, `webhook_url`), clasificación `alcance_ghg` por categoría del motor (incluye categorías de Alcance 3 Cat. 1/4/5/6), informes PDF con alcances (patrón defensivo `fetchAlcancesGHG` en `services/pdf.js`). |
| Qué falta | Export agregado por período y proveedor, con desglose por alcance y categoría GHG y las fuentes metodológicas citadas (CSV/JSON), pensado para pegarse en la memoria del mandante. Mapeo explícito a las 15 categorías de Alcance 3. Feedback de un mandante real usando la API (mismo prerrequisito que el portal del mandante en ETAPA3). |
| Esfuerzo | **M** (S si se parte por un export simple sobre los endpoints existentes). |

## 4. HuellaChile (MMA) — reconocimiento local para los clientes de sicr3p

**Qué es.** Programa nacional **voluntario** del Ministerio del Medio Ambiente para la
gestión de gases de efecto invernadero a nivel organizacional (base ISO 14064-1), que
otorga reconocimientos a las organizaciones — el primero es el sello de cuantificación.
El reconocimiento se lo da el MMA **al cliente** que postula con su inventario; nunca a
sicr3p ni a través de sicr3p.

**Por qué vuelve imprescindible a Aduana Verde.** Es el camino de reconocimiento local
más concreto: el cliente que tramita sus documentos todo el año en Aduana Verde acumula,
sin darse cuenta, el insumo de su inventario (datos por documento, factores citados,
alcances clasificados). sicr3p **prepara el expediente** ordenado y trazable;
HuellaChile reconoce. Para el cliente, el mismo trámite de mostrador se convierte en la
antesala de un reconocimiento estatal visible.

| Campo | Detalle |
|-------|---------|
| Aval | Programa HuellaChile del MMA (base metodológica ISO 14064-1 y GHG Protocol). Ya registrado como fuente `mma_huellachile` en `fuentes_metodologicas`, junto al factor eléctrico del SEN (`cen_sen`). |
| Base en el repo | Factor SEN citado en el motor (`electricidad` → `mma_huellachile`), clasificación por alcances, informes PDF por período, cadena de hash como respaldo de integridad del expediente. |
| Qué falta | Un cliente real que quiera postular. Cuenta y registro en la plataforma del programa (vía Ventanilla Única RETC). El instructivo vigente del programa descargado, para armar el export "expediente HuellaChile" con el formato y los requisitos que pide (incluida la eventual verificación que el programa exija — validar requisitos vigentes). |
| Esfuerzo | **S–M** en código (un export con formato); el grueso es trámite externo del cliente. |

## 5. Comprobante y verificación multilingüe + sello `?lang=en` (este ciclo)

**Qué es.** Las superficies públicas (verificador, calculadora, landing Aduana Verde,
POS) en es/en/pt y el sello SVG con etiquetas en inglés vía `?lang=en`. Este ciclo lo
construye: `frontend/src/lib/i18n.js` (es/en/pt, `?lang=` en la URL) y
`services/sello.js` (`ETIQUETAS` es/en).

**Por qué vuelve imprescindible a Aduana Verde.** Es la llave de todo lo anterior: el
proveedor chileno le muestra el QR a su mandante extranjero **y el mandante lo LEE**.
Un comprobante verificable que el destinatario no entiende no sirve de nada en una
licitación internacional; uno en su idioma convierte cada trámite de mostrador en un
dato utilizable en Rotterdam o São Paulo sin intermediarios.

| Campo | Detalle |
|-------|---------|
| Aval | No es una norma en sí: es hacer legible la metodología ya avalada. La terminología GHG Protocol / ISO 14083 es nativa en inglés, así que la versión en inglés cita los estándares en su idioma original. Regla de honestidad mantenida en todos los idiomas: jamás "certified" ni "accredited", y "Aduana Verde" no se traduce como "customs". |
| Base en el repo | i18n liviano es/en/pt con fallback a español (`lib/i18n.js`), sello con `lang` es/en (`services/sello.js`), verificador público ya traducido (`pages/Verificar.jsx`). |
| Qué falta | Cerrar este ciclo. Siguientes pasos naturales: comprobante por correo y PDF en el idioma elegido, y `pt` en las etiquetas del sello (hoy es/en). |
| Esfuerzo | **S** (en curso este ciclo; extensiones también S). |

## 6. Tarifa dual CLP/USD referencial → multi-moneda del corredor

**Qué es.** El POS y la calculadora muestran la compensación voluntaria también en USD
referencial cuando el admin fija a mano el tipo de cambio (`config_pos.tipo_cambio_usd_clp`,
migración 018; `NULL` = no se muestra USD). Este ciclo lo construye. A futuro:
multi-moneda por país del corredor (ARS/PYG/BRL).

**Por qué vuelve imprescindible a Aduana Verde.** El ancla de la tarifa referencial es
el impuesto verde chileno (Ley 20.780 art. 8), que está definido **en dólares**
(US$5/t): mostrar USD no es cosmética, es coherencia con el ancla y es el número que el
mandante o comprador extranjero entiende de inmediato. En el corredor, cotizar la
compensación en la moneda del país del interlocutor baja la fricción de venta.

| Campo | Detalle |
|-------|---------|
| Aval | Ley 20.780 art. 8 (ancla en USD del precio referencial). Las conversiones son referenciales y lo dicen. |
| Base en el repo | `config_pos.tipo_cambio_usd_clp` (migración 018), validación en servidor (`validarTipoCambio`, tope $5.000/USD), exposición en `routes/pos.js`. Regla ya cableada: el tipo de cambio lo fija el admin a mano citando su fuente — jamás se consulta uno automático. |
| Qué falta | Cerrar este ciclo (dual CLP/USD). Multi-moneda: decisión comercial de qué monedas ofrecer, anclas fiscales locales si existen (AR/PY/BR), y las mismas reglas — conversión referencial, tipo de cambio manual con fuente citada, cálculo siempre en servidor. |
| Esfuerzo | **S** el dual (este ciclo) · **M** la multi-moneda del corredor. |

## 7. (Adicional) Respuestas CDP de cadena de suministro

**Qué es.** CDP es el cuestionario ambiental que los grandes compradores globales
(mineras, retail) envían a sus proveedores; desde 2024 está alineado con IFRS S2. Un
proveedor chileno que recibe el cuestionario CDP de su mandante necesita exactamente
los números que sicr3p ya calcula: emisiones por alcance con metodología citada.

| Campo | Detalle |
|-------|---------|
| Aval | CDP (cuestionario alineado con IFRS S2 / GHG Protocol). |
| Base en el repo | La misma del punto 3 (alcances + fuentes citadas + informes). |
| Qué falta | Nada nuevo de infraestructura: el export del punto 3 sirve; solo un mapeo de campos a las preguntas de emisiones del cuestionario vigente (descargarlo primero). |
| Esfuerzo | **S** (colgado del export ISSB del punto 3). |

---

## Orden recomendado (impacto vs. esfuerzo)

| Orden | Idea | Impacto | Esfuerzo | Por qué en este orden |
|-------|------|---------|----------|-----------------------|
| 1 | Multilingüe + sello `?lang=en` | Alto | S (este ciclo) | Habilita todo lo demás: sin comprobante legible afuera, ninguna otra idea internacional despega. |
| 2 | Tarifa dual CLP/USD | Medio | S (este ciclo) | Coherente con el ancla en USD del impuesto verde; costo marginal casi cero. |
| 3 | Export Alcance 3 para ISSB / NCG 461 | Alto | M | La demanda ya existe y es local (mandantes listados bajo NCG 461); la API v2 está construida — falta solo el formato citable. |
| 4 | Expediente HuellaChile | Medio-alto | S–M + trámite externo | Reconocimiento estatal visible para el cliente; refuerza la credibilidad de todo el resto. Depende de un cliente que postule. |
| 5 | ISO 14083 / GLEC por envío (Corredor) | Alto | M | El diferenciador del corredor bioceánico; requiere capturar t-km reales antes de prometer nada. |
| 6 | CBAM — base de datos por embarque | Muy alto (condicionado) | L | El de mayor valor unitario, pero condicionado a un exportador real de los sectores del Anexo I (hoy el gancho más probable: hidrógeno verde) y a la metodología CBAM descargada. |
| 7 | Mapeo CDP | Medio | S | Se cuelga gratis del export del punto 3; no antes. |

Regla transversal que no cambia con la internacionalización: los organismos citados
(IPCC, GHG Protocol/WRI, DEFRA, MMA, Smart Freight Centre, ISO, ISSB, Comisión Europea)
avalan la **metodología**, no a sicr3p; todo factor o dato sin fuente oficial vigente
descargada queda marcado "referencial — validar"; y los cálculos de dinero, niveles y
porcentajes siguen viviendo solo en el servidor.
