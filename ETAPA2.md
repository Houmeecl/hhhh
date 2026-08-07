# ETAPA 2 — Backlog (fuera del alcance de la Etapa 1)

Este documento registra las ideas y funcionalidades **explícitamente excluidas** de la
Etapa 1, y el estado de las que ya se implementaron. Lo que sigue pendiente y requiere
servicios externos pasa a **ETAPA3.md**.

| # | Funcionalidad | Estado |
|---|---------------|--------|
| 1 | Conexión SII / RCV | ✅ **Implementado** — la empresa conecta su RUT/clave tributaria desde su propio panel (`panel-proveedor/AnalisisSii.jsx`) vía proveedor intercambiable BaseAPI/SimpleAPI/apigateway.cl (`services/siiProveedor.js`); la clave solo se persiste **cifrada (AES-256-GCM)** y solo si la empresa opta por guardarla (con opción de borrarla), nunca en texto plano ni en logs. **Acceso gatillado por contrato**: el SII de la empresa queda bloqueado (`requireContratoVigente`, `routes/origen.js`) hasta que sicr3p le emite su contrato — antes de eso su panel muestra "Cuenta en revisión". Detalle en ETAPA3.md → "Conexión SII / RCV". |
| 2 | Informes mensuales acumulativos | ✅ **Implementado** — panel admin → Trazabilidad → "Informe mensual" (`GET /api/admin/informes/mensual[.pdf]`). |
| 3 | Trazabilidad en cadena comprador–vendedor | ✅ **Implementado** — panel admin → Trazabilidad → "Cadena de valor" (aguas arriba/abajo por `rut_emisor`/`rut_receptor`). |
| 4 | Valorización de inventario con carbono (FIFO/PMP) | ✅ **Implementado** — panel admin → Trazabilidad → "Valorización". Entradas automáticas desde DTE XML (precio real por ítem, CO2e repartido por monto); FIFO y PMP en CLP + CO2e. |
| 5 | Módulo transporte de personal minero (Cat. 7) | ✅ **Implementado** — panel admin → "Transporte Cat. 7": modos con factor editable (kgCO2e/pasajero-km) y viajes que cargan la cuenta de carbono del Capital Natural. |
| 6 | Verificador de XML DTE | ✅ **Implementado (verificación local)** — parser sin dependencias (`services/dte.js`): estructura, módulo 11, consistencia de totales y presencia de firma. La validación criptográfica de la firma y el estado en el SII quedan para Etapa 3. Además, los XML subidos al flujo público usan folio y RUT **reales** del DTE. |
| 7 | Integración BigQuery | ⏭ Etapa 3. |
| 8 | Motor de cálculo propio | ⏭ Etapa 3. |
| 9 | Benchmarking sectorial | ⏭ Etapa 3 (requiere masa de datos de clientes reales). |
| 10 | API para mineras mandantes | ✅ **Implementado** — `/api/mandante/*` con API key (`X-Api-Key`, hash SHA-256, se muestra una sola vez); el mandante consulta sus proveedores y el resumen CO2e de cada uno. Administración en panel → "Accesos externos". |
| 11 | Auto-registro de clientes | ⏭ Etapa 3 (decisión comercial). El acceso de clientes ya existe vía **magic link** y el ingreso de prueba vía **códigos con créditos** (`/prueba`, 1 crédito = 1 factura). |

## Módulo Capital Natural (agregado sobre la Etapa 1)

Contabilidad de capital natural con modelo **SEEA simplificado**: plan de cuentas
ambiental (AGUA/ENER/CO2E/MATR activas; SUEL/BIOD como stock), movimientos automáticos
derivados de cada documento procesado (con traza a la factura), activos naturales con
condición y valorización CLP manual, y el informe **"Estado de Capital Natural"** (folio
`N-AAAA-NNNN`). Ver README → "Capital Natural".

## Nota sobre la edición portátil (candado SII)

La **edición portátil** (`portable/`) usa el **RUT + clave SII como candado local** del
dispositivo: las credenciales se guardan **cifradas** y se **verifican offline**. Esto **no**
es la integración con el SII del ítem 1 — **no se contacta al SII**. La ingesta automática
desde el SII/RCV y la cuadratura siguen siendo Etapa 2.

Empaque futuro de la edición portátil (pendiente, opcional): ejecutable único (`.exe` con
`pkg`/`nexe`) y app de escritorio (Electron). Hoy corre como carpeta portátil con Node.

## Documentos aduaneros del Corredor (decisión de alcance)

- **Aduana real de cada país: SÍ** — las declaraciones aduaneras (DIN/DUS Chile, SIM
  Argentina, SOFIA Paraguay, DU-E/DI Siscomex Brasil) y el **MIC/DTA** (tránsito terrestre
  del Acuerdo ATIT) se cargan al Corredor como **traza documental** con su número de
  documento. No calculan carbono: documentan el tránsito.
- **"Aduana verde" (certificación ambiental aduanera): NO** — explícitamente excluida
  del alcance por decisión del negocio. No se construye en ninguna etapa planificada.
- La **conexión en línea** a los sistemas aduaneros (validar una DIN contra la Aduana,
  estados de despacho) queda para Etapa 3, junto con SII/RCV.

## Módulo Corredor Bioceánico (evolución futura)

El módulo "Corredor Bioceánico" (panel admin) hoy usa **Simple + traza documental** y
**metodología por país editable** (CL/AR/PY/BR con toggle de activación). Queda para
Etapa 2, sobre esta base:

- **OCR propio** de documentos que Simple no lee (guías, manifiestos, contratos) — hoy se
  guardan como traza; el carbono queda "pendiente de motor".
- **Verificador XML DTE** (facturas electrónicas chilenas) y equivalentes AR/PY/BR.
- **Conexión a fuentes oficiales** de factores por país (validar los borradores AR/PY/BR).
- **Cadena transfronteriza comprador-vendedor** real usando `rut_emisor`/`rut_receptor`.

## Backlog técnico (mejoras diferidas, con justificación)

- **Empaque .exe / binario del portátil** (`pkg`/`nexe`): la edición portátil usa el SQLite
  integrado `node:sqlite`, que los empaquetadores actuales aún no soportan bien; se prefirió
  no shippear un binario sin probar. Alternativa futura: Electron o esperar soporte de `pkg`.
- **Cifrado total de la base del portátil en reposo**: hoy la clave SII está cifrada y el
  acceso está protegido por el candado; cifrar toda la base requiere ciclo lock/unlock o
  SQLCipher (módulo nativo), con riesgo de corrupción. Se deja como endurecimiento futuro.
- **Responsividad móvil fina + accesibilidad (WCAG)**: pase dedicado de a11y (teclado, aria,
  contraste) y ajustes móviles del panel admin.

## Notas de preparación ya incluidas en Etapa 1

- Los campos `rut_emisor` y `rut_receptor` **se guardan en cada factura** para habilitar
  la trazabilidad comprador–vendedor (ítem 3) en el futuro, sin construir esa feature ahora.
- La tabla `simple_api_uso` registra consumo/latencia/costo, base para métricas de un
  eventual motor propio (ítem 8) y control de costos del motor externo.
