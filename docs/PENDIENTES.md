# Pendientes de sicr3p

Estado al **01-09-2026**. Cada punto trae dónde mirarlo y cómo se comprueba,
para que no haya que creerle a este archivo: se verifica.

Orden por gravedad, no por esfuerzo. Arriba está lo que puede hacer daño
callado; abajo, lo que falta pero se nota solo.

**Regla para editar este archivo:** un pendiente se borra cuando el código
lo cierra, no cuando se decide que no importa. Si se decide que no importa,
se mueve a *Decidido que no* con la razón y la fecha.

---

## 0 · Respaldos

### 0.1 — La única copia propia vive en el disco que respalda

| | |
|---|---|
| **Dónde** | `deploy/respaldo.sh` → `DEST="${1:-/root/backups}"` |
| **Comprobar** | `grep -n 'scp\|rsync\|s3\|rclone' deploy/respaldo.sh` → sin resultados |
| **Gravedad** | Media — **corregida a la baja el 01-09**, ver abajo |

El respaldo diario y los pre-deploy escriben en `/root/backups` **del mismo
VPS**. No hay copia propia fuera de esa máquina.

**Lo que se creyó el 01-09 y era falso.** Con el nodo caído se anotó esto
como catástrofe potencial: que si el disco no volvía se perdían juntas la
base y los catorce días de respaldos. Faltaba un dato que estaba a la vista
en el panel de DonWeb: **el plan incluye «Backup: Premium Diario»**, o sea
respaldo del proveedor, independiente del disco de la instancia. El riesgo
real es bastante menor que el declarado.

Queda anotado el error, no borrado: la conclusión alarmante se sacó del
código —donde efectivamente no hay copia externa— sin mirar qué contrataba
el plan. El código no sabe lo que hay contratado, y una revisión que solo
lee código va a seguir concluyendo lo mismo.

**Lo que sí sigue en pie**, y por lo que el pendiente no se cierra:

- Los dos respaldos —el propio y el de DonWeb— dependen del **mismo
  proveedor**. Una baja de la cuenta, un problema de facturación o un
  incidente que afecte a los dos se lleva ambos.
- No está confirmado de qué fecha es el último punto de restauración ni si
  se puede restaurar **a otro nodo**. Un respaldo que solo se pueda montar
  en el nodo averiado no sirve para nada mientras dure la avería. Hay que
  preguntarlo, no suponerlo.

**Cerrar así:** una copia fuera de DonWeb —bucket, otro servidor, o
descarga programada—, con las credenciales del destino en env. Y confirmar
por ticket la fecha y la granularidad del Premium Diario.

---

## 1 · Verdes falsos

Lo que el sistema afirma sin poder demostrarlo, o lo que omite sin decirlo.
Es la categoría más grave porque no se ve: nadie reclama por un dato que no
sabe que falta.

### 1.1 — Doce normas citadas, ninguna contrastada

| | |
|---|---|
| **Dónde** | `docs/official/manifest.json`, `backend/src/services/fuentesOficiales.js` |
| **Comprobar** | `cd backend && npm run fuentes` |
| **Estado** | 12 fuentes, **12 pendientes**, 0 rotas |

El pasaporte de carga cita el EUDR, el CBAM, la Resolución DNA 494/2017 y
la regulación brasileña. Ninguna se ha contrastado contra el texto oficial:
el proxy de egreso responde 403 al CONNECT hacia `eur-lex.europa.eu`,
`dnit.gov.py`, `gov.br` y `bcn.cl`.

Esto **no es un error del sistema** — está declarado, el PDF imprime cuántas
fuentes tiene verificadas y cuántas no, y declararse verificado sin prueba
rompe la compilación. Pero sigue siendo una deuda real, y el manifiesto ya
tiene las URL directas.

**Cerrar así**, desde una red sin el bloqueo:

```bash
# bajar el PDF a docs/official/<PAIS>/
cd backend && npm run fuentes -- --sellar UE-2023-1115 32023R1115.pdf
# commitear el PDF y el manifiesto en el MISMO commit
```

### 1.2 — El artículo 9 del EUDR está 6 de 8

| | |
|---|---|
| **Dónde** | `backend/src/services/exportacion.js` |
| **Bloqueado por** | 1.1 — no se puede confirmar sin el texto oficial |

Una revisión normativa indicó que de los ocho requisitos de información del
artículo 9 se comprueban seis. Si es cierto, una carga puede salir en verde
cumpliendo seis de ocho, que es exactamente un verde falso.

**Sin verificar.** Salió de fuentes secundarias. No se actúa hasta sellar
`UE-2023-1115`; corregirlo sobre una fuente secundaria sería repetir el
error que 1.1 existe para no repetir.

