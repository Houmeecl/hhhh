# sicr3p Corredor — plan completo

> Requisitos, captura de datos y flujos end-to-end.
> Alcance y límites: `docs/CORREDOR-ALCANCE.md`. Lógica de regímenes:
> `backend/src/services/exportacion.js`.

---

## 1. Qué es

**La evidencia que una carga necesita para entrar a su mercado de destino.**

Tres regímenes y una cuarta respuesta, ya implementados:

| Régimen | Cuándo aplica | Si falta |
|---|---|---|
| **EUDR** (UE 2023/1115) | Bovinos, cacao, café, palma, caucho, soya, madera | **No se puede comercializar.** No hay arancel que lo compense |
| **CBAM** (UE 2023/956) | Cemento, electricidad, hidrógeno, fertilizantes, hierro/acero, aluminio | El importador declara con **valores por defecto**, más caros |
| **Exportación** | Ninguno de los dos | El comprador no puede usar el dato, y lo va a pedir igual |
| *Sin determinar* | No se declaró el código arancelario | **No se opina.** No cae a «exportación» por defecto |

Ese último renglón es la decisión que más pesa: una carga de soya sin código
declarado **sí** está bajo EUDR, y mostrarla como «solo exportación» la haría
verse en regla justo donde no lo está.

---

## 2. Superficie propia

Igual que el Instituto, que ya funciona así (`frontend/src/App.jsx:66`):

```js
const ES_SUBDOMINIO_CORREDOR = window.location.hostname.startsWith('corredor.');
```

| Pieza | Ruta | Estado |
|---|---|---|
| Landing | `corredor.sicr3p.cl` → `CorredorLanding.jsx` | **Existe** (241 líneas, i18n `cor.*`) |
| Login propio | `/panel-corredor/login` | Nuevo — molde de `PanelLogin.jsx`, compartido por los 7 paneles |
| Activación | `/panel-corredor/activar` | Nuevo — `RUTA_ACTIVAR` en `services/cuentas.js:27` |
| Panel | `/panel-corredor/*` | Nuevo — octavo shell |

### Bases separadas

`sicr3p_corredor` vive en el mismo servidor Postgres que `sicr3p`, pero es
**otra base**. Son productos distintos y sus datos no se mezclan.

Que sean dos bases y no dos esquemas es lo que hace que la separación no
dependa de nadie: **Postgres no puede hacer un JOIN entre bases distintas**.
Con un esquema aparte, `corredor.cargas JOIN public.facturas` compila
perfecto y la separación queda a merced de quien escriba la próxima
consulta. Con dos bases el motor la rechaza:

```
ERROR: cross-database references are not implemented
```

**Lo que eso implica al escribir código del Corredor:**

- No existen claves foráneas entre los dos mundos. El Corredor tiene sus
  propios `usuarios_corredor`, sus propias `cargas` y su propia cadena de
  hash.
- Secreto de JWT propio (`JWT_SECRET_CORREDOR`). Compartirlo haría que un
  token del Corredor verificara contra la app principal — lo rechazarían
  los guardias de panel, sí, pero el token sería estructuralmente válido.
- Si alguna vez hace falta cruzar los dos mundos, se hace **por RUT a nivel
  de aplicación** y se declara como cruce, nunca con una FK que no puede
  existir.

### El Corredor es opcional, y eso protege al resto

`index.js` mata el proceso ante cualquier error de arranque, y las
migraciones corren ahí adentro. Por eso `runMigrationsCorredor()`
**devuelve un estado en vez de lanzar**: que la base del Corredor no exista
todavía en el servidor, o que una migración suya falle, no puede dejar sin
backend a una empresa que solo usa la contabilidad de carbono.

| Situación | Qué pasa |
|---|---|
| Sin `DATABASE_URL_CORREDOR` | `[corredor] apagado en este entorno`. El backend arranca normal |
| Configurado y sano | `[corredor] base lista (N migraciones)` |
| Configurado y roto | Aviso fuerte, rutas del Corredor en **503**, el resto del backend intacto |

