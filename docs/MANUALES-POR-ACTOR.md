# Manuales por actor — en el orden del flujo

Cada agente de la operación sicr3p, en el orden en que toca la cadena:
quién es, por dónde entra, qué hace paso a paso, qué NO puede hacer y qué
deja registrado. Complementa el manual por pantallas
(`docs/manual/manual-uso-sicr3p.pdf`) — este documento sigue el orden del
FLUJO, no el orden de los menús.

**Regla transversal**: nadie digita datos de un documento a mano — se
escanea o se sube el archivo, el motor lo lee, y si no se puede leer se
rechaza y se vuelve a escanear. Todo lo que un actor sella queda en una
cadena de hash append-only verificable por QR. sicr3p prepara insumos
(informes, inventarios, resúmenes REP) para procesos externos; **no
certifica ni declara ante la autoridad por nadie**.

---

## 1. Cliente (empresa que quiere su informe) — `/cargar`

**Entra con**: un código de acceso con créditos, o su sesión de cliente
(magic link al correo si ya tiene historial).

1. Abre `/cargar` desde cualquier teléfono o computador.
2. Sube hasta 5 documentos: arrastra archivos, "Elegir archivos", o
   **"Tomar foto"** (la cámara del celular abre directo). Formatos: PDF,
   XML, JPG, PNG, HEIC.
3. Completa RUT de su empresa (se valida el dígito verificador al
   escribir), razón social y correo.
4. "Procesar": ve el avance documento por documento.
5. Recibe su informe en `/resultado/:id` y por correo, con etiquetas QR.

**Qué pasa si algo no calza**: un documento ilegible se rechaza con motivo;
un documento **emitido a otro RUT** no se asimila — se rechaza solo ese,
el resto sigue, y el aviso lo explica en pantalla.

**No puede**: corregir datos a mano, procesar documentos de terceros como
propios, ni exceder los créditos de su código.

**Deja registrado**: sesión + facturas encadenadas por hash, rechazos con
motivo en la bitácora.

## 2. Jugador Sube y Suma — `/suma`

**Entra con**: magic link de la campaña (código de acceso del juego).

1. **Escanear** (`/suma/escanear`): fotografía la boleta/factura, ingresa
   el RUT de la empresa emisora, procesa y gana puntos.
2. **Reciclar** (`/suma/reciclar`): escanea el QR del cartel del punto
   limpio, fotografía sus envases, comparte su ubicación (el GPS valida
   que esté en el punto) y suma.
3. Ve misiones, ranking y canjea recompensas; sus constancias se
   verifican públicamente por serial.

**No puede**: puntuar documentos emitidos a otro RUT (se rechazan igual
que en el flujo cliente) ni reciclar lejos del punto limpio.

## 3. Operador de terreno / mostrador — `/panel-verde`

**Entra con**: cuenta del panel de terreno (usuario y contraseña, o
llave FIDO2 / llave de archivo).

1. Atiende al cliente en el punto: escanea sus documentos con el mismo
   Dropzone (cámara o archivo).
2. Si un documento no se lee, **se rechaza y se vuelve a escanear — jamás
   se digita**.
3. Arma la pre-declaración REP de la sesión si corresponde (componentes
   del embalaje; el % de reciclabilidad lo calcula el servidor).
4. Ofrece compensación y envía el comprobante por correo; puede imprimir
   la carpeta física para el mandante.

**Deja registrado**: la sesión igual que el flujo público, más su
identidad de operador en el log de actividad.

## 4. Empresa proveedora — `/panel-proveedor`

**Entra con**: cuenta creada por el admin al enrolarla (nace como
operador: su función es operar sus propios datos). Primera vez: completa
sus datos (onboarding); el SII queda disponible cuando sicr3p emite su
contrato.

**4a. Compras y ventas (SII)** — descarga su RCV con su clave tributaria
(puede guardarla cifrada o no guardarla), ve su análisis del período, su
contabilidad de carbono por Alcances 1/2/3, y descarga el informe PDF y
el inventario CSV para presentar a procesos externos (ej. programa
HuellaChile del MMA, que reconoce a la empresa titular — nunca a sicr3p).

**4b. Ley REP** — sin POS, desde su propio teléfono:
1. Crea sus **productos** una sola vez, con la composición del envase de
   una unidad (material, peso, reciclable). El % lo calcula el servidor.
2. Por cada venta: sube la **factura** (foto/PDF/XML — queda como
   evidencia con su sha256) y la **pega** a los productos vendidos con
   sus unidades. La misma factura no se puede registrar dos veces
   (duplicaría kilos); las fechas futuras se rechazan.
3. Su **resumen REP**: kilos de envases puestos en el mercado por
   material y período — el insumo de su declaración en RETC/SGR. Si
   descargó su RCV, cada venta muestra si **consta** en él, y el panel
   avisa cuántas ventas del RCV faltan por pegar (las de servicios o sin
   envase no van).

**4c. Lotes por firmar** — firma (atesta) los lotes que el admin le
asignó; su identidad sale siempre de su ficha, nunca la declara ella.

**No puede**: declarar ante el MMA a través de sicr3p (la declaración
formal la hace la empresa), ver datos de otra empresa, ni tocar la cadena
de un lote fuera de su firma asignada.

