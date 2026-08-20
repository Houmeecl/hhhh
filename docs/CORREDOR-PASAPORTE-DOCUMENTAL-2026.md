# SICR3P Corredor Bioceánico — Pasaporte documental 2026

## Decisión de producto

SICR3P deja de calcular carbono, REP, CBAM o Scope 3 durante el trayecto Brasil → Paraguay → Argentina. Antes del ingreso a Chile el producto es un **Pasaporte Documental Sellado con Trazabilidad**.

Los módulos ambientales/regulatorios se evalúan recién en **Aduana Verde / Chile**, y solo se activan cuando el importador, puerto, producto, destino o normativa aplicable los exigen.

## Regla base

- Un viaje = un Pasaporte maestro.
- Un conductor = una Credencial de viaje activada por PIN.
- Un control de frontera = un evento nuevo dentro del mismo Pasaporte.
- Un documento nuevo/intervenido = evidencia nueva dentro del evento.
- No se crea un QR nuevo por frontera.
- No se crea un Pasaporte nuevo por simple tránsito.
- Una nueva carga comercial independiente sí crea un Pasaporte vinculado.
- Un cambio parcial de composición crea lote/sub-lote vinculado, sin borrar la historia anterior.

## Roles

### Exportador

1. La empresa y sus usuarios existen desde la contratación.
2. Crea la operación.
3. Carga los documentos de origen.
4. Define conductor, transportista, camión y remolque.
5. Corrige inconsistencias documentales cuando SICR3P las detecta.
6. Envía el expediente a trazabilidad.

### Motor SICR3P

1. Identifica documentos.
2. Extrae campos estructurados.
3. Relaciona documentos entre sí.
4. Detecta inconsistencias.
5. Conserva original + representación de evidencia cuando corresponda.
6. Calcula hash de cada evidencia.
7. Constituye el manifiesto del expediente.
8. Genera el Pasaporte y la Credencial.

### Gestor SICR3P

- Revisa que la operación esté lista.
- No modifica datos ni documentos aportados por el exportador.
- Acción principal: **TRAZAR**.
- TRAZAR constituye el Pasaporte sobre la versión documental congelada.

### Conductor

- Activa una única Credencial de viaje.
- Crea su PIN.
- En Brasil, al iniciar viaje, no vuelve a fotografiar documentos de origen.
- En Paraguay y Argentina fotografía o adjunta solo evidencia nueva/intervenida cuando exista.
- En cada hito aporta odómetro, ubicación del dispositivo y PIN.

## Estados

`BORRADOR → DOCUMENTACIÓN ENVIADA → LISTO PARA TRAZAR → PASAPORTE SELLADO → CREDENCIAL PENDIENTE → EN TRÁNSITO → INGRESO CHILE → ADUANA VERDE → CERRADO`

## Brasil

### Documentos base de origen

El expediente base puede incorporar, según disponibilidad y operación:

- Commercial Invoice / Fatura Comercial.
- NF-e XML + DANFE.
- DU-E / representación o referencia oficial disponible.
- CRT.
- MIC/DTA cuando ya se encuentre disponible en ese momento.
- Packing List.
- Certificados/permisos condicionados cuando apliquen.

### Inicio de viaje

`Credencial → PIN → INICIAR VIAJE → foto odómetro → ubicación → fecha/hora servidor → SELLAR SALIDA BRASIL`

El primer evento operativo es **SALIDA BRASIL**.

## Paraguay

Paraguay no crea un Pasaporte nuevo. Se agregan eventos PY al Pasaporte maestro.

Evidencias relevantes pueden incluir:

- MIC/DTA electrónico / representación disponible.
- Registro/identificador SINTIA/RUT cuando corresponda.
- Comprobante o acta de intervención/control cuando exista.
- Permisos sectoriales cuando apliquen.

Flujo:

`Credencial existente → PIN → registrar ingreso → odómetro → ubicación → foto/subida de evidencia nueva → SELLAR PY-01`

Si luego se obtiene un PDF oficial de mayor calidad, se incorpora como evidencia adicional al mismo evento; la foto anterior no se elimina.

## Argentina

Argentina tampoco crea un Pasaporte nuevo por simple tránsito.

Evidencias relevantes pueden incluir:

- MIC/DTA electrónico.
- Registro/evento SINTIA.
- Confirmación de salida TAI.
- Precinto/control aduanero si se entrega constancia.
- Acta/comprobante de intervención.
- Permisos sectoriales cuando apliquen.

Flujo:

`Credencial existente → PIN → ingreso Argentina → odómetro → ubicación → evidencia nueva/intervenida → SELLAR AR-01`

## Chile / Aduana Verde

No se implementa en esta etapa. Al ingreso a Chile se evaluará operación por operación:

- importador,
- puerto,
- producto,
- mercado de destino,
- normativa aplicable.

Solo allí se activarán, si corresponden, REP, carbono, CBAM, Scope 3 u otros módulos.

## Reutilización de artefactos existentes

### Reutilizar y adaptar

- `08-expediente-lote.pdf`: base visual para el Pasaporte maestro. Mantener folio, estado, QR, cadena de custodia y sello de integridad; retirar emisiones incorporadas, OECD, CBAM y ESPR de la etapa pre-Chile.
- `09-credencial-tarjeta.pdf`: base visual para la Credencial del conductor. Mantener QR único del viaje; reemplazar la lógica de “clave entregada por separado” por activación inicial y creación de PIN por el conductor.
- `12-sello.svg`: reutilizable como recurso de integridad visual.

### Postergar a Chile / Aduana Verde

- `07-carpeta-mandante.pdf`.
- `11-reporte-cbam.pdf`.
- `13-export-alcance3.csv`.
- `14-export-alcance3.json`.
- `15-export-cbam.csv`.

### No usar en el flujo de corredor actual sin rediseño

- `10-credencial-proveedor.pdf`: no corresponde a la identidad operativa del conductor del corredor.
- `03-etiqueta-factura.pdf`: contiene resultado de CO2e y REP; debe convertirse en etiqueta de evidencia documental si se reutiliza.

## Brecha técnica actual del repositorio

El cliente actual `frontend/src/panel-corredor/api.js` documenta que, al sellar documentos, el archivo se envía solo para calcular SHA-256 y **no se conserva**. Esto contradice el flujo definido aquí, que requiere almacenar la evidencia original o su representación persistente.

Antes de poner este flujo en producción hay que cambiar ese contrato técnico a:

`archivo original → almacenamiento persistente → metadata → SHA-256 → relación con operación/evento → control de acceso`

No basta con conservar únicamente el hash.

## Navegación objetivo

Exportador:

- Operaciones
- Documentos
- Pasaporte
- Credencial

Gestor:

- Empresas
- Por trazar
- Pasaportes
- Credenciales

Conductor:

- Activar credencial
- Iniciar viaje
- Registrar hito
- Ver último hito verificable

Torre de Control no forma parte de Brasil/Paraguay/Argentina en esta etapa de diseño.