### Puesta en marcha en el servidor

```bash
sudo -u postgres createdb sicr3p_corredor
sudo -u postgres psql -c "ALTER DATABASE sicr3p_corredor OWNER TO sicr3p;"
# en backend/.env
DATABASE_URL_CORREDOR=postgresql://sicr3p:...@localhost:5432/sicr3p_corredor
JWT_SECRET_CORREDOR=<uno distinto del de sicr3p>
```

Las migraciones se aplican solas en el próximo arranque. **El respaldo hay
que ampliarlo**: el `pg_dump` actual apunta a `sicr3p` y no incluye la base
nueva.

### Lo que ya existía se queda donde está

Se empieza limpio. Las cargas que hoy viven en `lotes_minerales` con
`tipo = 'documental'` no se migran: mover una cadena de hash a otra base
obliga a resellarla, y resellar rompe la verificación o arrastra hashes que
ya no se pueden comprobar contra su origen. Dejan de crearse por ahí y
listo.

## 3. Requisitos, campo por campo

Leyenda: ✅ ya construido en la base del Corredor · ⚠️ parcial · ❌ pendiente.

Todo esto vive en `sicr3p_corredor`, no en `lotes_minerales`. La tabla del
otro lado sigue existiendo para minerales y productos; la carga del Corredor
es `cargas`, y es otra tabla en otra base.

### EUDR — Reglamento (UE) 2023/1115, art. 9

| Requisito | Quién lo aporta | Dónde vive |
|---|---|---|
| Código arancelario | Exportador | ✅ `cargas.codigo_nc` |
| País y región de producción | Exportador | ✅ `pais_origen` + `region_origen` |
| **Geolocalización de cada parcela** | Productor | ✅ tabla `parcelas`, con su nivel de confianza |
| Polígono si la parcela supera 4 ha | Productor | ✅ `parcelas.poligono` (GeoJSON) |
| Fecha o intervalo de producción | Productor | ✅ `carga_produccion.desde/hasta` |
| Libre de deforestación posterior al **31-12-2020** | Productor, con determinación de un tercero | ✅ con emisor, línea base y fecha |
| Legalidad en el país de producción | Productor | ⚠️ el flag sí; el documento se sella por tramo, pero nadie lo lee |
| Operador: nombre, dirección, EORI | Exportador | ✅ `exportadores.eori` |
| Cantidad | Exportador | ✅ `cargas.cantidad` + `unidad` |
| Proveedor y comprador de la operación | Exportador | ❌ pendiente |

**Ya tienen dónde guardarse.** Era el hueco más grande del plan original —
cuatro de los seis requisitos centrales del EUDR no tenían columna— y lo cierra
`migrations-corredor/002_corredor_cargas.sql`. Lo que falta ahora son las rutas
y la pantalla, no el modelo.

### CBAM — Reglamento (UE) 2023/956

| Requisito | Quién lo aporta | Dónde vive |
|---|---|---|
| Código NC | Exportador | ✅ `cargas.codigo_nc` |
| Instalación de origen | Exportador | ✅ `cargas.instalacion` |
| Emisiones directas (t CO₂e/t) | Operador de la instalación | ✅ |
| Emisiones indirectas (t CO₂e/t) | **Proveedor de electricidad** | ✅ |
| Método (reales / defecto / mixto) | Exportador | ✅ |

CBAM está completo en el esquema del Corredor. Lo que falta no es modelo: es
que el formulario lo pida en vez de ofrecerlo como «(opcional)».

### Exportación (cuando no aplica ninguno)

País de origen, instalación, composición declarada, actores de la cadena y
emisiones incorporadas. Todo ✅ — es el régimen que ya se puede completar.

---

## 4. Cómo se captura cada dato

El corazón del plan. **Casi nada hay que inventar**: los mecanismos existen.

