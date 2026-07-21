# Tarjeta de Viaje — trazabilidad física sin GPS (Pasaporte de Origen)

La carga no puede ser obligada a pasar por puntos de control fijos. Por eso
el modelo se invierte: **la credencial viaja con la carga**. Al inicio del
corredor se entrega una tarjeta física NFC (o RFID) vinculada al lote; en
ruta, el portador registra pasos leyéndola con cualquier teléfono; al cierre
queda un **expediente PDF sellado** que se imprime y archiva junto a la
tarjeta como respaldo físico.

## Qué comprar

| Opción | Cuándo | Costo aprox. |
|---|---|---|
| **Tarjeta/sticker NFC NTAG213 o NTAG215** | Caso general: se lee con cualquier teléfono moderno (Android/iPhone), sin app especial | CLP $300–800 c/u |
| RFID UHF (etiqueta pallet) | Solo si un punto (puerto, bodega) instala lectores fijos de portal | Mayor: requiere lectores dedicados |

Recomendación: partir con NTAG213 (144 bytes bastan de sobra para la URL).

## Cómo preparar una tarjeta (5 minutos)

1. En el panel admin → **Pasaporte de Origen** → abrir el lote → sección
   **Tarjetas de viaje** → "Emitir tarjeta" (con el nombre del transportista).
   El sistema entrega:
   - el **serial** `TV-XXXX`,
   - la **clave del portador** (visible UNA sola vez — imprimirla y
     entregarla junto con la tarjeta),
   - la **URL a grabar**: `https://<tu-dominio>/v/TV-XXXX`.
2. Con la app gratuita **NFC Tools** (Android/iOS): Escribir → Añadir
   registro → URL → pegar la URL → acercar la tarjeta → Escribir.
3. (Opcional, anti-clonación) En NFC Tools → Otros → leer el **UID** de
   fábrica del chip y registrarlo en el campo "UID físico" de la tarjeta en
   el panel.
4. Rotular la tarjeta con el serial y entregarla con la carga.

## Cómo funciona en ruta

- **Cualquiera** que acerque un teléfono a la tarjeta abre el pasaporte
  público del lote (`/v/TV-XXXX` → `/lote/LM-…`): ve la cadena de custodia,
  emisiones y alineación normativa. **Ninguna lectura anónima queda
  registrada** (decisión de diseño).
- **El portador** toca "Soy el portador — registrar paso", ingresa su clave,
  el punto de control (báscula, paso fronterizo, puerto…) y el país. El paso
  queda **sellado como eslabón de transporte** en la cadena de hash del lote,
  con fecha y hora del servidor.
- **La ruta es la secuencia de pasos**: puntos conocidos + timestamps
  sellados con hash. No se necesita GPS, y ningún paso puede borrarse ni
  editarse después (append-only).

## Cierre y expediente físico

1. Al llegar a destino, en el panel: **Cerrar lote**. El hash final queda
   **anclado en la cadena pública global** de sicr3p (eslabón visible en
   `/cadena`) — desde ese momento cualquier alteración del lote sería
   detectable públicamente.
2. Descargar el **Expediente PDF** (botón en el panel o en el pasaporte
   público): carátula con QR y estado SELLADO, cadena de custodia completa,
   emisiones declaradas vs trazadas, alineación normativa (OECD/CBAM/DPP) y
   el sello de integridad con el hash final + eslabón global.
3. Imprimir el expediente y **archivarlo junto con la tarjeta física**: ese
   es el respaldo físico sellado. Cualquiera puede verificar su autenticidad
   escaneando el QR y comparando el hash impreso con el de la cadena pública.

## Honestidad

sicr3p no es certificador, auditor ni autoridad. La tarjeta, el pasaporte y
el expediente registran y estructuran declaraciones y documentos
verificables de los actores de la cadena; la integridad la garantiza la
cadena de hash pública de sicr3p (SHA-256, append-only), no una blockchain
externa ni un tercero acreditado.
