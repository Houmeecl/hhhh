# Panel ASG — qué es y qué no es, para sicr3p

> Documento de alcance. Se escribió antes de tocar código, porque «traer el
> repo `asg` a sicr3p» sonaba a construir un panel nuevo y resulta que un
> tercio ya está construido con otro nombre. Mismo motivo que
> `CORREDOR-ALCANCE.md`: fijar qué es algo antes de gastar en ello.
>
> Estado: **nada de esto está implementado.** Es un documento de decisión,
> no un inventario. Ninguna afirmación de acá se puede citar como si el
> sistema ya lo hiciera.

## La definición, en una línea

**El panel ASG no es un producto nuevo: es el expediente que ya existe,
sabiendo a qué área de práctica pertenece.**

`Houmeecl/asg` nombra tres áreas —aseguramiento de sostenibilidad,
contabilidad forense y cumplimiento del Modelo de Prevención de Delitos de
la Ley 21.595—. La estructura que las tres necesitan —abrir un expediente
por contrato y período, meterle documentos sellados con hash, medir cuánto
falta y no pintar de verde lo que no se puede comparar— **ya está
construida** en `migrations/105_expedientes.sql` y `services/expediente.js`.

Lo que falta no es la estructura. Es el resto de las áreas.

---

## 1. Las tres áreas y su estado real

| Área | Qué hay hoy | Se comprueba con |
|---|---|---|
| **Aseguramiento de sostenibilidad** | Construido. Expedientes con cobertura documental, roles esperados por tipo, semáforo, PDF de evidencia, Alcance 1/2/3, y `activos` (109) colgando de ahí | `ls backend/src/services/expediente.js` |
| **Contabilidad forense** | Piezas sueltas, ningún producto: cruces de `analisisSii`, rechazo de duplicados (104), cadena de hash. No existe el concepto de *caso* | `grep -rn "forense" backend/src/` → solo un comentario en `retencion.js` |
| **Cumplimiento MPD (Ley 21.595)** | **Nada.** Ni una línea | `grep -rn "21.595" backend/` → 0 resultados |

No hay que creerle a esta tabla: los tres comandos están para correrlos.

---

## 2. El problema que hay que resolver primero

`expedientes.tipo` es `suministro / servicio / transporte / arriendo / otro`
(105:74). Eso es **el tipo de relación comercial, no el área de práctica**.

No hay columna, tabla ni servicio que sepa si un expediente es de
aseguramiento, de forense o de cumplimiento. Y sin embargo:

- `landing.hero2_sub` —**vivo hoy** en `/plataforma`, `Landing.jsx:173`—
  ofrece las tres áreas por su nombre.
- `Lanzamiento.jsx:84` va más lejos y dice que *«el expediente se abre por
  área y por período fiscal»*. El expediente se abre por período, sí. Por
  área, no: la base no tiene dónde guardarla.

Eso segundo es una afirmación sobre cómo funciona el producto, y es falsa.
**Atenuante:** `Lanzamiento.jsx` hoy no se sirve —la cuenta regresiva venció
y `App.jsx:105` manda a `Programa`—, así que es código muerto, no una
mentira a la vista. Deja de serlo el día que alguien reuse ese texto.

La primera decisión, entonces, no es de arquitectura: es **si se agrega
`expedientes.area`**. Sin eso, cualquier panel ASG tiene que inventarse
dónde vive la distinción, y ahí empieza la duplicación.

---

## 3. La decisión de fondo: área en el expediente, no panel con base propia

La tentación es traer el repo `asg` completo, con su servidor y su base.
Eso duplicaría `expedientes` — el mismo error que la migración 109 evitó a
propósito cuando decidió que un activo **no** tuviera evidencia propia:

> *Habría sido duplicar `expedientes` y `expediente_documentos` —que ya
> modelan contrato, período, documentos con hash y semáforo— y el día que
> las dos copias se separaran, el adhesivo pegado en la camioneta diría una
> cosa y la pantalla otra.*
> — `migrations/109_activos_piloto.sql`

Aplica igual, y peor: acá las dos copias no las vería un transportista, las
vería un auditor.

