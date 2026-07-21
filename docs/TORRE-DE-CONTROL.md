# Torre de Control — demo del Corredor Bioceánico en un mapa vivo

La torre de control (`/torre/{código-de-lote}`) muestra el **mapa real**
(OpenStreetMap) del Corredor Bioceánico con un **camión que avanza cada vez
que alguien escanea el QR de la Tarjeta de Viaje y registra un paso**. No
hay GPS ni rastreo: la posición del camión ES el último punto de control
cuyo paso quedó **sellado con hash en la cadena del lote**. La pantalla se
actualiza sola cada 5 segundos.

Además, el **operador de torre** (con la credencial de un terminal) puede
enviarle una instrucción al camión — **"ir a puerto seco"** o **"ir a
puerto"** — que el portador ve al instante en su credencial `/v/{serial}`.
Las instrucciones son operativas: quedan en su propio historial
(append-only) y **no** entran en la cadena de hash (la cadena registra lo
que pasó; la instrucción dice adónde ir).

## Armar la demo (1 clic)

En el panel admin → **Origen** → tarjeta "🗼 Demo torre de control" →
**Crear demo**. Eso genera:

| Qué | Para quién | Dónde entra |
|-----|-----------|-------------|
| Lote documental demo (con su eslabón de origen en Campo Grande) | — | `/torre/LM-…` y `/lote/LM-…` |
| Tarjeta de Viaje `TV-XXXX` + clave | El "camión" (celular 1) | `/v/TV-XXXX` |
| Terminal torre `AV-XXXX` + clave | El "operador" (celular 2 o el mismo PC) | caja "Operador de torre" en `/torre/LM-…` |

**Las dos claves se muestran UNA sola vez** — anotarlas al crear la demo.
Se puede crear una demo nueva las veces que sea (cada una es un lote nuevo).

## Guion de la demo (5 minutos, proyector + 2 celulares)

1. **Proyectar la torre**: abrir `/torre/LM-…` en pantalla grande. Se ve el
   corredor Campo Grande → Antofagasta con el camión en el origen.
2. **El camión escanea**: en el celular 1, abrir `/v/TV-XXXX` (o escanear
   su QR), tocar "Soy el portador", elegir un punto del corredor (por
   ejemplo **Paso de Jama**) y poner la clave. El paso queda sellado.
3. **Mirar la pantalla**: en ~5 segundos el camión salta al punto en el
   mapa, la ruta verde se dibuja y el paso aparece en la línea de tiempo.
   *Frase clave: "la ruta es la secuencia de pasos sellados — sin GPS, sin
   hardware, sin rastreo".*
4. **La torre ordena**: en la caja "Operador de torre" entrar con la
   credencial `AV-XXXX` y tocar **"Ir a puerto seco"** (con una nota si se
   quiere). En el celular del camión aparece el banner 📢 con la
   instrucción en segundos.
5. **Cerrar con la verificación**: abrir `/lote/LM-…` y mostrar que
   cualquiera —sin cuenta, sin permiso— puede comprobar la cadena íntegra
   del viaje. Ese es el producto.

## Detalles que conviene saber

- **Quién puede qué**: cualquiera que tenga el link VE la torre y el
  pasaporte (solo datos ya divulgados como públicos). Registrar pasos exige
  la clave de la tarjeta; enviar instrucciones exige la credencial de un
  terminal (rol `pos`). Nada se escribe de forma anónima.
- **Los puntos del catálogo** (Campo Grande, Ponta Porã, Mariscal
  Estigarribia, Pozo Hondo, Tartagal, Jujuy, Susques, Paso de Jama, San
  Pedro, Calama, puerto seco La Negra, Puerto Antofagasta, Puerto
  Mejillones) tienen coordenadas **referenciales** — ubican el paso en el
  mapa, no son posiciones medidas. Un paso escrito a mano (texto libre)
  vale igual y queda en la línea de tiempo; solo que no mueve el camión.
- **Internet**: el dispositivo que MIRA la torre necesita conexión (los
  mosaicos del mapa vienen de OpenStreetMap). El registro de pasos es la
  misma llamada liviana de siempre.
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
