# ETAPA 3 — Hoja de ruta

Lo pendiente después de la Etapa 2. Todos estos ítems dependen de **servicios externos,
credenciales o decisiones comerciales** que no se pueden resolver desde el repositorio;
por eso quedan documentados y no implementados.

## 1. Integraciones oficiales

| Ítem | Qué falta | Prerrequisito |
|------|-----------|---------------|
| Conexión SII / RCV | Ingesta automática del Registro de Compras y Ventas y cuadratura al contratar. | Credenciales SII del cliente + decisión de método (scraping vs. facturador autorizado). La edición portátil ya guarda RUT+clave SII cifrados como candado local: es la semilla de esta integración. |
| Validación de firma DTE | Verificación criptográfica de la firma y consulta de estado en el SII. | El verificador local (estructura, módulo 11, totales) ya está en `services/dte.js`; falta la parte en línea. |
| Factores oficiales AR/PY/BR | Reemplazar los borradores del Corredor Bioceánico por fuentes oficiales por país. | Convenios/fuentes (SIRENE-BR, etc.). Las metodologías por país con toggle ya existen. |

## 2. Producto y datos

| Ítem | Qué falta | Base ya construida |
|------|-----------|--------------------|
| Valorización de inventario (FIFO/PMP) | Inventario en CLP + CO2e por método contable. | Libro mayor por ítem + montos reales de DTE (neto/IVA/total ya se parsean). |
| Transporte de personal minero (GHG Cat. 7) | Formularios de traslado y factores por modo de transporte. | Patrón de cuentas/factores editables del Capital Natural. |
| Benchmarking sectorial | Comparación anónima contra pares del sector. | Requiere masa crítica de clientes (datos del piloto/concurso). |
| Valorización automática del capital natural | Precios sombra / ESVD por cuenta; hoy la valorización CLP es manual. | Módulo Capital Natural completo (cuentas, activos, balance PDF). |
| OCR propio | Leer guías, manifiestos y contratos que el motor externo no procesa. | Estados `traza`/`pendiente_motor` del Corredor ya lo contemplan. |

## 3. Plataforma

| Ítem | Qué falta | Prerrequisito |
|------|-----------|---------------|
| Motor de cálculo propio | Reemplazar el motor externo por cálculo propio de emisiones. | `simple_api_uso` ya mide consumo/costo para el caso de negocio. |
| Integración BigQuery | Data warehouse para análisis a gran escala. | Proyecto GCP + volumen de datos que lo justifique. |
| API para mineras mandantes | Endpoints para que mandantes consuman datos de sus proveedores. | Modelo de permisos entre empresas (la cadena comprador-vendedor ya enlaza los RUT). |
| Auto-registro de clientes | Alta de cuentas sin admin. | Decisión comercial + flujo de pago. |
| TNFD LEAP completo | Evaluación de dependencias e impactos en naturaleza (Locate-Evaluate-Assess-Prepare). | Módulo Capital Natural como fuente de datos. |

## Backlog técnico heredado

- Empaque `.exe`/binario de la edición portátil (`pkg` aún no soporta `node:sqlite`).
- Cifrado total de la base del portátil en reposo (hoy: clave SII cifrada + candado).
- Pase dedicado de accesibilidad (WCAG) y responsividad fina del panel admin.

## Criterio de entrada a Etapa 3

Cerrar primero: piloto con clientes reales (códigos de fundador del pre-lanzamiento),
verificación del motor externo en el VPS (`backend/scripts/verificar-simple.js` con
`MOCK_SIMPLE=false`) y despliegue productivo (README → "Despliegue en VPS").