> **SUPERADO EL 01-09-2026.** Lo de abajo se escribió suponiendo que el
> panel viviría dentro de sicr3p. Se decidió que **corre local** (§6a), así
> que la tabla `expedientes` no está donde el panel corre y una columna
> `area` no lo resuelve. El razonamiento se deja porque sigue valiendo para
> los expedientes de sicr3p mismo, y porque explica qué riesgo se está
> aceptando a cambio.

**El camino que se recomendaba:** una columna `area` en `expedientes`, con
su CHECK, y construir lo que falta *dentro* del modelo que ya existe.

Consecuencia que hay que aceptar: eso **no da un panel nuevo**. Da pestañas
nuevas en el panel del proveedor, que es donde vive `Expedientes.jsx`. Si
lo que se quiere es una marca separada con su propia puerta de entrada, eso
es una decisión comercial, no técnica, y se resuelve con un subdominio y un
shell —como hizo el Corredor— sin partir la base.

---

## 4. Qué se reusa, con nombre y archivo

| Necesidad | Ya existe |
|---|---|
| Expediente por contrato y período, con documentos sellados | `services/expediente.js`, `migrations/105_expedientes.sql` |
| Sellado y verificación | `services/cadenaHash.js` |
| Informe cifrado y entrega de su clave por canal separado | `services/entrega.js` |
| PDF de evidencia del expediente | `services/pdf.js` → `generateExpedienteEvidencia` |
| Permisos por sección | `middleware/auth.js` → `requireSeccion`, vocabulario en `constants/seccionesAdmin.js` (**ojo:** ver §6) |
| Shell de panel con login propio | `frontend/src/panel-corredor/CorredorApp.jsx` |
| Semáforo que no miente | `semaforoExpediente` — verde solo si hay con qué comparar y comparó |

---

## 5. Qué habría que construir de verdad

Separando lo que es una columna de lo que es un producto.

### Forense — es un producto, no una vista

Falta el concepto de **caso**: alcance acordado, hipótesis, hallazgos con
su evidencia, y cadena de custodia. Un caso forense no es un expediente con
otra etiqueta:

- El expediente pregunta *«¿está completa la evidencia de este contrato?»*.
- El caso pregunta *«¿qué pasó, y con qué lo demuestro?»*.

El segundo necesita registrar **quién tocó qué y cuándo**, con un rigor que
el expediente no exige. Ese es el trabajo real, y es grande.

### Cumplimiento MPD — falta todo, y además hay un límite duro

No hay nada. Y antes de escribir la primera línea:

**sicr3p no certifica el MPD.** El convenio del programa lo declara
expresamente, y el resto del producto ya se sostiene sobre esa misma
frontera (`landing.verif_sub`: *«sicr3p no certifica ni reemplaza a un
verificador acreditado»*). Un panel de cumplimiento que muestre un semáforo
verde junto a las palabras «Modelo de Prevención de Delitos» va a leerse
como certificación aunque el texto chico diga lo contrario — es
exactamente el motivo por el que el adhesivo del activo **no tiene rojo**.

Si esta área se construye, su salida tiene que ser *«esta evidencia está
reunida»*, nunca *«este modelo cumple»*.

---

## 6. La decisión de arquitectura, y lo que queda abierto

**a) ES LOCAL. Decidido el 01-09-2026.**

`Lanzamiento.jsx:88` describe al producto `asg` con una base local y un
modelo de lenguaje corriendo en la misma máquina: *«los datos no salen del
equipo»*. sicr3p es lo contrario —PostgreSQL en un VPS, correo saliente,
BigQuery— así que meter el panel adentro habría vuelto falsa esa frase.

**Se mantiene la promesa: el panel ASG corre local.**

Y hay que decir lo que eso cuesta, porque **invalida la recomendación de
§3**. Ese apartado proponía una columna `area` en `expedientes` para no
duplicar el modelo. Con el panel corriendo en la máquina del auditor, esa
tabla no está ahí: son dos despliegues distintos sobre datos distintos.

