# APIs de integración por token (X-Api-Key)

Catálogo de las APIs máquina-a-máquina de sicr3p: rutas que un sistema
externo puede consumir directamente con una API key, sin operador humano
de por medio. Es documentación — no cambia código ni comportamiento.

## Modelo común

Cada actor externo (mandante, puerto, agencia de aduana, trazador) es una
fila propia en su tabla (`mandantes`, `puertos`, `agencias_aduana`,
`trazadores`) con un `token_hash` (SHA-256 de la key real — la key en
texto plano se muestra **una sola vez**, al crearla desde `/admin/accesos`,
y nunca se vuelve a recuperar). El mismo router acepta DOS caminos de
acceso a los mismos datos:

1. **`X-Api-Key: <key>`** — integración de sistemas externos (este documento).
2. **`Authorization: Bearer <JWT>`**, sesión humana del panel propio
   (`/panel-mandante`, `/panel-puerto`, `/panel-agencia`, `/panel-trazador`)
   — cuenta con email+contraseña, atada a la MISMA fila vía
   `usuarios.mandante_id` / `puerto_id` / `agencia_id` / `trazador_id`.
   Nunca ve datos de otro actor.

Ambos caminos llegan al mismo middleware (`requireMandante`/`requirePuerto`/
`requireAgencia`/`requireTrazador` en cada router) y devuelven exactamente
los mismos datos — no hay una versión "reducida" para integraciones.
Para trazador, la API key es OPCIONAL (a diferencia de puerto/agencia,
que siempre la tienen desde su creación): un trazador puede seguir
existiendo solo como cuenta humana; la key se genera aparte, cuando un
socio externo integra su propio sistema (ej. Kontax, migración 060).

Todas las rutas pasan por el rate limiter global `apiLimiter`
(`backend/src/index.js`). Cada consulta relevante queda en
`actividad_log` (`logActividad`) y se exporta a BigQuery
(`bigquery.exportAcceso`), identificando al actor por tipo+id, no por
usuario humano (`usuarioId: null` en el camino de API key).

## Cómo se genera y administra la key

Desde `/admin/accesos` (panel sicrep, rol admin), botón "Crear" en cada
pestaña (Mandantes / Puertos / Agencias / Trazadores — en esta última,
"Generar API key" es un botón aparte, ya que la entidad puede existir sin
key). El backend genera:

| Actor | Prefijo | Generación (`backend/src/routes/accesos.js`) |
|---|---|---|
| Mandante | `smk_` | `crypto.randomBytes(24).toString('base64url')` |
| Puerto | `pto_` | ídem |
| Agencia | `agn_` | ídem |
| Trazador | `trz_` | ídem |

Se guarda solo el hash (`hashApiKey`, alias de `hashToken` en cada router,
misma función en los tres para no desincronizar verificación). La key no
se puede recuperar después de creada — si se pierde, hay que rotarla
(desactivar + crear una nueva).

## Mandante — `backend/src/routes/mandante.js`

Empresa cliente que consulta trazabilidad y CO2e que sus proveedores le
han emitido. Ancla la consulta en `rut_receptor = su propio RUT` — nunca
ve datos donde no es el receptor. Whitelist opcional (`mandante_proveedores`):
vacía = ve todos sus proveedores; con filas = acotado a esos RUT.

| Método y ruta | Qué devuelve |
|---|---|
| `GET /api/mandante/proveedores` | Proveedores que le facturan, con totales de CO2e y categorías |
| `GET /api/mandante/proveedor/:rut/resumen?anio=&mes=` | Detalle de documentos de un proveedor puntual |
| `GET /api/mandante/export/alcance3?anio=&formato=csv\|json` | Export agregado por categoría GHG Protocol (1-15), sin límite de filas (export de cierre contable) |
| `GET /api/mandante/export/cbam?formato=csv\|json` | Lotes minerales del mandante exportador con resumen normativo CBAM (requiere whitelist no vacía — sin ella, export vacío) |
| `GET /api/mandante/export/cbam.pdf` | Mismo export CBAM en PDF |

## Puerto — `backend/src/routes/puerto.js`

Actor de solo lectura anclado a un `punto_id` del Corredor Bioceánico
(no a un RUT). Ve el tránsito documental que pasa por SU punto —
dominio distinto al de mandante, no es una extensión de ese modelo.

| Método y ruta | Qué devuelve |
|---|---|
| `GET /api/puerto/transitos` | Lotes tipo `documental` con al menos un eslabón cuyo `punto_id` coincide con el del puerto |
| `GET /api/puerto/transitos/:codigo` | Detalle completo (eslabones, documentos, semáforo, verificación de cadena) — 403 si el lote no pasa por su punto |

## Agencia de aduana — `backend/src/routes/agencia.js`

A diferencia de puerto (solo lectura), la agencia SÍ escribe: captura el
expediente documental del lote que le corresponde (`agencia_id` en
`lotes_minerales`). La agencia sigue haciendo la tramitación oficial;
sicr3p es su infraestructura documental — nunca se presenta como agencia
de aduanas.

| Método y ruta | Qué hace |
|---|---|
| `GET /api/agencia/expedientes` | Lotes documentales de SU agencia |
| `GET /api/agencia/expedientes/:codigo` | Detalle completo (eslabones, documentos, semáforo, verificación de cadena) |
| `GET /api/agencia/expedientes/:codigo/expediente.pdf` | Expediente en PDF |
| `POST /api/agencia/expedientes/:codigo/documentos` | Sube un documento (factura, packing list, carta de porte, MIC/DTA...) al expediente — reusa la misma lógica de lectura/hash que el panel admin |

## Trazador — `backend/src/routes/trazador.js`

Un tercero externo (auditora, cliente final, organismo, o un socio como
**Kontax**) que busca la trazabilidad de un RUT, pero SOLO de los RUT que
un admin le puso explícitamente en su lista blanca (`trazador_ruts`) —
sin filas ahí, no ve ningún RUT (nunca "todos"). Único actor donde la
API key es opcional: puede seguir existiendo solo como cuenta humana.

| Método y ruta | Qué devuelve |
|---|---|
| `GET /api/trazador/rutas-permitidas` | La whitelist de RUT de ESE trazador |
| `GET /api/trazador/buscar?rut=...` | Cruces del RUT (como cliente / quién le emite / a quién emite) — 403 si el RUT no está en su whitelist |

## Fuera de este catálogo (token, pero otro mecanismo)

`backend/src/routes/pos.js` (`POST /api/pos/auth`) usa un login por
**serial + clave de dispositivo** (tabla `pos_terminales`), no un header
`X-Api-Key` — es el mecanismo que reutiliza la Torre de Control para el
terminal del operador de flota. No es una integración de sistema externo
en el mismo sentido que los tres anteriores, así que no entra en esta
tabla.
