-- ============================================================
-- Cobro por correo con entrega automática del acceso.
--
-- EL FLUJO, EN UNA LÍNEA: se importa una lista de empresas (Excel o CSV),
-- a cada una le llega un correo con SU link de pago, y cuando paga el
-- sistema le emite un código de acceso con créditos y se lo manda —
-- sin que nadie del equipo tenga que estar mirando.
--
-- POR QUÉ SE APOYA EN `codigos_acceso` Y NO EN UNA CUENTA DE PANEL. El
-- código con créditos ya existe desde la migración 009, ya se canjea con
-- bloqueo transaccional (`SELECT ... FOR UPDATE` en routes/public.js) y
-- ya significa algo concreto para el comprador: 1 crédito = 1 factura
-- procesada. Es la unidad de valor que había; venderla es el cambio más
-- chico que convierte el acceso gratuito en un producto pagado. Una
-- cuenta de panel proveedor exige además una fila en `proveedores` (RUT
-- validado, contrato) — eso es el enrolamiento formal de admin.js, otro
-- camino, no este.
--
-- POR QUÉ EL TOKEN DEL LINK NO ES UN SECRETO GRAVE. `cobros.token` viaja
-- en el correo y se guarda en claro a propósito: quien lo tenga solo
-- puede ver el monto y PAGARLO. Las credenciales NUNCA se entregan a
-- quien abre el link — se envían al correo que quedó registrado en la
-- fila. Un token filtrado no gana acceso, en el peor caso paga por otro.
-- Esa asimetría es deliberada y hay que conservarla si el flujo cambia.
--
-- POR QUÉ `pagado` Y `entregado` SON ESTADOS DISTINTOS. En el camino
-- feliz `pagado` dura milisegundos. Existe separado porque el correo con
-- las credenciales puede fallar (SMTP caído, casilla llena) DESPUÉS de
-- que el dinero entró: sin el estado intermedio, un cobro pagado cuyo
-- correo rebotó sería indistinguible de uno entregado, y el comprador
-- quedaría pagando por nada sin que nadie se entere.
-- ============================================================