### 4.0 Regla de seguridad: dos coordenadas distintas, y solo una es peligrosa

Esta regla manda sobre todo lo demás de esta sección.

La carga cruza **cuatro países** con niveles de seguridad muy distintos.
Un rastro en vivo de dónde va una carga valiosa es exactamente el mapa que
necesita quien la quiera interceptar. Así que hay que separar dos cosas que
suenan parecido y no lo son:

| | Qué es | Riesgo | Decisión |
|---|---|---|---|
| **Coordenada del predio** | Un campo fijo en Mato Grosso. Ya está en el catastro público (CAR). No dice nada de dónde va la carga | Bajo | **Se captura.** Sin ella no hay EUDR: es obligación del reglamento |
| **Posición del vehículo** | Dónde está la carga **ahora** | **Alto** | **No se captura. Nunca** |

**El sistema hoy ya cumple esto y conviene no romperlo.** `TorreFlota.jsx:150`
dibuja la carga en las coordenadas del **punto de control** —del catálogo
`PUNTOS_CORREDOR`, que son fijos y públicos—, no del camión. Hay un KPI
`sin_posicion` para las cargas sin hito reciente. En todo el corredor no hay
una sola llamada a `getCurrentPosition`: las únicas del repo están en el juego
de reciclaje, que es otro producto.

De ahí la regla, que vale para lo que se construya de acá en adelante:

> **Se registra el hito, no se sigue el móvil.**
> Un evento con marca de tiempo al pasar un punto de control conocido. Nunca
> un rastro continuo, nunca `watchPosition`, nunca un mapa de dónde está la
> carga en este momento.

Y una consecuencia menos obvia: **el hito también es información sensible**.
«Esta carga cruzó tal frontera hace veinte minutos» sirve para lo mismo que
un GPS si llega a quien no corresponde. Por eso el paso se muestra a quien
tiene la carga y a quien la espera, no a cualquiera con un enlace, y el
pasaporte público (`/lote/:codigo`) no lleva el hito más reciente.

### 4.1 La coordenada de una parcela — tres vías, sin poner a nadie en terreno

Con la regla anterior, **quedan fuera el GPS en el predio y el recorrido del
perímetro**. No es una pérdida: la vía que queda como principal es mejor.

Decisión de diseño que sostiene el resto:

> **La procedencia de una coordenada es un nivel de confianza, no un booleano.**

Y no se inventa una escala nueva: se reusa la de `services/expediente.js`
(1 declarado · 2 documentado · 3 consistente · 4 validado en fuente), que ya
tiene sus tests y la regla de quién otorga cada nivel.

| Vía | Cómo | Nivel | Cuándo |
|---|---|---|---|
| **Importar GeoJSON / KML** | Archivo del catastro oficial o del SIG del productor | **3 Consistente** si el polígono cierra y el área calza con la declarada | **La principal.** El CAR brasileño ya tiene el polígono de cada predio rural, cargado por su dueño |
| **Contrastar contra el registro público** | Cruce con el catastro | **4 Validado en fuente** | Exige `validado_por` + `validado_fuente` + `validado_at`, igual que en `datos_trazables` |
| **Dibujar en el mapa** | Leaflet, ya instalado | **1 Declarado** | Último recurso. La precisión la declara quien dibuja, nadie la mide |

Que la vía principal sea un archivo del catastro es mejor por tres razones, no
solo por seguridad: el polígono ya existe, ya lo declaró el dueño ante una
autoridad, y es más preciso que cualquier recorrido con un teléfono.

**Lo que sí se guarda siempre es de dónde salió la coordenada**
(`origen_coordenada`) y, cuando el archivo la trae, su precisión declarada.
Un polígono sin procedencia se ve igual que uno del catastro, y no lo es —
mismo error que `Number(null) === 0`: un dato que parece bueno porque se le
perdió el contexto.

