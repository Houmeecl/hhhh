> **NOTA (2026-07-28):** este archivo pasa a ser **registro histórico**, no
> instrucción. La landing `/aduana-verde` que el guion abre ya no existe —se
> plegó en la portada y la ruta redirige a `/`—, y los tres scripts que
> grababan y montaban el video (`grabar-demo-*`, `render-demo-*`) se
> eliminaron: apuntaban a pantallas que ya no están. Las URLs
> `sicr3p.cl/aduana-verde` de más abajo describen lo que se filmó en su
> momento; se dejan tal cual a propósito, porque reescribirlas falsearía el
> registro. El video resultante quedó en
> `docs/video/demo-presencial-2026-07.mp4`.
>
> **NOTA (2026-07-27):** este guion describe el flujo del terminal físico `/pos`
> (`PosTerminal.jsx`), descontinuado en favor del panel `/panel-verde` con
> operador logueado. El video ya fue entregado al usuario y no se regraba;
> esta nota es solo para que quede claro que el flujo grabado ya no existe
> en el producto.

# Guion — Video corto del canal presencial, julio 2026 (registro histórico)

**Duración total aproximada:** ~2 min 35 s
**Fuente reutilizada:** `docs/comercial/fuente/10-manual-beneficios.html` (Recorrido A, capturas
01-09) y voz de servicio de `frontend/src/pages/AduanaVerde.jsx` / `frontend/src/lib/i18n.js`
(prefijo `av.*`, `pos.*`, `ver.*`, `pas.*`). Componente grabado: `frontend/src/pages/PosTerminal.jsx`.
**Sin narración de voz:** este guion son subtítulos quemados sobre la grabación en vivo (Playwright).
**Documento de origen del trámite:** XML DTE — emisor RUT 76.123.456-0 "Distribuidora Norte SpA",
receptor RUT 11.111.111-1 "Cliente Prueba E2E SpA", folio 9999, ítems "Suministro eléctrico SEN"
4.000 kWh y "Cargo fijo servicio" $40.000, total $238.000.

---

## Escena 0 — Apertura / gancho (0:00–0:12 · 12 s)

**Pantalla/acción:** Sin interfaz de la app todavía. Cortinilla de apertura: pantalla en negro o
fondo sólido de marca (navy, sin ningún componente específico del producto) mientras se encadenan
los subtítulos. No requiere clic; es el único tramo del video sin pantalla real de sicr3p.

**Subtítulos (en cadena, ~3 s cada uno):**
1. "Cada mes llegan más boletas y facturas de las que alcanzas a ordenar."
2. "Sin tiempo para pasarlas a una planilla, papel por papel."
3. "Y sin nada real que mostrar cuando te piden el dato."
4. "Esto es sicr3p — también en el mostrador."

---

## Escena 1 — Landing del mostrador presencial (0:12–0:27 · 15 s)

**Pantalla/acción:** Abrir `https://sicr3p.cl/aduana-verde` (landing real, `AduanaVerde.jsx`).
Mostrar el header con la identidad de marca de sicr3p, el eyebrow y el hero. Hacer un scroll
lento hasta el bloque de los 4 pasos ("pasos_titulo").

**Subtítulos:**
1. "sicr3p — mostrador presencial"
2. "Atención presencial: trazabilidad que sí se ve."
3. "Tu factura entra. Tu Pasaporte Digital sale."
4. "Cálculo de CO2e, declaración REP y un QR que cualquiera revisa."

*(Nota para el grabador: aclarar aquí, en el propio subtítulo, que el servicio ocurre en un
mostrador físico — es la aclaración "presencial" que pidió el usuario, antes de entrar al terminal.)*

---

## Escena 2 — Login del terminal (0:27–0:42 · 15 s)

**Pantalla/acción:** Navegar a `/pos`. En la pantalla "Terminal sicr3p" (paso `inicio`),
clic en la tarjeta **"Conectar terminal"**. En la pantalla "Conectar terminal", completar
**"ID de terminal"** y **"Clave del terminal"** con credenciales reales del dispositivo de prueba
y presionar **"Conectar"**. (Si no hay credenciales de terminal disponibles para la grabación,
usar el botón **"Entrar en modo demostración"** de la misma pantalla — el procesamiento de
documentos sigue siendo real.)

**Subtítulos:**
1. "En el mostrador, el operador conecta el terminal."
2. "Cada dispositivo del mostrador tiene su propio ID y clave."
3. "Login por dispositivo, no por persona."

---

## Escena 3 — Datos del cliente / sesión (0:42–0:57 · 15 s)

**Pantalla/acción:** Pantalla "Datos del cliente" (barra de pasos en "Cliente", 1 de 5). Completar
**RUT empresa** con `11.111.111-1`, **Empresa** con `Cliente Prueba E2E SpA` y **Email** con un
correo de prueba. Dejar plegado "¿Tienes un código de acceso con créditos?" (no aplica en esta
demo). Presionar **"Continuar a captura"**.

**Subtítulos:**
1. "Paso 1 de 5: datos del cliente."
2. "Solo 3 campos obligatorios: RUT, empresa y email."
3. "Cliente Prueba E2E SpA — RUT 11.111.111-1."

---

## Escena 4 — Captura del documento (0:57–1:15 · 18 s)