Lo que en §3 era duplicación accidental pasa a ser **separación
deliberada**, y el riesgo cambia de forma. Ya no es que dos copias digan
cosas distintas del mismo dato —no comparten datos—, sino que las dos
implementaciones del mismo concepto se separen con el tiempo. La defensa no
es una tabla común: es **compartir el código como biblioteca, no como
servicio**. Los candidatos concretos, todos puros y sin base:

| Se comparte | Archivo | Por qué se puede |
|---|---|---|
| El sellado y la verificación | `services/cadenaHash.js` | No toca la base: recibe datos, devuelve hashes |
| La cobertura documental y el semáforo | `services/expediente.js` | Ya es puro; la consulta vive en la ruta, no acá |
| El descargo y el formato del informe | `services/pdf.js` | Recibe todo por parámetro |

Si el panel local reimplementa el semáforo por su cuenta, el día que
cambie la regla del verde habrá dos reglas. Eso es lo que hay que vigilar,
no la tabla.

**Lo que la decisión resuelve gratis:** el panel local no depende del VPS.
El 01-09 el nodo NOVA001 de DonWeb se cayó y con él el sitio y el correo;
un producto que corre en la máquina del auditor no se entera. Para una
herramienta de aseguramiento eso no es un detalle operativo, es parte de lo
que se vende.

**Lo que la decisión NO resuelve, y empeora:** `landing.hero2_sub` está
vivo en `/plataforma` —la landing de sicr3p— ofreciendo las tres áreas. Si
esas áreas viven en un producto local aparte, **sicr3p está vendiendo algo
que sicr3p no hace**. El pendiente 2.6 sigue abierto y ahora pesa más: hay
que decidir si esa landing habla de sicr3p o del conjunto de productos.

**b) La sección 26 no es gratis.** Agregar `activos` (110) destapó que tres
migraciones re-imponían el CHECK de `secciones_admin` con listas viejas, y
que marcar una casilla en el panel podía dejar el servidor sin arrancar.
Ya está arreglado y hay un test que lo impide, pero la lección queda: cada
área nueva que pida su propia sección toca **tres espejos** —el backend,
el frontend y el CHECK de la base—. Conviene decidir si las tres áreas son
tres secciones o una sola.

---

## 7. Lo que NO se promete

El README de `asg` nombra cosas que no existen. Ya está anotado en
`Lanzamiento.jsx:69-74` y se repite acá para que nadie planifique sobre
ello:

- **Estrés hídrico bajo TNFD**
- **Detección de greenwashing**
- **Integración con SICEP**
- **The Copper Mark** — hay un badge en `PasaporteLote.jsx:74`, pero muestra
  un estado que alguien cargó a mano; no hay integración con nadie.

No hay tabla, endpoint ni servicio detrás de ninguna. Una landing que las
anuncie es el mismo verde falso que este producto existe para no emitir,
solo que apuntando al cliente en vez de al auditor.

---

## 8. Seguros

Se preguntó por seguros e insurtech. No estaban en el proyecto —salvo
menciones sueltas— pero al mirar de cerca aparecen **tres hilos distintos**
que conviene no confundir. Uno de ellos ya existe y está a medio cerrar.

| Hilo | Qué es | Estado |
|---|---|---|
| 1 · El seguro del vehículo del auspiciador | Deuda abierta en un contrato que se firma | **Sin resolver** |
| 2 · El seguro como destinatario de la evidencia | La idea que sí tiene fundamento | Idea |
| 3 · sicr3p intermediando pólizas | Actividad regulada | **Descartado** — ver *Decidido que no* |

### 8.1 El seguro del auspiciador: hay una decisión sin tomar

`services/contrato.js:594` ya trae una cláusula **«Seguro y siniestros»** en
el comodato:

> *El vehículo mantendrá SOAP, seguro obligatorio aplicable y póliza de
> daños, robo, responsabilidad civil y asistencia `[•]`. El deducible será
> de cargo de `[•]`, salvo siniestro imputable a la otra Parte.*