**El nivel 5 no existe acá tampoco**, por la misma razón que en el expediente:
necesitaría un rol de auditor que no existe.

### 4.1.b Y el polígono también hay que cuidarlo

Un polígono de predio + la carga que salió de él + una fecha de embarque es,
junto, «de este campo sale una cosecha valiosa por estas fechas». El
reglamento exige entregar las coordenadas **en la Declaración de Diligencia
Debida ante la autoridad**, no publicarlas a cada contraparte.

Por eso el informe al comprador tiene que poder **acreditar que la parcela
está declarada y verificada sin necesariamente mostrar el polígono completo**
— que es exactamente el estado intermedio «solo acreditar existencia» que ya
estaba pensado para la divulgación selectiva.

### 4.2 Libre de deforestación — sicr3p NO lo determina

El límite más importante de todo el plan.

Determinar que un predio no fue deforestado después del 31-12-2020 exige
**análisis de imágenes satelitales** contra una línea base. sicr3p no hace eso
y no va a decir que lo hace.

Lo que sicr3p hace es **registrar la determinación que hizo otro**, con:

- quién la emitió,
- contra qué línea base (MapBiomas, JRC TMF, Global Forest Watch, informe de
  un consultor),
- en qué fecha,
- y el archivo, con su SHA-256 y su eslabón en la cadena — la misma
  maquinaria de `lote_documentos` que ya existe.

Es exactamente la doctrina de «el nivel 5 nunca se emite»: no se declara una
revisión que nadie hizo.

> **Ojo con la fecha.** El corte del 31-12-2020 aplica a la **deforestación
> del predio**, no a la fecha de producción. Son dos requisitos distintos del
> art. 9 y confundirlos daría por cumplido uno con el otro.

### 4.3 Fecha de producción

Intervalo `desde`/`hasta`, no fecha única: una cosecha es una ventana. El
formulario pide el rango y el backend valida que `desde ≤ hasta`.

### 4.4 Legalidad

Documentos: tenencia de la tierra, permiso ambiental, cumplimiento laboral y
tributario. **Se reusa `lote_documentos` tal cual** — ya trae `sha256`,
`hash_documento`, `hash_anterior`, `hash_cadena`, `estado` y la cola de
revisión. Se agregan tipos al catálogo `TIPO_DOCUMENTO_LABEL`, nada más.

### 4.5 Emisiones (CBAM)

| Dato | Vía |
|---|---|
| Directas | Formulario + documento del balance de la instalación |
| Indirectas | Formulario + factura o certificado del suministrador, **o** factor de red declarado con su fuente |
| Método | Selector de tres opciones, ya validado por CHECK |

El factor de red conecta con las **4 fuentes de factores** que están
pendientes de decisión aparte. Sin fuente declarada, el factor es nivel 1.

### 4.6 Los cruces de frontera

`puntos_corredor` (migración 093) ya tiene los puntos con `lat`, `lng`,
`pais`, `orden` y `es_frontera`. Lo que falta es **qué documento exige cada
par de países** (MIC/DTA, carta de porte, SAG según el par).

Captura en terreno: el QR del punto de control y la Tarjeta de Viaje ya
existen, **y ya funcionan sin señal** — `lib/pasoOffline.js` encola el paso y
lo reintenta. Eso importa por dos motivos: los pasos fronterizos son los
lugares con peor conectividad, y una cola local evita tener que mantener una
conexión abierta con el vehículo.

El escaneo registra **un hito en un punto conocido**, con su hora. No hay
coordenada del vehículo en ese registro, y no debe haberla: el punto de
control ya tiene las suyas en `puntos_corredor`, que son fijas y públicas.

---

## 5. Modelo de datos

Construido y probado. Vive en `backend/migrations-corredor/`, con numeración
propia desde `001` — no se mezcla con las migraciones de sicr3p.

### `001_corredor_init.sql` — identidad y acceso