-- ---------- Campaña: qué se vende y a cuánto ----------
-- El precio y los créditos viven en la campaña, no en cada destinatario,
-- para que "subir el precio" sea un dato y no una edición masiva. Cada
-- cobro igual copia el monto al crearse (ver abajo).
CREATE TABLE IF NOT EXISTS campanas_cobro (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  monto_clp   INT NOT NULL CHECK (monto_clp > 0),
  creditos    INT NOT NULL DEFAULT 5 CHECK (creditos BETWEEN 1 AND 1000),
  activa      BOOLEAN NOT NULL DEFAULT true,
  creado_por  UUID REFERENCES usuarios(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Cobro: una fila por empresa de la lista ----------
-- `monto_clp` se COPIA de la campaña al importar y no se recalcula: al
-- destinatario se le cobra lo que decía su correo, aunque después alguien
-- cambie el precio de la campaña. Cambiar el precio a alguien que ya
-- recibió su link sería, literalmente, otra cosa que la que se le ofreció.
CREATE TABLE IF NOT EXISTS cobros (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campana_id   UUID NOT NULL REFERENCES campanas_cobro(id) ON DELETE CASCADE,
  empresa      TEXT,
  rut          TEXT,
  contacto     TEXT,
  email        TEXT NOT NULL,
  monto_clp    INT NOT NULL CHECK (monto_clp > 0),
  token        TEXT UNIQUE NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente','enviado','pagado','entregado','anulado')),
  -- Con qué se pagó y el identificador que devolvió la pasarela, para
  -- poder conciliar contra su panel. 'manual' = transferencia confirmada
  -- a mano por un admin.
  pasarela     TEXT,
  pasarela_ref TEXT,
  -- Lo que se entregó. Es la prueba de que el comprador recibió algo:
  -- si el correo falla, el código igual existe y se puede reenviar sin
  -- emitir uno nuevo (ni cobrar de nuevo).
  codigo_id    UUID REFERENCES codigos_acceso(id),
  enviado_at   TIMESTAMPTZ,
  pagado_at    TIMESTAMPTZ,
  entregado_at TIMESTAMPTZ,
  notas        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una empresa no puede recibir dos links de la misma campaña: reimportar
-- el mismo Excel (algo que va a pasar) no debe duplicar el cobro. Por
-- correo en minúsculas, que es la llave real del envío.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cobro_campana_email
  ON cobros (campana_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_cobros_estado ON cobros (estado, created_at DESC);

-- ---------- Bitácora de correos ----------
-- Hasta ahora un envío no dejaba rastro en la base: si un cliente decía
-- "nunca me llegó", no había forma de saber si salió. Con una campaña de
-- cobro eso deja de ser un detalle — es la diferencia entre reclamar un
-- pago y no poder.
--
-- Guarda el HECHO del envío, nunca el cuerpo: el contenido incluiría el
-- link de pago (y, en el correo de credenciales, el código mismo).
CREATE TABLE IF NOT EXISTS correos_enviados (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destinatario_email TEXT NOT NULL,
  asunto             TEXT NOT NULL,
  tipo               TEXT NOT NULL,
  -- A qué fila se refiere (id de cobro, de usuario…). Texto libre y sin
  -- FK a propósito: la bitácora sobrevive al borrado de lo que anotó.
  referencia         TEXT,
  transporte         TEXT,
  ok                 BOOLEAN NOT NULL,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correos_referencia ON correos_enviados (referencia, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_correos_tipo ON correos_enviados (tipo, created_at DESC);

-- ---------- Lista de bajas (supresión) ----------
-- OBLIGATORIA, no un extra. La lista que alimenta esto son contactos
-- recogidos en ferias: gente que nunca pidió recibir un cobro. El art.
-- 28 B de la Ley 19.628 exige que todo correo promocional identifique al
-- remitente y ofrezca un medio gratuito de pedir que no se le escriba
-- más — y que se respete. Sin esta tabla el "darse de baja" del correo
-- sería un botón que no hace nada.
--
-- Además es lo único que protege la reputación del dominio: los correos
-- de activación y de recuperación de contraseña de TODA la plataforma
-- salen del mismo sicrep.cl. Si una campaña masiva junta reclamos de
-- spam, el que deja de llegar es el correo transaccional del que depende
-- cualquiera que quiera entrar a su cuenta.
--
-- Vive aparte de `cobros` a propósito: una baja vale para SIEMPRE y para
-- TODAS las campañas, no para la fila donde se pidió.
CREATE TABLE IF NOT EXISTS bajas_correo (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  motivo     TEXT,
  origen     TEXT NOT NULL DEFAULT 'enlace' CHECK (origen IN ('enlace','rebote','manual','reclamo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_baja_email ON bajas_correo (lower(email));

-- ---------- Sección del panel ----------
-- 'cobros' es su propia sección y no un rincón de 'accesos_externos':
-- quien opera la campaña comercial mueve dinero y ve la lista completa de
-- empresas contactadas, que es justamente lo que un admin de soporte no
-- tiene por qué ver. Aditiva — nadie la tenía, empieza en 0 cuentas.
--
-- EL CHECK NO SE DECLARA ACÁ. Hacerlo era un arranque roto esperando:
-- `migrate.js` corre todos los .sql siempre, así que este archivo volvía a
-- imponer un vocabulario sin 'activos' y el servidor moría al arrancar.
-- Ver la nota larga en 097. El vocabulario vive en la migración más nueva
-- que lo amplía, y un test lo comprueba.

COMMENT ON COLUMN cobros.token IS
  'Va en el link del correo. No es una credencial: quien lo tenga solo puede pagar; el acceso se envía siempre al email de la fila.';
COMMENT ON COLUMN cobros.estado IS
  'pendiente → enviado → pagado → entregado. "pagado" sin "entregado" = el dinero entró y el correo de credenciales falló: hay que reenviarlo.';