**Pantalla/acción:** Pantalla "Capturar documentos" (paso "Documentos", 2 de 5). Clic en
**"Cargar XML / PDF"** y seleccionar el XML DTE real (folio 9999, Distribuidora Norte SpA →
Cliente Prueba E2E SpA). Mostrar el archivo en la lista ("1 de 5 documentos"). Presionar
**"Procesar 1 documento"**. Dejar correr la pantalla de carga **"Procesando en plataforma…"**.

**Subtítulos:**
1. "Paso 2: capturar documentos."
2. "Foto con la cámara o carga del XML/PDF — hasta 5 documentos."
3. "Factura electrónica folio 9999 — Distribuidora Norte SpA."
4. "sicr3p reconoce el documento y calcula el CO2e en la plataforma."

---

## Escena 5 — Resultado del cálculo (1:15–1:35 · 20 s)

**Pantalla/acción:** Pantalla "Resultado del cálculo" (paso "Resultado", 3 de 5). Mostrar el
número grande de t CO2e, el badge **"Cálculo verificable · sicr3p"** y la tabla "Detalle por
ítem" con las dos líneas del documento.

**Subtítulos:**
1. "Paso 3: resultado del cálculo."
2. "[mostrar el t CO2e real que calcule el motor en pantalla]"
3. "Suministro eléctrico SEN — 4.000 kWh."
4. "Cargo fijo servicio — detalle ítem por ítem, con su % del total."
5. "El cálculo lo hace el servidor: el operador no puede alterarlo."

---

## Escena 6 — Cobro / compensación (1:35–1:53 · 18 s)

**Pantalla/acción:** Pantalla "Compensación del CO2 calculado" (paso "Cobro", 4 de 5). Mostrar la
tarifa por t CO2e y el monto calculado. Elegir método de pago (p. ej. **"Tarjeta"**) y presionar
**"Cobrar $…"**. La UI real indica que el pago es simulado — mantener ese aviso en pantalla.

**Subtítulos:**
1. "Paso 4: compensación del CO2 calculado."
2. "Tarifa oficial visible. Compensación siempre voluntaria."
3. "Pago simulado — sin pasarela conectada todavía."
4. "El monto compensa exactamente las toneladas calculadas."

---

## Escena 7 — Comprobante con QR (1:53–2:08 · 15 s)

**Pantalla/acción:** Pantalla "Trámite registrado" (paso "Entrega", 5 de 5). Mostrar el QR de
verificación, el enlace **"Verificar trazabilidad →"** y el bloque de "Eslabón" + "hash". Mostrar
también, si el tiempo alcanza, la sección **"Carpeta física para el mandante"**.

**Subtítulos:**
1. "Paso 5: la entrega."
2. "Trámite registrado — con el QR de verificación al frente."
3. "Eslabón de la cadena y hash, a la vista de cualquiera."

---

## Escena 8 — Pasaporte Digital (2:08–2:23 · 15 s)

**Pantalla/acción:** Navegar a `/pasaporte/:id` usando el mismo id del documento procesado (la
misma página pública a la que apunta el QR del comprobante). Mostrar el título "Pasaporte Digital
de Producto", el badge "Registro verificado" y las secciones de emisiones, declaración REP y
estado de la cadena.

*(Nota para el grabador: en el flujo real, el QR del comprobante abre primero `/verificar/:id` y
desde ahí hay un botón "Ver pasaporte digital →" que lleva aquí. Para respetar el orden narrativo
de este guion, se puede navegar directo a `/pasaporte/:id` en esta escena y dejar `/verificar/:id`
para la Escena 9.)*

**Subtítulos:**
1. "El QR lleva al Pasaporte Digital — página pública, sin cuenta ni clave."
2. "Emisiones, declaración REP y estado de la cadena, en una sola pantalla."
3. "Evidencia trazable y verificable — no solo un número."

---

## Escena 9 — Verificación pública / cadena (2:23–2:38 · 15 s)

**Pantalla/acción:** Navegar a `/verificar/:id` del mismo documento: mostrar los badges
**"Trazabilidad verificada"** y **"Cadena intacta"**. Luego navegar a `/cadena` (explorador
público de la cadena de integridad) y mostrar el estado global.

**Subtítulos:**
1. "Cualquiera puede comprobarlo por su cuenta, sin pedir permiso."
2. "Trazabilidad verificada. Cadena intacta."
3. "La cadena pública de sicr3p: nadie altera un registro pasado sin que se note."

---

## Escena 10 — Cierre honesto (2:38–2:50 · 12 s)

**Pantalla/acción:** Volver a la landing `https://sicr3p.cl/aduana-verde` o dejar la última
pantalla de la cadena pública de fondo mientras corren los subtítulos de cierre.

**Subtítulos:**
1. "sicr3p no certifica ni reemplaza a un verificador acreditado."
2. "Entrega evidencia trazable y verificable de tu contabilidad de carbono."
3. "Un trámite. Un mostrador presencial. Un Pasaporte Digital."
4. "sicr3p.cl — mostrador presencial."

---

## Nota de producción

Este guion se usa como **subtítulos quemados** sobre un video grabado en vivo con Playwright
sobre la aplicación real de sicr3p (`PosTerminal.jsx` y las páginas públicas asociadas) —
este entorno no cuenta con texto-a-voz ni micrófono, por lo que no hay narración de audio en la
grabación resultante. El mismo documento se entrega aparte para que el usuario pueda grabar su
propia voz en off leyendo estos mismos textos, sincronizada con el video ya montado, si lo desea.