| Tabla | Qué guarda |
|---|---|
| `exportadores` | La empresa cuya mercadería sale. Incluye el **EORI** que exige el EUDR |
| `usuarios_corredor` | Sus propios usuarios. No se puede apuntar a `sicr3p.usuarios`: es otra base |
| `tokens_password_corredor` | Activación y reset. Solo el SHA-256, nunca el token |
| `actividad_corredor` | Bitácora, **sin FK al usuario** — lo que alguien hizo tiene que constar aunque su cuenta se borre |

### `002_corredor_cargas.sql` — el pasaporte

| Tabla | Qué guarda |
|---|---|
| `puntos_corredor` | Copia propia del catálogo. Coordenadas fijas y públicas de aduanas y puertos |
| `parcelas` | El predio del EUDR, con `origen_coordenada`, `nivel_confianza` 1–4 y sus validadores |
| `cargas` | La carga: código `CB-`, código arancelario, cantidad, y los cinco datos de CBAM |
| `carga_parcelas` | De qué predios salió, con su aporte |
| `carga_produccion` | Fechas, libre de deforestación y legalidad — con **quién** hizo la determinación |
| `carga_tramo` | Origen y destino, del catálogo de puntos |
| `documentos_por_tramo` | Qué exige cada par de países |
| `carga_documentos` | Expediente con **cadena de hash propia** |
| `carga_pasos` | El hito: pasó por tal punto, a tal hora. **Sin latitud ni longitud** |

Tres restricciones que el esquema defiende por sí solo, y que tienen su test:

- **Una parcela sin ubicación no entra** (`parcelas_con_ubicacion`): o hay
  punto, o hay polígono. Aceptar ninguna dejaría filas que se ven completas
  y no ubican nada.
- **El nivel 4 exige quién, contra qué y cuándo**
  (`parcelas_nivel4_exige_validador`). Sin los tres, «validado en fuente» es
  una etiqueta que no se puede comprobar.
- **`carga_pasos` no tiene columna de posición**, y hay un test que falla si
  alguien le agrega `lat`, `lng`, `posicion` o `accuracy`.

Y `origen_coordenada` acepta `archivo | registro | mapa` — **sin `gps` ni
`perimetro`**, descartados por la regla de seguridad de §4.0.

### El código de la carga

`generarCodigoLote()` (`pasaporteOrigen.js:391`) devuelve `LM-AAAA-NNNNNN`
para todo — «LM» de Lote Mineral. Una carga de soya de Brasil sale
`LM-2026-000001`, lo cual está mal y ya se ve en producción.

**Solo cambia para lotes nuevos.** Los códigos existentes **no se reescriben**:
están sellados en `hash_documento` de sus eslabones y en pasaportes públicos
`/lote/:codigo` que pueden estar compartidos. Reescribirlos rompería la cadena
y los enlaces.

| Tipo | Prefijo |
|---|---|
| `mineral` | `LM-` (sin cambio) |
| `producto` | `LP-` |
| `documental` (Corredor) | `CB-` |

---

## 6. Flujos end-to-end

### Flujo 1 — Alta del exportador

```mermaid
graph LR
  A[Lead en corredor.sicr3p.cl] --> B[Admin enrola:<br/>RUT + correo]
  B --> C[Cuenta + invitación<br/>48 h, sin clave por correo]
  C --> D[Exportador activa<br/>y define su clave]
  D --> E[Completa datos<br/>+ EORI]
  E --> F[Contrato emitido]
  F --> G[Panel abierto]
```

Reusa **entero** el flujo de onboarding que ya existe: `enviarActivacion()`,
el token de 48 h que invalida el anterior, la clave temporal que el admin ve
una sola vez, y la cola de `services/onboarding.js` con sus siete etapas.
Solo cambia el panel de destino.

### Flujo 2 — Alta de una parcela (una vez, se reusa en muchas cargas)

