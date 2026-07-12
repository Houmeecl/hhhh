# ETAPA 2 — Backlog (fuera del alcance de la Etapa 1)

Este documento registra las ideas y funcionalidades **explícitamente excluidas** de la
Etapa 1. Ninguna de ellas está implementada en el código actual. Se listan aquí como
backlog para planificación futura.

| # | Funcionalidad | Descripción en una línea |
|---|---------------|--------------------------|
| 1 | Conexión SII / RCV | Ingesta automática de documentos desde el SII y cuadratura del Registro de Compras y Ventas al momento de contratar. |
| 2 | Informes mensuales acumulativos | Reportes periódicos que acumulan y comparan la contabilidad de carbono mes a mes. |
| 3 | Trazabilidad en cadena comprador–vendedor | Vincular `rut_emisor` y `rut_receptor` entre empresas para trazar el carbono a lo largo de la cadena (los RUT ya se guardan; la feature NO se construye ahora). |
| 4 | Valorización de inventario con carbono | Inventario en CLP + CO2e con métodos FIFO / PMP. |
| 5 | Módulo transporte de personal minero | Cálculo de GHG Protocol Categoría 7 (traslado de trabajadores). |
| 6 | Verificador de XML DTE | Validación estructural y de firma de Documentos Tributarios Electrónicos. |
| 7 | Integración BigQuery | Data warehouse para análisis a gran escala. |
| 8 | Motor de cálculo propio | Reemplazar el motor externo (Simple) por un motor de cálculo de emisiones propio. |
| 9 | Benchmarking sectorial | Comparación de desempeño de carbono contra pares del mismo sector. |
| 10 | API para mineras mandantes | Endpoints para que empresas mandantes consuman datos de sus proveedores. |
| 11 | Auto-registro de clientes | Alta de cuentas sin intervención de un administrador (hoy sólo el admin crea cuentas). |

## Nota sobre la edición portátil (candado SII)

La **edición portátil** (`portable/`) usa el **RUT + clave SII como candado local** del
dispositivo: las credenciales se guardan **cifradas** y se **verifican offline**. Esto **no**
es la integración con el SII del ítem 1 — **no se contacta al SII**. La ingesta automática
desde el SII/RCV y la cuadratura siguen siendo Etapa 2.

Empaque futuro de la edición portátil (pendiente, opcional): ejecutable único (`.exe` con
`pkg`/`nexe`) y app de escritorio (Electron). Hoy corre como carpeta portátil con Node.

## Notas de preparación ya incluidas en Etapa 1

- Los campos `rut_emisor` y `rut_receptor` **se guardan en cada factura** para habilitar
  la trazabilidad comprador–vendedor (ítem 3) en el futuro, sin construir esa feature ahora.
- La tabla `simple_api_uso` registra consumo/latencia/costo, base para métricas de un
  eventual motor propio (ítem 8) y control de costos del motor externo.