### 1.3 — El NC 1507 podría faltar del listado EUDR

Mismo origen y misma condición que 1.2. El aceite de soja podría estar en el
Anexo I sin estar en el listado que sicr3p mantiene. Si falta, esa carga se
clasifica como exportación simple cuando debería ser EUDR.

### 1.4 — El marco de corredores de seguros está sin contrastar

| | |
|---|---|
| **Dónde** | `docs/PANEL-ASG.md` §8.3 |
| **Comprobar** | `cd backend && npm run fuentes` → ninguna fuente de seguros todavía |
| **Bloquea** | Cualquier material que mencione intermediación de pólizas |

Al explorar la idea de seguros apareció que intermediar pólizas en Chile
exige registro ante la CMF (marco general en el DFL 251). **Esa afirmación
salió de conocimiento general, no del texto oficial**, así que está en la
misma categoría que 1.2 y 1.3: una norma citada sin contrastar.

No hay urgencia mientras nadie construya hacia ahí —y `PANEL-ASG.md` ya lo
descarta explícitamente—. Pero si algún día se quiere revisar esa decisión,
el primer paso es sellar la fuente, no razonar sobre el recuerdo.

Desde este entorno no se puede: el proxy bloquea `cmfchile.cl`, mismo
motivo que tiene detenidas a las 12 de 1.1.

---

---

## 2 · Lo que promete y no hace

Funcionalidad a medio construir: la tabla existe, la pantalla existe, y en
el medio no hay nada.

### 2.1 — `carga_documentos.estado` nunca sale de `pendiente_revision`

| | |
|---|---|
| **Comprobar** | `grep -rn "carga_documentos SET estado" backend/src/` → sin resultados |
| **Impacto** | Alto: el exportador queda esperando una revisión que nadie hace |

El documento se carga, queda en `pendiente_revision` y ahí se queda para
siempre. No hay endpoint, ni pantalla, ni rol que lo mueva a aprobado o
rechazado.

**Cerrar así:** decidir primero quién revisa —¿el admin del Corredor?
¿nadie, y el estado sobra?— y después construirlo. Si la respuesta es que
nadie revisa, lo correcto es **quitar la columna**, no dejarla mintiendo.

### ~~2.2 — Recuperación de contraseña en el Corredor~~ · CERRADO 23-08

Un exportador que perdía su clave quedaba afuera; la única salida era que
un admin le emitiera una temporal y se la dictara. Ahora hay
`POST /auth/olvide-clave` y `POST /auth/restablecer`.

Dos decisiones que conviene no deshacer:

- **La respuesta es idéntica exista o no el correo**, y el trabajo se hace
  dentro del `if` para no delatar por latencia. Decir "ese correo no está
  registrado" permitiría averiguar qué empresas operan en el Corredor
  probando direcciones, y en un corredor minero eso ya es información.
- **Enlace inexistente, vencido y ya usado dan el mismo mensaje.** Los tres
  significan lo mismo para quien lo tiene en la mano; distinguirlos solo le
  sirve a quien prueba enlaces ajenos.

El token va hasheado con SHA-256, 32 bytes de entropía, un solo uso, 48 h,
y el canje es transaccional con `FOR UPDATE` para que dos peticiones
simultáneas no cambien la clave dos veces.

### ~~2.3 — El Corredor no manda correos~~ · CERRADO 23-08

`resetCorredorEmail` en `services/mailer.js`, con su propia plantilla: el
Corredor es otro producto y quien lo recibe puede no saber qué es sicr3p
más allá de su panel de cargas. El plazo viaja como parámetro desde
`HORAS_TOKEN_CORREDOR` para que el texto no lo repita por su cuenta y se
desincronice.

Si el envío falla, la petición NO se cae: el token ya quedó creado y el
admin todavía puede emitir una clave temporal. Reventar ahí dejaría al
usuario sin ninguna de las dos vías.

**Queda pendiente el resto del correo del Corredor**: no hay activación de
cuenta por enlace ni aviso de documento recibido. Lo que se cerró es la
recuperación de clave, que era lo que dejaba gente afuera.

### ~~2.4 — El adhesivo no se puede imprimir~~ · CERRADO 25-08

El generador existía y no lo llamaba nadie. Ahora hay sección propia
(`activos`), alta en el panel, emisión de un adhesivo y de una tanda en
ZIP. Verificado extremo a extremo contra el servidor real: la sección
gatea (403 sin ella), el período invertido se rechaza, la baja deja el QR
en 404, y una tanda de 3 buenos + 1 inexistente entrega 3 y **nombra** el
que faltó en `X-Adhesivos-Omitidos`.