```mermaid
graph TD
  A[Nueva parcela] --> B{¿Tiene el archivo<br/>del catastro?}
  B -->|Sí| C[Importar GeoJSON/KML]
  B -->|No| D[Dibujar en el mapa]
  C --> E[El servidor valida:<br/>polígono cerrado,<br/>área calza con la declarada]
  D --> F[Nivel 1 · declarado]
  E --> G{¿Calza?}
  G -->|Sí| H[Nivel 3 · consistente]
  G -->|No| I[Se registra el desacuerdo,<br/>no se corrige]
  H --> J{¿Contrastada contra<br/>registro público?}
  J -->|Sí| K[Nivel 4 · el servidor escribe<br/>validado_por, nunca el cliente]
```

Sin GPS y sin nadie recorriendo un perímetro en zona de frontera. Si el área
del archivo no calza con la declarada, **el desacuerdo se registra, no se
corrige** — mismo criterio que `verificarConsistencia()` con la factura y la
guía, y que `balanceMasas` con la merma.

### Flujo 3 — Crear el pasaporte de una carga

1. **Primero el código arancelario.** No es un campo más: decide el régimen
   y por tanto qué se pregunta después. Es la única forma de no pedirle las
   coordenadas de sus parcelas a un exportador de cátodos.
2. El servidor responde con el régimen y **qué exige**
   (`listoParaExportar()`).
3. El formulario pide **solo eso**, con quién aporta cada dato.
4. Parcelas: se eligen de las ya dadas de alta, con su porcentaje de aporte.
5. Tramo: origen → destino desde `puntos_corredor`.
6. Se crea con código `CB-AAAA-NNNNNN`.

### Flujo 4 — Cerrar la brecha

```mermaid
graph LR
  A[Pasaporte creado] --> B[listoParaExportar]
  B --> C{¿Qué falta?}
  C --> D[Cada faltante dice<br/>QUIÉN lo aporta]
  D --> E[Exportador: lo completa]
  D --> F[Productor: coordenadas,<br/>fecha, determinación]
  D --> G[Suministrador:<br/>emisiones indirectas]
  E --> H[Semáforo se recalcula]
  F --> H
  G --> H
  H --> I{¿Verde?}
  I -->|No| C
  I -->|Sí| J[Informe descargable]
```

Lo urgente se ordena por consecuencia, no por cantidad:
`urgenciaExportacion()` pone la **prohibición** (EUDR) antes del **sobrecosto**
(CBAM). «No vas a poder vender» y «te va a costar más» no se atienden igual.

### Flujo 5 — El viaje y las fronteras

El chofer lleva la Tarjeta de Viaje. En cada punto escanea el QR; el escaneo
es 100% local, y si no hay señal el paso se encola y se reintenta
(`lib/pasoOffline.js`). Al cruzar una frontera, `documentos_por_tramo` dice
qué se exige para ese par de países y el semáforo lo refleja.

La Torre de Control ya muestra el avance y los retrocesos.

### Flujo 6 — Entrega al comprador

Informe PDF con el estado por régimen, los requisitos cumplidos y **las
brechas declaradas** — la brecha es parte del producto, no se esconde.

Reusa `generateReporteCbam()` para el bloque CBAM y suma uno de EUDR.

⚠️ **Bloqueado, y hay que decirlo:** que un tercero vea la carga dentro de
sicr3p (divulgación selectiva) tiene un prerrequisito que no es de software —
el contrato de encargo de tratamiento. Mientras no exista, el informe se
entrega como archivo, no como acceso.

---

## 7. Lo que sicr3p NO hace

| No hace | Quién lo hace |
|---|---|
| Análisis satelital de deforestación | Un tercero. sicr3p registra su determinación |
| La Declaración de Diligencia Debida ante la UE | El operador, en el sistema de la Comisión |
| La declaración CBAM | El importador |
| Tramitación aduanera | La agencia de aduanas — **ya tiene su panel** |
| Operación de flota | La Torre de Control, que es otra cosa |
| Contabilidad de carbono del comprador | El comprador |
| Certificar | Nadie acá. sicr3p **registra y estructura declaraciones** |
| **Rastrear vehículos** | **Nadie.** Es una decisión, no una carencia — ver 4.0 |

