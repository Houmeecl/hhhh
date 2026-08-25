# Repertorio de documentos

Una muestra de **cada documento que la plataforma genera**. No son maquetas:
salen del mismo código que corre en producción (`backend/src/services/pdf.js`,
`sello.js`, `csv.js`), sobre una sesión sembrada con una cadena de hash real.

Sirven para tres cosas: mostrar sin levantar el sistema, revisar un cambio de
diseño con el antes y el después a la vista, y detectar regresiones que los
tests no ven — un PDF que no lanza excepción puede igual salir con `undefined`
en una columna.

## Para tu empresa

| Archivo | Qué es |
|---|---|
| `01-informe-consolidado.pdf` | El libro mayor de carbono del trámite: cada factura con sus ítems, el método usado (físico o por gasto), el hash y eslabón de cada documento, y el estado de la cadena completa. Incluye la declaración REP de embalaje. |
| `02-informe-mensual.pdf` | El mismo informe consolidado por período en vez de por trámite. |
| `03-etiqueta-factura.pdf` | Etiqueta imprimible con QR: escaneada, lleva a la página pública de verificación. |
| `04-capital-natural.pdf` | Estado de Capital Natural: cuentas ambientales con sus movimientos derivados de documentos reales, activos naturales y sello de integridad por cuenta. |

## Para tu mandante o comprador

| Archivo | Qué es |
|---|---|
| `07-carpeta-mandante.pdf` | Un solo PDF de evidencia por trámite: documento, cálculo, declaración REP, contrapartes relacionadas y verificación de integridad. |
| `13-export-alcance3.csv` · `14-export-alcance3.json` | Emisiones de proveedores en formato listo para consolidar en un reporte corporativo (contexto ISSB / NCG 461). El CSV lleva BOM para que Excel abra bien las tildes. |
| `11-reporte-cbam.pdf` · `15-export-cbam.csv` | Estado CBAM de los lotes: código NC, aplicabilidad, método de emisiones y datos faltantes. |

## Trazabilidad

| Archivo | Qué es |
|---|---|
| `08-expediente-lote.pdf` | Cadena de custodia completa del lote. **El cuarto eslabón está marcado como reservado a propósito**: muestra la divulgación selectiva — el actor no aparece, y su eslabón sigue sellado y verificable. |
| `09-credencial-tarjeta.pdf` | Credencial imprimible por camión, con serial y QR. |
| `10-credencial-proveedor.pdf` | Credencial de atestación de un solo uso para un actor externo. |

## Otros

| Archivo | Qué es |
|---|---|
| `05-contrato-asesoria.pdf` | Contrato emitido desde el paquete legal, con los puntos pendientes marcados. |
| `06-constancia-curso.pdf` | Constancia de capacitación interna con serial verificable. |
| `12-sello.svg` | Sello embebible en el sitio del cliente. |
| `16-adhesivo-contrastado.pdf` | Adhesivo del activo — verde. |
| `17-adhesivo-falta-evidencia.pdf` | Adhesivo del activo — ámbar. |
| `18-adhesivo-sin-comparacion.pdf` | Adhesivo del activo — gris. |

Los tres adhesivos van juntos a propósito. Es la pieza más expuesta del
producto —la ve gente que no entró a ninguna pantalla, a tres metros y con
sol de frente— y el error caro no es que el verde salga feo: es que el gris
se lea como rojo. Eso solo se ve comparándolos.

## Regenerar

```bash
# Requiere una base con las migraciones aplicadas.
DATABASE_URL=postgres://... node docs/muestras/generar.mjs
```

El script siembra la sesión pasando por los mismos helpers que el flujo real
(`hashDocumento`, `hashCadena`, `cadena_estado`), así que el sello de
integridad del informe dice **íntegra** porque de verdad lo es. Si sale
«ALTERADA», la semilla se saltó el cierre de la cadena global.

**Correr esto después de tocar `pdf.js` no es opcional.** Estas muestras no
se regeneran solas: quedan congeladas en el commit que las creó y envejecen
en silencio. Al 25-08 llevaban atrás lo suficiente como para que el reporte
CBAM saliera **sin su bloque de límites y sin el descargo de ISO 14064-3**, y
el Estado de Capital Natural sin el descargo — cosas que el producto sí
imprime hoy. Una muestra vieja es peor que no tenerla: se lee como si fuera
lo que el sistema emite.

## Lo que estas muestras no son

Datos ficticios de empresas que no existen. Ningún RUT, monto ni lote de acá
corresponde a un cliente real, y los factores de emisión son los que trae el
motor por defecto. Para ver documentos con datos reales hay que generarlos
desde el panel.
