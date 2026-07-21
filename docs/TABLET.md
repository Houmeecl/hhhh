# La app de tablet — terminal Aduana Verde como webapp instalable (PWA)

El terminal `/pos` ahora es una **aplicación instalable**: en la tablet del
punto de atención se instala con su propio ícono, abre a pantalla completa
(sin barra del navegador) y la pantalla **no se apaga** mientras el terminal
tiene sesión iniciada. No hay app store ni APK: es la misma plataforma web,
instalada.

## Requisito previo: HTTPS (una sola vez)

Los navegadores solo permiten instalar la app y activar su modo offline
sobre HTTPS. El VPS hoy sirve por IP (HTTP); para la tablet real hay que
activar el dominio:

```bash
# en el VPS, como root (apunta antes el DNS del dominio a la IP):
bash deploy/instalar-vps.sh app.sicr3p.cl
```

Eso configura nginx + certificado (certbot) automáticamente. Sin HTTPS, el
terminal funciona igual en el navegador — solo que sin instalación ni ícono.

## Instalar en la tablet

**Android (recomendado — Chrome):**
1. Abrir `https://<tu-dominio>/pos` en Chrome.
2. Menú ⋮ → **"Instalar aplicación"** (o el aviso "Agregar Aduana Verde a la
   pantalla principal").
3. La app queda con el ícono de sicr3p y abre directo en el login del
   terminal, a pantalla completa.

**iPad (Safari):**
1. Abrir `https://<tu-dominio>/pos` en Safari.
2. Botón Compartir → **"Añadir a pantalla de inicio"**.

## Modo mostrador (que nadie salga de la app)

- **Android:** Ajustes → Seguridad → **Fijar aplicación** (App Pinning) y
  fijar la app del terminal. Para un kiosco más duro, la app "Fully Kiosk
  Browser" permite bloquear todo el dispositivo a una sola URL.
- **iPad:** Ajustes → Accesibilidad → **Acceso Guiado**, activarlo y
  triple-clic al botón lateral con la app abierta.

## Hardware sugerido

Cualquier tablet Android de gama de entrada (2-4 GB RAM) sirve: el cálculo
pesado ocurre en el servidor, la tablet solo captura y muestra. Un soporte
de mostrador con carga permanente + el Wake Lock de la app mantienen el
terminal siempre listo.

## Impresión en el punto (la carpeta para el mandante)

Cuando el mandante del cliente exige la evidencia **en papel**, el paso
"comprobante" del terminal tiene el botón **"Imprimir carpeta"**: un solo
PDF con portada dirigida al mandante, resumen del trámite, QR de
verificación por documento, declaración REP y la hoja que le explica al
receptor cómo comprobar la carpeta en 30 segundos. Cualquier impresora
WiFi/USB común sirve: la tablet imprime con el diálogo nativo de
Android/iPad. El papel se autovalida: si las cifras impresas no coinciden
con lo que muestra el QR, el papel fue alterado.

## Consejos de cámara en el mostrador

- Factura plana sobre el mesón, sin dobleces.
- Luz de frente (no por detrás del documento — evita contraluz).
- Llenar el encuadre con el documento; enfocar tocando la pantalla.
- Documentos de varias páginas: una foto por página.
- Un soporte de tablet articulado permite fotografiar sin sacarla del pedestal.

## Qué pasa sin internet

El cascarón de la app abre igual (queda en caché), pero **las operaciones
requieren conexión**: el cálculo de emisiones, la declaración REP, el cobro
y el sellado en la cadena son del servidor por diseño (regla dura de la
plataforma: jamás se confía en un cálculo hecho en el dispositivo). Sin red,
el terminal muestra su pantalla y reintenta cuando vuelve la conexión.

## Actualizaciones

No hay nada que actualizar a mano: cada despliegue del VPS (automático,
cada 30 minutos tras un cambio) reemplaza la versión de la app en la
próxima apertura. La app nunca se queda "pegada" en una versión vieja
porque las navegaciones van siempre a la red primero.