Tres decisiones que conviene no deshacer:

- **La patente se imprime y no viaja a la web.** No es contradicción: en
  el adhesivo está pegada al lado de la placa, que ya ve cualquiera que
  mire el móvil; en `GET /api/activo/:codigo` la leería cualquiera desde
  cualquier parte probando códigos, y eso convierte el QR en un directorio
  de qué móvil es de qué empresa auditada. Son dos funciones distintas
  —`activoPublico` y `activoParaImpresion`— y no un booleano, porque un
  booleano se pasa mal una sola vez.
- **El adhesivo declara su período.** Sin él, un adhesivo verde impreso
  hace dos años sigue afirmando en presente. Sin período declarado lo dice
  con todas sus letras.
- **El alto del PDF sale del contenido.** Un activo sin patente ni
  contrato mide 148 pt en vez de 195: con alto fijo quedaban cinco
  centímetros de blanco antes del descargo.

---

### ~~2.5 — Marcar «cobros» en el panel dejaba el servidor sin arrancar~~ · CERRADO 25-08

| | |
|---|---|
| **Comprobar** | `cd backend && node --test test/migracionesSecciones.test.js` |
| **Estuvo latente desde** | la migración 100 |

Tres migraciones (092, 097, 100) hacían cada una `DROP` + `ADD` del CHECK
de `usuarios.secciones_admin` con una foto del vocabulario de su época.
Como `migrate.js` **no lleva registro y corre todos los `.sql` en cada
arranque**, la 097 se volvía a ejecutar siempre — con una lista que no
conoce `cobros`.

O sea: bastaba que un admin marcara la casilla «Cobros y campañas» en el
panel para que el servidor no levantara en el siguiente despliegue, y
`deploy/actualizar.sh` reinicia en cada despliegue. El síntoma engaña
—`check constraint ... is violated by some row`— y parece un problema de
datos.

No se descubrió razonando: apareció al agregar la sección 26 y ver morir
el arranque. Se confirmó que ya estaba roto reproduciéndolo **sin**
`activos`, solo con `cobros`.

Ahora el vocabulario se declara en **un solo lugar**: la migración más
nueva que lo amplía. Hay un test que rompe la compilación si dos
migraciones lo imponen sin guardia, o si la lista del SQL y la de
`constants/seccionesAdmin.js` dejan de decir lo mismo.

---

### 2.6 — La landing ofrece tres áreas que la base no distingue

| | |
|---|---|
| **Dónde** | `frontend/src/lib/i18n.js` (`landing.hero2_sub`), `backend/migrations/105_expedientes.sql:74` |
| **Comprobar** | `grep -n "tipo IN" backend/migrations/105_expedientes.sql` → tipos comerciales, ninguna área |
| **Alcance** | Ver `docs/PANEL-ASG.md` |

`landing.hero2_sub`, vivo en `/plataforma`, ofrece **aseguramiento de
sostenibilidad, contabilidad forense y cumplimiento del MPD**. De las tres,
solo la primera está construida: de `21.595` no hay una línea en todo el
backend.

Y `expedientes.tipo` es `suministro/servicio/transporte/arriendo/otro` —el
tipo de relación comercial—, así que no hay dónde guardar de qué área es un
expediente.

Peor: `Lanzamiento.jsx:84` afirma que «el expediente se abre por área y por
período fiscal». Por período sí; por área no. Es una afirmación falsa sobre
cómo funciona el producto. **Hoy no se sirve** —la cuenta regresiva venció
y `App.jsx:105` manda a `Programa`—, así que es código muerto y no una
mentira a la vista. Deja de serlo el día que alguien reuse ese texto.

**Cerrar así:** o la base aprende de áreas (`expedientes.area`), o el copy
deja de prometerlas. Las dos salidas son legítimas; dejarlo como está no.

---

### 2.7 — El comodato no dice quién paga el deducible

| | |
|---|---|
| **Dónde** | `backend/src/services/contrato.js:594` — cláusula «Seguro y siniestros» |
| **Comprobar** | `grep -n "deducible" backend/src/services/contrato.js` |
| **Impacto** | Alto: es un contrato que un auspiciador tiene que firmar |

La cláusula existe y está redactada, pero con dos marcadores `[•]` sin
resolver: qué póliza se exige, y **de cargo de quién es el deducible**.

Traducido: no está decidido quién paga si chocan la camioneta donada. Eso
no se resuelve programando —es una decisión comercial— pero mientras siga
así, el comodato sale en borrador y no se puede firmar.

