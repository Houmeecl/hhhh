# Torre de Control — demo del Corredor Bioceánico en un mapa vivo

La torre de control (`/torre/{código-de-lote}`) muestra el **mapa real**
(OpenStreetMap) del Corredor Bioceánico con un **camión que avanza cada vez
que alguien escanea el QR de la Tarjeta de Viaje y registra un paso**. No
hay GPS ni rastreo: la posición del camión ES el último punto de control
cuyo paso quedó **sellado con hash en la cadena del lote**. La pantalla se
actualiza sola cada 5 segundos.

Además, el **operador de torre** (con la credencial de un terminal) puede
enviarle una instrucción al camión — **"ir a puerto"**, **"ir a puerto
seco"** o **designar una zona de estacionamiento** (ej. "Zona E-3, La
Negra") — que el portador ve al instante en su credencial `/v/{serial}`.
Las instrucciones son operativas: quedan en su propio historial
(append-only) y **no** entran en la cadena de hash (la cadena registra lo
que pasó; la instrucción dice adónde ir).

## Las dos pantallas de torre

- **`/torre` — la FLOTA**: todos los camiones activos en un solo mapa,
  cada uno con su código colgando del ícono. Exige credencial de operador
  (es el tablero de la operación completa, no una página pública). Un
  camión sin pasos aún **no aparece: se dibuja solo cuando su chofer
  activa la tarjeta con el primer paso**.
- **`/torre/LM-…` — un lote**: el mapa de ESE camión con su ruta verde, la
  línea de tiempo de pasos, el historial de instrucciones y la caja del
  operador para enviarle instrucciones. Esta vista es pública (muestra
  solo lo que el lote ya divulga).

## Armar la demo (1 clic)

En el panel admin → **Origen** → tarjeta "🗼 Demo torre de control" →
**Crear demo**. Eso genera **3 camiones + 1 torre**:

| Qué | Estado inicial | Dónde entra |
|-----|---------------|-------------|
| Camión demo 1 (`TV-…` + clave) | **En movimiento** (Mariscal Estigarribia) | `/v/TV-…` |
| Camión demo 2 (`TV-…` + clave) | **En movimiento** (Susques, más adelantado) | `/v/TV-…` |
| Camión demo 3 (`TV-…` + clave) | **Sin ruta — aparece al activar** | `/v/TV-…` |
| Terminal torre (`AV-…` + clave) | Comanda a los tres | `/torre` (flota) y cada `/torre/LM-…` |

**Las claves se muestran UNA sola vez** — anotarlas al crear la demo.
Se puede crear una demo nueva las veces que sea (cada una crea lotes nuevos).

## Guion de la demo (5 minutos, proyector + 2 celulares)

1. **Proyectar la flota**: abrir `/torre` en pantalla grande y entrar con
   la credencial de torre. Se ven **dos camiones ya en ruta** en puntos
   distintos del corredor; el tercero está en la lista como "sin posición
   aún".
2. **Activar el camión 3**: en el celular, abrir `/v/TV-…` del camión 3,
   tocar "Soy el portador", elegir un punto (ej. **San Pedro de Atacama**)
   y poner la clave. En ~5 segundos **aparece el tercer camión en el
   mapa**. *Frase clave: "la ruta es la secuencia de pasos sellados — sin
   GPS, sin hardware, sin rastreo".*
3. **Seguir moviéndolo**: cada nuevo paso escaneado lo hace avanzar; en
   `/torre/LM-…` se ve su ruta verde completa.
4. **La torre ordena**: desde la torre del lote, con la credencial
   conectada, elegir destino — **puerto**, **puerto seco** o
   **estacionamiento** escribiendo la zona (ej. "Zona E-3, La Negra") —
   y enviar. En el celular del chofer aparece el banner 📢 con la
   instrucción y la zona en segundos.
5. **Cerrar con la verificación**: abrir `/lote/LM-…` y mostrar que
   cualquiera —sin cuenta, sin permiso— puede comprobar la cadena íntegra
   del viaje. Ese es el producto.

