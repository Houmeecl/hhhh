# Corredor Bioceánico — qué es y qué no es, para sicr3p

> Documento de alcance. Se escribió porque «Corredor Bioceánico» se estaba
> usando para dos cosas distintas —una ruta logística y un producto de
> sicr3p— y eso llevaba a construir de más.

## La definición, en una línea

**Para sicr3p, el Corredor es la evidencia que una carga necesita para
entrar a su mercado de destino.** La ruta importa en la medida en que
cambia esa evidencia. Nada más.

Los mercados europeos no piden esa evidencia por gusto: **o la entregas,
o pagas más, o directamente no entras.** Y los dos regímenes que aplican
castigan distinto, lo que cambia a qué se le da prioridad:

| Régimen | Qué pasa si falta | Urgencia |
|---|---|---|
| **EUDR** (UE 2023/1115) | El producto **no se puede comercializar** en la UE | No hay arancel que lo compense |
| **CBAM** (UE 2023/956) | El importador declara con **valores por defecto**, más caros | Es un problema de precio |
| **Exportación** | El comprador no puede usar el dato en su inventario | Lo va a pedir igual |

## Qué entra

| Entra | Por qué |
|---|---|
| Código arancelario de la mercadería | Decide **qué régimen** aplica. Sin él no se puede ni responder la pregunta |
| **Geolocalización de las parcelas** (EUDR) | Coordenadas de cada predio; polígono sobre 4 ha. Es el requisito que no se resuelve con papeles |
| Fecha de producción, libre de deforestación, legalidad (EUDR) | Los otros tres del art. 9 del Reglamento 2023/1115 |
| País de origen e **instalación** | CBAM pide la instalación, no el país nada más |
| Emisiones **directas** e **indirectas** por tonelada | Los dos números del informe CBAM |
| **Método** de determinación (reales / defecto / mixto) | Un número sin método no es declarable |
| Los documentos que respaldan cada uno de los anteriores | Sin respaldo es un dato declarado, y eso ya lo sabemos decir |
| El tramo, **solo** donde cambia la evidencia | Cruzar una frontera exige documentos distintos. El resto del recorrido es logística |

## Qué NO entra

- **La tramitación aduanera.** La hace la agencia de aduanas, que ya tiene
  su propio panel (`routes/agencia.js`) y su propia responsabilidad legal.
  Ahí está escrito, y sigue valiendo: *«sicr3p es su infraestructura
  documental/de trazabilidad — nunca se presenta como agencia de aduanas»*.
- **La operación de flota.** Dónde está el camión ahora es la Torre de
  Control, que ya existe y es otra cosa.
- **El despacho portuario.** Panel de puerto, ya existe.
- **Calcular las emisiones del comprador.** Misma línea que en el resto de
  sicr3p: se prepara la evidencia, no se hace la contabilidad ajena.

## Los dos datos incómodos que hay que decir de frente

### 1. CBAM no cubre el cobre ni el litio El Anexo I del Reglamento (UE)
2023/956 son cemento, electricidad, hidrógeno, fertilizantes, hierro/acero
y aluminio (`CAPITULOS_NC_CBAM` en `services/pasaporteOrigen.js:290`).

O sea que para la carga más típica del corredor chileno, `cbam.aplicable`
da **false** — y eso es correcto, no es un bug. Prometer un «pasaporte
CBAM» a un exportador de cátodos sería vender un trámite que no existe.

### 2. Al Corredor Bioceánico le aplica EUDR mucho más que CBAM

El Reglamento (UE) 2023/1115 alcanza **bovinos, cacao, café, palma,
caucho, soya y madera**. O sea: exactamente lo que ese corredor mueve —
soya y carne del Cono Sur hacia Europa y Asia.

Las dos listas no se tocan: CBAM es carga industrial, EUDR es
agrícola/forestal. Un pasaporte que solo sabe de CBAM no le sirve a la
carga más típica de la ruta.

Y EUDR pide algo que CBAM no: **las coordenadas de cada parcela donde se
produjo**. Eso no se resuelve con un campo de texto ni con un PDF
adjunto — es dato estructurado, y hoy no existe en el esquema.

### La consecuencia de diseño

El pasaporte tiene **tres regímenes y una cuarta respuesta**
(`services/exportacion.js`):

1. **EUDR** — código en el Anexo I de 2023/1115. Seis requisitos.
2. **CBAM** — código en el Anexo I de 2023/956. Cinco requisitos.
3. **Exportación** — ninguno de los dos. Lo que pide el comprador para su
   propio Alcance 3 o su DPP.
4. **Sin determinar** — no se declaró el código. **No cae a «exportación»
   por defecto**: una carga de soya sin código SÍ está bajo EUDR, y
   mostrarla como «solo exportación» la haría verse en regla justo donde
   no lo está. Es el mismo gris de `semaforoDocumental`: cuando no hay con
   qué decidir, no se opina.

Y cada requisito dice **quién lo aporta**. «Faltan las emisiones
indirectas» no sirve si el exportador no sabe que eso se le pide a la
generadora; «faltan las coordenadas» no sirve si no sabe que las tiene el
productor, no él.

## Quién trabaja en el panel

El **exportador**: la empresa cuya mercadería sale. Crea el pasaporte de su
carga, ve exactamente qué le falta para el régimen que le corresponde,
adjunta la evidencia y se lleva el informe.

No es el operador logístico (mueve, no declara), ni la agencia de aduanas
(tramita, y ya tiene panel), ni el mandante (compra, y ya recibe el export
CBAM por `routes/mandante.js`).

## Estado hoy — lo que ya está construido

- `services/exportacion.js` decide régimen y lista qué falta, con quién lo
  aporta y qué pasa si no llega. 25 tests.
- `resumenNormativo()` calcula la completitud CBAM y DPP de un lote.
- `filaCbamCsv()` aplana el lote a la fila del CSV.
- `generateReporteCbam()` genera el PDF.
- `GET /panel-mandante/export/cbam` y `.pdf` lo entregan **al comprador**.
- Los tres tipos de pasaporte (`mineral`, `producto`, `documental`) ya se
  validan distinto en el backend: `TIPOS`, `materialValido(tipo, …)`,
  `ROLES_POR_TIPO`.

## Estado hoy — lo que falta

- **El exportador no tiene panel.** El pasaporte se crea desde
  `/admin/origen`, el back-office minero, eligiendo «Documental (Corredor
  Bioceánico)» en un `<select>`.
- **El formulario de creación no pide lo que importa.** Ofrece el código NC
  como «(opcional)» y no pregunta emisiones ni método. Se crea un lote que
  nace incompleto y nada guía a completarlo.
- **Nada del EUDR tiene dónde guardarse.** Cuatro de sus seis requisitos
  —parcelas, fecha de producción, libre de deforestación, legalidad— no
  tienen columna. Aparecen como faltantes, que es honesto, pero todavía no
  se pueden completar. Es lo que toca la próxima migración.
- **El código del lote miente.** Toda carga sale como `LM-AAAA-NNNNNN`
  («LM» = Lote Mineral), incluida una carga documental del Corredor
  (`generarCodigoLote`, `pasaporteOrigen.js:391`).
- **El tramo no existe como dato.** Se declara un país de origen y los
  pasos se agregan a mano después; no hay origen→destino ni documentos
  exigidos por par de países.