El comodato tiene 9 marcadores de ese tipo en total; este es el que tiene
plata detrás.

---

---

## 3 · Alcance declarado y no cubierto

### 3.1 — El panel del Corredor está solo en español

| | |
|---|---|
| **Comprobar** | `grep -rn "useIdioma" frontend/src/panel-corredor/` → sin resultados |
| **Pide** | es-CL, es-AR, es-PY y pt-BR como mínimo |

Los textos están en duro (`Nueva carga`, `Código arancelario`, `Región de
origen`). La landing pública sí tiene tres idiomas; el panel, ninguno.

El corredor cruza Brasil y Paraguay: un transportista brasileño usando un
panel en español de Chile es un problema de operación, no de estética.

**Ojo al hacerlo:** los textos jurídicos no se autotraducen. Un régimen
aduanero mal traducido es peor que uno sin traducir.

---

## 4 · Acciones en el VPS

No son código: son cosas que hay que ir a hacer al servidor.

- [ ] **El checkout está en la rama vieja.** Mientras siga así, el cron
      reporta "sin cambios" en silencio y nada de lo empujado llega.

      ```bash
      cd /opt/sicr3p && git fetch origin main && git checkout main && bash deploy/actualizar.sh
      ```

- [ ] **Encender el Corredor** y crear el primer admin real:

      ```bash
      bash deploy/encender-corredor.sh --admin <correo real>
      ```

- [ ] **Borrar la cuenta `tu-correo@dominio.cl`.** Su clave temporal se pegó
      en un chat, así que está quemada. Hacerlo después de crear el admin
      real, no antes.

---

## 5 · Salud del entorno

**PostgreSQL se cayó tres veces** durante la jornada del 20-08. El síntoma
engaña: aparecen doce fallas en `adminCuentas` que parecen una regresión y
no lo son. Antes de creerle a una corrida roja:

```bash
pg_isready || service postgresql start
```

Vale también para el VPS: `deploy/actualizar.sh` corre `npm test` con
`NODE_ENV=production` contra la base real antes de reiniciar, así que una
base caída se lee como código roto.

---

## Cerrado hoy

Queda anotado porque explica por qué varios de los pendientes de arriba
están escritos como están.

| Qué | Commit |
|---|---|
| Registro de fuentes oficiales con sha256; declararse verificado sin prueba rompe el build | `fbb703c` |
| URL reales de la DNIT + seis normas más en el manifiesto | `2ef5861` |
| `cripto.test.js` probaba solo el modo desarrollo y caía en el gate del VPS | `5b25a41` |
| Serial de la Tarjeta de Viaje: de 2^16 a 2^64, y el destino sale del endpoint público | `29d7932` |
| El derecho de acceso ARCOP omitía la base del Corredor **en silencio** | `4ec3406` |
| La purga no alcanzaba las tablas del Corredor que el inventario prometía purgar | `e615c2f` |
| Título del navegador y vista previa al compartir | `9595c3a` |
| Portada del Programa Norte 2026-2030, con la regla de «solo confirmados» | `2f24be4` |
| Recuperación de clave y primer correo del Corredor | `f7e8bae` |
| Adhesivo del activo: tres estados, sin rojo, símbolo dibujado y no escrito | `01db7c3` |
| La muestra pública del informe llevaba una página de atraso | `e20c03a` |
| Las quince muestras de `docs/muestras/` estaban viejas: el reporte CBAM salía sin sus límites | `325a0d1` |
| El adhesivo se puede imprimir: sección, alta, PDF con patente y tanda en ZIP | ver 2.4 |
| Marcar «cobros» dejaba el servidor sin arrancar — latente desde la 100 | ver 2.5 |

Los dos del medio comparten causa: el inventario no sabía decir en qué base
vivía cada tabla, y `puntos_corredor` existe de verdad en las dos. Un objeto
literal no admite la misma llave dos veces, así que una de las dos
clasificaciones era código muerto y nadie se enteró — el test tenía la misma
ceguera.

---

## Decidido que no

- **Rastrear vehículos.** La carga cruza cuatro países; seguir camiones en
  vivo es un riesgo de seguridad. Se registra el hito en el punto de
  control, no la posición del móvil. `carga_pasos` no tiene `lat` ni `lng`
  y hay un test que lo impide.
  La ubicación por dispositivo queda para el tag de la etapa dos.

- **Migrar a Next.js.** Evaluado el 20-08: 24 semanas y 780–920 persona-día
  para un panel privado detrás de un login. No se justifica.

- **Emitir nivel de confianza 5.** Necesita un rol de auditor que no existe.
  El código no lo emite nunca, por diseño.
