# Tarjeta de Viaje — credencial virtual con QR (sin chip, sin GPS)

La carga no puede ser obligada a pasar por puntos de control fijos. Por eso
el modelo se invierte: **la credencial viaja con la carga** — pero no es un
chip: es una **credencial virtual con QR**, que el transportista lleva en su
teléfono (o impresa en papel). Costo por unidad: **cero**.

## Cómo funciona

1. **Emitir** (panel admin → Pasaporte de Origen → lote → Tarjetas de viaje):
   el sistema genera el serial `TV-XXXX`, la **clave del portador** (visible
   UNA sola vez — se entrega por separado, nunca va impresa en la credencial)
   y la **credencial PDF** tamaño tarjeta con el QR.
2. **Entregar**: envía la credencial al transportista por WhatsApp/correo, o
   imprímela y pégala en la documentación de la carga. La clave viaja aparte.
3. **En ruta**:
   - Cualquiera que escanee el QR (de la credencial impresa O de la pantalla
     del teléfono del portador — la página `/v/TV-XXXX` muestra su propio QR)
     abre el **pasaporte público del lote**: cadena de custodia, emisiones,
     alineación normativa. **Ninguna lectura anónima queda registrada.**
   - **El portador** toca "Soy el portador — registrar paso", ingresa su
     clave, el punto de control (báscula, paso fronterizo, puerto) y el país.
     El paso queda **sellado como eslabón de transporte** en la cadena de
     hash del lote, con fecha y hora del servidor.
   - **La ruta es la secuencia de pasos**: puntos conocidos + timestamps
     sellados con hash. Sin GPS, y ningún paso se puede borrar ni editar
     (append-only).
4. **Cierre y expediente físico**: al llegar, "Cerrar lote" ancla el hash
   final en la **cadena pública global** de sicr3p (visible en `/cadena`);
   luego se descarga el **Expediente PDF** (estado SELLADO, cadena completa,
   normativa OECD/CBAM/DPP, hash + eslabón global) — se imprime y archiva
   junto a la credencial: ese es el respaldo físico sellado, verificable por
   cualquiera escaneando el QR.

## Opciones futuras (no construidas — costos reales)

- **Pase Apple Wallet / Google Wallet nativo**: requiere cuenta Apple
  Developer (US$99/año) + certificados de firma, y la API de Google Wallet.
  Se puede agregar después sin tocar el modelo (el pase apuntaría a la misma
  URL `/v/TV-XXXX`).
- **Chip NFC físico (NTAG213, ~CLP $300–800 c/u)**: solo si algún cliente lo
  exige; se graba la misma URL con la app "NFC Tools" y se registra el UID
  de fábrica en el campo "UID físico" (anti-clonación). El sistema ya lo
  soporta — es opcional.
- **RFID UHF de pallet**: solo con lectores fijos de portal en algún punto.

## Honestidad

sicr3p no es certificador, auditor ni autoridad. La credencial, el pasaporte
y el expediente registran y estructuran declaraciones y documentos
verificables de los actores de la cadena; la integridad la garantiza la
cadena de hash pública de sicr3p (SHA-256, append-only), no una blockchain
externa ni un tercero acreditado.