---

## 8. Orden de construcción

| # | Tanda | Depende de | Entrega sola |
|---|---|---|---|
| ✅ | Alcance + `services/exportacion.js` | — | Sí — ya en producción |
| 1 | Migración 107: parcelas, producción, tramo + servicio puro de coordenadas | — | El modelo, con tests |
| 2 | Código propio por tipo (`CB-`/`LP-`) | — | Sí, y es chico |
| 3 | Captura de coordenadas: importar GeoJSON/KML, validar área, dibujar en el mapa | 1 | La parte más visible |
| 4 | Migración 108 + panel del exportador (login, activación, shell) | 1 | El octavo panel |
| 5 | Creación de pasaporte guiada por régimen | 1, 4 | Cierra el pedido original |
| ✅ | Documentos por tramo | 1 | Semáforo por frontera — `migrations-corredor/003` + `services/corredorTramo.js` |
| ✅ | Pasaporte de exportación en PDF | 1, 3 | El entregable que se vende — `generatePasaporteCarga()` |

**Las siete tandas están construidas.** Base, servicios puros, rutas,
autenticación propia, panel del exportador, tramo con sus documentos y el PDF
descargable.

Lo que sigue abierto, y por qué:

- **Legalidad en el país de producción**: la casilla existe y el documento que
  la respalda ya se puede sellar por tramo (certificado fitosanitario, DOF,
  guía forestal). Lo que no hay es una revisión de ESE documento: sicr3p sella
  su huella, no lo lee.
- **Proveedor y comprador de la operación**: sin columna todavía. Es dato de la
  cadena comercial, no del predio, y merece su propia tanda.
- **Nivel 5 de confianza**: sigue sin emitirse. Necesita un rol de auditor que
  no existe en ninguno de los dos productos.

**Pendiente de operación, no de código** (lo único que queda para encender el
Corredor en el servidor):

1. `sudo -u postgres createdb sicr3p_corredor` y
   `ALTER DATABASE sicr3p_corredor OWNER TO sicr3p;`
2. `DATABASE_URL_CORREDOR` y `JWT_SECRET_CORREDOR` en `backend/.env`. Sin
   ellas el Corredor queda apagado y el resto de sicr3p arranca igual: las
   rutas responden 503 con `codigo: 'corredor_no_configurado'`.
3. **Ampliar el respaldo.** El `pg_dump` del VPS apunta a `sicr3p` y no incluye
   la base nueva. Hay que ampliarlo antes de que el Corredor tenga datos que
   valga la pena perder — y ahora los va a tener, porque la cadena de hash de
   los documentos vive ahí y no se puede reconstruir desde la otra base.

---

## 9. Verificación

Cada tanda cierra con lo mismo, que es lo que ya se hace en este repo:

1. `npm test` en **los dos modos** — el VPS corre la suite con
   `NODE_ENV=production` contra la base real antes de reiniciar. Nada nuevo
   puede escribir en la base fuera de `test/util/soloDev.js`.
2. `npx vite build`.
3. **E2E por las rutas reales**, no importando los servicios directamente:
   ya pasó que un test unitario pasaba y la ruta caía con
   `resumenDato is not defined`.
4. **Navegador real** (Chromium ya está instalado) para lo que se ve: el mapa,
   el dibujo del polígono, la tabla dentro de `.table-scroll`, y que el gris
   se vea gris y no rojo.
5. Para el flujo de coordenadas, la prueba que vale: **cargar un GeoJSON real
   de un predio, ver el área calculada calzar con la declarada, y que el
   nivel de confianza suba de 1 a 3 por eso** — no por que alguien lo escriba.