## Escaneo del punto de control (QR físico)

Desde la Tarjeta de Viaje (`/v/{serial}`), el portador ya no tiene que
tipear el punto de control: cada punto físico del corredor (puerto,
frontera, estacionamiento) lleva un **cartel QR impreso** — el botón
"📷 Escanear punto de control" abre la cámara del teléfono, lo lee y
autocompleta el punto. El `<select>`/texto libre de siempre **sigue ahí**:
si la cámara falla, se deniega el permiso, o el QR no calza con ningún
punto del catálogo, el ingreso manual no se bloquea nunca.

- **Carteles**: se generan e imprimen desde el panel admin → Pasaporte de
  Origen → "Carteles QR del corredor" (`/admin/origen-carteles-qr`). Cada
  QR codifica `{URL pública}/pc/{punto_id}` — una página informativa (por
  si alguien lo escanea con la cámara nativa fuera de la app), no un
  secreto: el punto de control no autoriza nada por sí solo, solo
  autocompleta un dato declarativo (igual que el texto libre de siempre).
  **Imprimir en alto contraste y proteger de la intemperie** — el sol
  directo en los pasos fronterizos puede lavar el QR.
- **Sin señal en el punto de control**: el escaneo del QR es 100% local
  (no necesita red); lo que sí la necesita es registrar el paso. Si el
  teléfono no tiene señal en ese momento (frecuente en los pasos
  fronterizos), el paso queda guardado en el teléfono y se reenvía solo
  apenas hay una autenticación con conexión — o con el botón "Reintentar
  ahora". No se pierde ni se bloquea el registro por falta de señal.
- **`via_qr` en el eslabón**: un paso registrado por escaneo queda con
  `datos.via_qr = true` (visible como 📷 en la línea de tiempo de la
  torre y el pasaporte del lote; ⌨️ para lo tipeado a mano). Es una señal
  de UX/auditoría, no una prueba criptográfica de presencia — el modelo
  de confianza sigue siendo el mismo eslabón declarativo sellado con hash
  de siempre.

## Detalles que conviene saber

- **Quién puede qué**: cualquiera que tenga el link VE la torre de un lote
  y su pasaporte (solo datos ya divulgados como públicos). La vista de
  FLOTA (`/torre`), registrar pasos y enviar instrucciones exigen
  credencial (terminal rol `pos` o clave de tarjeta según el caso). Nada
  se escribe de forma anónima.
- **Los puntos del catálogo** (Campo Grande, Ponta Porã, Mariscal
  Estigarribia, Pozo Hondo, Tartagal, Jujuy, Susques, Paso de Jama, San
  Pedro, Calama, puerto seco La Negra, Puerto Antofagasta, Puerto
  Mejillones) tienen coordenadas **referenciales** — ubican el paso en el
  mapa, no son posiciones medidas. Un paso escrito a mano (texto libre)
  vale igual y queda en la línea de tiempo; solo que no mueve el camión.
- **Internet**: el dispositivo que MIRA la torre necesita conexión (los
  mosaicos del mapa vienen de OpenStreetMap). El registro de pasos es la
  misma llamada liviana de siempre — y ahora tolera cortes de señal
  gracias a la cola local descrita arriba.
- **Pasos en Chile sin RUT**: el portador registra pasos sin RUT también en
  territorio chileno — su identidad la da la clave de la tarjeta (queda
  `tarjeta_serial` en el eslabón). Cualquier otro rol chileno de la cadena
  sigue exigiendo RUT válido.
- **Producción real**: la misma pantalla sirve para lotes reales (no solo
  demo): cualquier lote con tarjeta de viaje tiene su torre en
  `/torre/{código}`.

## Qué NO es

sicr3p no es autoridad, no realiza trámites aduaneros y no rastrea
vehículos. La torre muestra pasos **declarados por actores autorizados** y
sellados con hash, más instrucciones operativas de coordinación. El
disclaimer está impreso al pie de la pantalla.
