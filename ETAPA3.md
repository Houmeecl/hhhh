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
| Conexión a aduanas | Validar en línea declaraciones (DIN/SIM/SOFIA/Siscomex) y estados de despacho. | La carga de documentos aduaneros reales + MIC/DTA como traza ya existe en el Corredor. **"Aduana verde" queda excluida del alcance en todas las etapas** (decisión de negocio). |

## 2. Producto y datos

| Ítem | Qué falta | Base ya construida |
|------|-----------|--------------------|
| Benchmarking sectorial | Comparación anónima contra pares del sector. | Requiere masa crítica de clientes (datos del piloto/concurso). Valorización FIFO/PMP y Transporte Cat. 7 ya quedaron implementados en Etapa 2. |
| Valorización automática del capital natural | **Hecho, mecanismo**: `cuentas_naturales.precio_clp_unidad` + `precio_fuente` (editable en "Plan de cuentas"); si un activo no tiene `valor_clp` manual, se calcula solo (extensión × precio) y queda marcado "auto" en la tabla y el PDF (`services/capitalNatural.valorizarActivo`). Sin seed: no se inventan precios sombra/ESVD sin fuente citada por el admin — el campo parte vacío. Falta: cargar precios reales (ESVD, tasación, etc.) por cuenta, decisión de negocio/dato externo, no de código. | Módulo Capital Natural completo (cuentas, activos, balance PDF). |
| OCR propio | Leer guías, manifiestos y contratos que el motor externo no procesa. | Estados `traza`/`pendiente_motor` del Corredor ya lo contemplan. |
| Soporte PCAF (Partnership for Carbon Accounting Financials) | PCAF es el estándar que usan bancos/inversionistas para medir "emisiones financiadas" de su cartera de crédito e inversión (no las emisiones operacionales de una empresa, que es lo que mide sicr3p hoy con GHG Protocol Corporate Standard). Investigado: BancoEstado ya lo adoptó en Chile para su cartera; +40 instituciones en LatAm lo usan desde 2015. **No es una extensión del modelo actual** — requeriría una entidad nueva "cartera/portafolio" con instrumentos financieros, cálculo de "attribution factor" (deuda/patrimonio outstanding vs. valor de la empresa financiada) y un tipo de informe nuevo; Capital Natural y `motor_categorias` no son reutilizables para esto (están diseñados para consumo operacional propio, no para carteras de terceros). Prioridad baja: sin demanda real hoy (ningún cliente de sicr3p es una institución financiera); se retoma si aparece un cliente banco/fondo real. | Ninguno construido — solo investigado. |

## 3. Plataforma

| Ítem | Qué falta | Prerrequisito |
|------|-----------|---------------|
| Motor de cálculo propio | **Hecho para DTE XML** (`services/motorPropio.js` + `motor_categorias`, hook automático en `POST /api/sesiones`, admin en "Motor propio"): clasifica cada ítem por palabra clave y calcula CO2e con factor físico (cantidad × factor por unidad) o por gasto (GHG Protocol spend-based) según el dato real del documento, sin depender de terceros. Motivación: due diligence sobre el motor externo detectó licencia amplia sobre "Customer Data" y tope de responsabilidad de solo €1.000. Falta: PDF/JPG/PNG/HEIC (documentos escaneados sin texto extraíble) siguen con el motor externo — requieren OCR/visión, no disponible en este entorno de construcción. Factores por tipo específico de combustible (hoy un factor representativo por categoría) quedan como refinamiento futuro, ya editable desde el admin. | `motor_categorias` (6 categorías con factor citado) + `facturas.motor` para medir avance de independencia. |
| Integración BigQuery | **Conector implementado** (`services/bigquery.js` + `backend/bigquery/schema.sql`): todo lo escaneado se exporta al activar `BIGQUERY_EXPORT=true`. Falta: crear el proyecto GCP, el dataset y la cuenta de servicio, y validar en producción. | Proyecto GCP con facturación. |
| Búsqueda a gran escala (Elasticsearch) | La búsqueda por RUT con cruces ya funciona sobre PostgreSQL (`pg_trgm`, endpoint `/api/admin/buscar`). Migrar el backend de búsqueda a Elasticsearch/OpenSearch recién cuando el volumen lo exija — la API y el frontend no cambian. | Volumen de datos que lo justifique. |
| API para mineras mandantes v2 | **Hecho: permisos finos + webhooks.** Tabla `mandante_proveedores` (lista blanca opcional por RUT proveedor, gestionable desde "Accesos externos → Gestionar"; sin filas = comportamiento actual sin cambios) y `mandantes.webhook_url` (notifica POST no bloqueante en cada sesión nueva, con bloqueo básico de URLs internas/localhost). Falta: portal del mandante (login propio, UI dedicada) — se mantiene fuera de alcance hasta tener feedback real de mandantes usando la v1/v2, tal como ya advertía este ítem. | Feedback de mandantes reales usando la v1/v2 antes de construir el portal. |
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