## 5. Administrador sicr3p — `/admin`

**Entra con**: cuenta del panel `sicrep` (rol admin u operador; el
superadmin además puede pedir vistas de solo lectura de otros paneles).

En el orden de una operación típica:
1. **Enrolar cliente** (alta en un paso) o crear la empresa en Accesos.
2. **Sesiones e informes**: seguimiento de todo lo procesado.
3. **SII compras/ventas**: descarga y análisis por empresa, informe PDF e
   inventario CSV por alcance.
4. **Pasaporte de Origen**: crea lotes, agrega eslabones, asigna
   proveedores a firmar, emite **tarjetas de viaje**, sube documentos del
   lote, cierra el lote (el hash final se ancla en la cadena global) e
   imprime el expediente sellado.
5. **Corredor Bioceánico**: metodologías por país y carga de documentos
   de tránsito (cámara o archivo, mismo Dropzone).
6. **Revisión de documentos, Capital Natural, Trazabilidad, Métricas,
   Usuarios y roles** (la tabla va agrupada por panel y jerarquía),
   **Log de actividad** para auditar todo.

**Regla de oro**: los eslabones de una cadena no se editan ni se borran —
un error se corrige agregando un eslabón que declara a cuál corrige.

## 6. Portador / conductor (Corredor) — `/v/:serial`

**Entra con**: la tarjeta de viaje que acompaña la carga (QR en el
teléfono o impresa; NDEF si es NFC) + la clave del portador entregada
con ella.

1. En cada punto de control: abre la tarjeta (o alguien escanea su QR),
   toca **"Soy portador"**, ingresa la clave.
2. Elige el punto del catálogo del corredor (Campo Grande → puertos de
   Antofagasta) o escribe uno libre con su país.
3. **"Registrar paso"**: el paso queda sellado como eslabón de transporte
   en la cadena del lote. La secuencia de pasos ES la ruta — sin GPS.
4. Ve en su credencial la instrucción vigente de la torre ("a puerto
   seco", "a frontera · Paso de Jama") — se refresca sola.

**No puede**: borrar ni mover un paso ya sellado, ni registrar pasos sin
la clave (quien escanea sin clave solo VE el pasaporte, en modo lectura).

## 7. Torre de control — `/torre` (credencial de terminal)

**Entra con**: credencial de terminal (rol `pos`) entregada por el admin.

1. Ve la flota completa en el mapa: cada camión está en su último punto
   sellado.
2. Envía instrucciones al camión: **puerto seco / puerto / frontera (con
   paso) / estacionamiento (con zona)**. El portador la ve en segundos.
3. Las instrucciones son operación, no custodia: quedan append-only en su
   propia tabla y NO tocan la cadena de hash del lote.

## 8. Agencia de aduana — `/panel-agencia`

**Entra con**: cuenta atada a su agencia (nace como **operador**: su
función es capturar el expediente en terreno).

1. Ve los expedientes/lotes donde interviene.
2. **Sube documentos** del expediente (declaraciones, papeles del
   tránsito) — la única mutación del panel, bloqueada si la cuenta está
   en solo lectura.

## 9. Puerto — `/panel-puerto` (solo lectura)

**Entra con**: cuenta atada a su puerto — nace en **solo lectura**, y el
panel además no tiene mutaciones: es consulta de tránsitos y lotes que
llegan a su terminal.

## 10. Mandante (minera / gran empresa) — `/panel-mandante` (solo lectura)

**Entra con**: cuenta atada a su empresa (nace en solo lectura) o
X-Api-Key para integración de sistemas.

1. Consulta el consolidado de sus proveedores (con lista blanca de RUT si
   la configuró).
2. Exporta el **CSV de Alcance 3** (taxonomía GHG Protocol, fuente del
   factor por fila) y CBAM.
3. Puede recibir webhook por cada sesión nueva de sus proveedores.
4. En papel: recibe la **carpeta física** con QR de verificación por
   documento y la hoja de comprobación en 30 segundos.

## 11. Trazador — `/panel-trazador` (solo lectura)

**Entra con**: cuenta atada a su entidad (nace en solo lectura).
Busca por RUT y consulta cruces — no escribe nada.

## 12. Verificador externo (cualquiera, sin cuenta)

No necesita entrar a nada: **escanea un QR con la cámara del teléfono**.

- Etiqueta de un documento → `/verificar/:id` (integridad del eslabón).
- Pasaporte de producto → `/pasaporte/:id`.
- Pasaporte de un lote → `/lote/:codigo` (cadena completa, divulgación
  selectiva: lo privado no se expone, pero su hash sí es verificable).
- Torre pública de un lote → `/torre/:codigo`.
- Constancias de capacitación y del juego → por su serial.

Es la razón de todo lo anterior: **cualquier tercero puede comprobar la
integridad sin pedir permiso ni confiar en sicr3p**.

---

*Última actualización: se agrega el flujo Ley REP del proveedor (productos
+ factura pegada + cruce RCV) y los niveles de acceso por defecto (consulta
nace en solo lectura; agencia y proveedor nacen operador).*
