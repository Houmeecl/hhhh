# Amplitude en SICR3P

Integración cliente con el Script Loader oficial de Amplitude Browser SDK 2.
No añade dependencias npm. Se inicializa una vez por documento, incluso con
React StrictMode y recargas de módulos. Una falla del proveedor no bloquea el sitio.

## Activación

En frontend/.env.local o en las variables del build:
```dotenv
VITE_AMPLITUDE_ENABLED=true
VITE_AMPLITUDE_API_KEY=CLAVE_PUBLICA_DEL_PROYECTO
VITE_AMPLITUDE_SERVER_ZONE=US
```
Usar EU únicamente si el proyecto Amplitude pertenece a esa zona.
No usar una Secret Key. Las variables VITE son públicas y se incorporan al build.
Después ejecutar npm ci y npm run build desde frontend y desplegar por el flujo normal.
Este cambio no despliega el VPS ni modifica main automáticamente.

## Eventos conectados

- pagina_visitada: únicamente las rutas públicas enumeradas en analyticsCore.mjs.
  Se emite la categoría de página, nunca la URL. No cuenta rutas privadas,
  verificación de documentos, enlaces de pago, seriales o tokens.
- inscripcion_completada: después de una respuesta exitosa de inscribirEmpresa.
  No incluye ningún campo del formulario.

## Eventos preparados para el futuro diseñador de seguros

problema_registrado, analisis_completado, propuesta_consultada,
simulacion_completada, cotizacion_solicitada.

El diseñador todavía no existe en este repositorio. Estos eventos están definidos,
pero NO se emiten artificialmente ni se reinterpretan acciones de otros módulos.
Cuando se implemente cada operación, llamar después de su éxito:
```js
import { trackAnalytics } from '../lib/amplitude.js';
void trackAnalytics('problema_registrado', {
  rubro: 'transporte_personal',
  comuna: 'mejillones',
  tipo_problema: 'averia',
});
```
Solo admite los valores enumerados en analyticsCore.mjs. No enviar texto libre,
RUT, email, nombre de empresa, documentos, montos exactos ni identificadores de viaje.
Los embudos deben crearse en el proyecto Amplitude una vez recibidos los eventos reales.
Los reportes representan uso de la plataforma, no una tasa de siniestralidad.

## Privacidad y controles

Autocapture, atribución, captura de formularios, enriquecimiento de URL, configuración
remota y Session Replay no se habilitan. Se desactiva el registro de IP mediante
trackingOptions. La conexión de red sigue exponiendo una IP de transporte al proveedor.
La identidad anónima se mantiene por sesión/pestaña, no por cuenta o RUT.
Se respeta Global Privacy Control y la preferencia local sicr3p.analytics.optout.
La interfaz de preferencias puede usar setAnalyticsOptOut(true/false); no se añade
un banner ni se modifica el flujo de consentimiento existente.
Si corresponde pedir consentimiento, mantener VITE_AMPLITUDE_ENABLED=false hasta
conectar la preferencia pertinente. La configuración de una key no lo activa sola.

Si se usa CSP, permitir el Script Loader de Amplitude y los dominios de ingreso
de la zona del proyecto siguiendo su documentación; no relajar otros orígenes.

## Verificación

1. node --test frontend/test/analytics.test.mjs
2. Compilar frontend y abrir /plataforma.
3. En Network comprobar la entrega de pagina_visitada al endpoint de Amplitude:
   HTTP 200 y events_ingested mayor que cero.
4. Confirmar ese mismo evento en el proyecto Amplitude y revisar sus propiedades.
5. Completar una inscripción de prueba solo en un entorno de prueba y comprobar
   inscripcion_completada; una respuesta fallida no debe emitirla.
6. Verificar que /pagar/:token y /admin no emiten pagina_visitada ni contienen
   URLs o tokens en el cuerpo de eventos.

Las pruebas locales usan un SDK simulado. No equivalen a recepción real en Amplitude.
Sin key y acceso al proyecto no puede verificarse el primer evento.

Documentación:
https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2