Esos `[•]` son el marcador de pendiente (`contrato.js:111`). Traducido:
**no está decidido quién paga el deducible si chocan la camioneta donada.**
No es una idea de producto ni algo que se resuelva programando; es una
decisión comercial que bloquea firmar un comodato. Queda como pendiente 2.7.

### 8.2 El seguro como destinatario: el puente es la forense, no el aseguramiento

Un expediente sellado de un activo —con período declarado, cobertura
documental y cadena de hash— es justo lo que una aseguradora usa para
**tarificar una flota** o para **resolver un siniestro**. Y el adhesivo del
activo es un identificador verificable pegado al móvil.

La conexión natural **no** es con el área de aseguramiento. Es con la
**forense**: investigar un siniestro *es* contabilidad forense, y lo que un
peritaje necesita —quién tocó qué documento y cuándo, sin poder alterarlo
después— es exactamente lo que `services/cadenaHash.js` ya hace. Dicho de
otro modo: **la aseguradora es el primer cliente realista del área que hoy
no existe** (§1), y eso refuerza el orden propuesto en §5, no lo cambia.

El encuadre tampoco hay que inventarlo. El producto ya declara su límite
frente a terceros que deciden (`prog.piloto_limite`):

> *No garantiza aprobación de crédito, leasing ni clasificación sostenible
> por un tercero. Entrega evidencia profesional para que cada tercero
> aplique sus propios criterios.*

Basta sumar el seguro a esa lista de terceros. La frase sigue siendo cierta
y la promesa no crece.

### 8.3 Intermediar pólizas: eso es una licencia, no una decisión de producto

Si «corredor ASG» llegara a significar intermediar seguros, en Chile eso es
**actividad regulada**: los corredores de seguros deben estar inscritos en
el registro que lleva la CMF, bajo el marco del DFL 251.

> **SIN VERIFICAR.** Esa afirmación normativa **no está contrastada contra
> su texto oficial** y por lo tanto no se puede citar como si lo estuviera
> —es exactamente el error que `PENDIENTES.md §1` existe para no repetir—.
> Antes de que cualquier material comercial mencione intermediación, hay
> que sellar la fuente. Estado de las fuentes:
> `cd backend && npm run fuentes`. Queda como pendiente 1.4.

Lo que sí se puede afirmar sin fuente, porque es una regla propia y no una
norma: **sicr3p no intermedia seguros hoy, y nada en el producto debe
insinuar que lo hace.**

---

## Decidido que no

- **Traer el repo `asg` con su propia base.** Duplica `expedientes` y el
  día que las copias se separen, dos pantallas dirán cosas distintas sobre
  la misma empresa. `01-09-2026`.

- **Un panel «ASG» que sea las tres áreas juntas sin distinguirlas.** Es lo
  que hay hoy —un expediente que no sabe de qué área es— y renombrarlo no
  agrega nada. Si no se agrega `area`, no hay panel ASG: hay un cartel.
  `01-09-2026`.

- **sicr3p como corredor de seguros.** Intermediar pólizas exige registro
  ante la CMF (§8.3, sin verificar). Mientras no exista ese registro, no se
  nombra ni se insinúa en ninguna pantalla, propuesta ni landing. Es del
  mismo tipo que «no certificamos el MPD»: un límite que se declara antes
  de que alguien construya hacia él. `01-09-2026`.

- **«Seguros» como cuarta área de práctica.** No lo es. Aseguramiento,
  forense y cumplimiento son cosas que sicr3p **hace**; el seguro es alguien
  que **usa** el resultado. Ponerlo como área confundiría a quien construye
  y a quien compra. `01-09-2026`.

---

## Lo que sigue, si se decide avanzar

En este orden, y ninguno depende de tener el repo `asg` a mano:

1. Decidir si `expedientes.area` va. Es la bifurcación; todo lo demás
   cuelga de ahí.
2. Resolver la contradicción del §6a, que es de posicionamiento y no de
   código.
3. Recién entonces, diseñar el **caso** forense — que es el trabajo grande
   y el único que justifica hablar de un producto nuevo.

Mientras tanto, el desajuste del §2 conviene cerrarlo igual: o la base
aprende de áreas, o el copy deja de prometerlas.
