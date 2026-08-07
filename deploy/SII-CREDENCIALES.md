# Credenciales del SII para descargar compras y ventas (RCV/DTE)

sicr3p descarga el Registro de Compras y Ventas y los DTE recibidos del SII
usando el RUT y la Clave Tributaria del contribuyente. Esta clave se envía
al proveedor de datos (BaseAPI) **por cada consulta** y no queda en logs ni
en URLs; solo se guarda cifrada si el propio proveedor lo autoriza desde su
panel. Este documento explica qué credencial pedir y cómo diagnosticar el
rechazo típico ("error 400 / credenciales inválidas").

## Qué credencial usar

Para descargar el RCV de una **empresa** se necesita:

- **RUT de la empresa** (el RUT jurídico, ej: `76520943-9`).
- **Clave Tributaria de la empresa**: la que abre sesión en sii.cl digitando
  directamente el RUT de la empresa.

Ojo: **no** es la clave del representante legal. Una empresa tiene su propia
Clave Tributaria, distinta de la de las personas que la representan.

Si la empresa aún no tiene clave propia, el representante legal la crea gratis:

> sii.cl → Servicios Online → **Clave tributaria y representantes electrónicos**
> → obtener/recuperar clave, usando su propio RUT y clave para generar la de
> la empresa.

(Referencia SII: <https://www.sii.cl/preguntas_frecuentes/clave_secr_repr_electr/001_100_7416.htm>)

## Checklist cuando el SII rechaza las credenciales

En orden de probabilidad:

1. **Par RUT/clave cruzado**: se está enviando la clave del representante con
   el RUT de la empresa (o viceversa). Deben corresponder al mismo RUT.
2. **Formato del RUT**: probar con guion y dígito verificador, `76520943-9`.
3. **Clave provisoria**: el código que envía el SII al correo o la clave
   inicial de oficina obliga a crear una clave definitiva antes de operar.
4. **Clave bloqueada** por intentos fallidos: el SII bloquea ~1 hora. Evitar
   reintentos automáticos.
5. **Cambio reciente de clave** aún propagándose, o SII en mantención.
6. **Verificación en dos pasos** activada en la cuenta del SII: rompe el
   acceso automatizado.

**Prueba de humo**: entrar manualmente a sii.cl con ese RUT y esa clave
(ingresando directo el RUT de la empresa, no "ingresar como persona y
representar"). Si eso falla, el problema es de la credencial, no de sicr3p.

## Aislar SII vs. proveedor (curl directo)

Para saber si el rechazo viene del SII o de otra parte, probar el endpoint de
validación directamente desde el VPS (la clave se pide oculta y no queda en el
historial del shell):

```bash
cd /opt/sicr3p/backend
read -p "RUT (76520943-9): " RUTP; read -s -p "Clave SII: " CLAVE; echo
curl -s -o /tmp/val.json -w "HTTP %{http_code}\n" -X POST \
  -H "X-API-Key: $(grep -oP 'BASEAPI_API_KEY=\K\S+' .env)" \
  -H "Content-Type: application/json" \
  -d "{\"rut\":\"$RUTP\",\"password\":\"$CLAVE\"}" \
  https://api.baseapi.cl/api/v1/sii/auth/validar
head -c 300 /tmp/val.json; echo; rm -f /tmp/val.json
```

Lectura del resultado:

- **HTTP 200** → credenciales válidas; la descarga en el panel debería funcionar.
- **HTTP 400 / 401** → el SII rechazó las credenciales: aplicar el checklist.
- **HTTP 5xx** → problema del proveedor/SII; reintentar más tarde.

Si la empresa consultada es distinta de la persona que se autentica, agregar
`,\"rut_empresa\":\"76XXXXXX-X\"` dentro del `-d`.

## Proveedor de datos

Por defecto sicr3p usa **BaseAPI** (`api.baseapi.cl`). El proveedor es
intercambiable con la variable de entorno `SII_PROVEEDOR` (`baseapi` por
defecto; `simpleapi` como alternativa de mismo contrato rut+clave → JSON).
Cambiar de proveedor no altera el flujo del panel ni el cálculo.
