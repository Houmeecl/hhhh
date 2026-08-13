-- ============================================================
-- Entrega cifrada del informe, y acuse de lo entregado.
--
-- POR QUÉ. El activo de sicr3p es la contabilidad sellada. Hasta ahora el
-- informe salía como PDF adjunto en un correo: un archivo en claro que
-- cruza servidores ajenos, se queda para siempre en la bandeja de quien
-- lo recibe y se reenvía con dos clics. Sellar el cálculo con una cadena
-- de hash y después entregarlo desnudo es cerrar la puerta y dejar la
-- ventana abierta.
--
-- Dos piezas, ninguna más.
-- ============================================================

-- 1) La clave de informe de cada proveedor.
--
-- Se guarda CIFRADA en reposo (services/cripto.js, AES-256-GCM) con la
-- misma llave maestra que ya protege las claves tributarias del SII. La
-- llave vive solo en env: si se filtra la base, esta columna no sirve de
-- nada. Por eso el nombre no dice "hash" — no es un hash, es un secreto
-- recuperable, y tiene que serlo: hay que poder dictársela al cliente.
--
-- Nullable a propósito: se crea sola la primera vez que se le entrega un
-- informe a esa empresa, no al darla de alta. Una empresa que nunca
-- recibió un informe no necesita tener una clave dando vueltas.
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS clave_informe TEXT;

COMMENT ON COLUMN proveedores.clave_informe IS
  'Contraseña del PDF de informe, cifrada en reposo con SII_CRED_KEY. Se entrega al cliente UNA vez desde el panel y jamás viaja en el mismo correo que el informe.';

-- 2) El acuse de entrega.
--
-- Un activo tiene que poder responder con precisión "¿qué archivo exacto
-- recibió esta empresa en julio?". Eso NO lo responde la cadena de
-- integridad —que sella el cálculo, no el envío— ni `correos_enviados`,
-- que anota el hecho del correo pero no su contenido.
--
-- Se guarda el hash del archivo TAL COMO SALIÓ: si iba cifrado, el hash
-- es el del archivo cifrado. Guardar el del PDF en claro no probaría nada
-- sobre lo que efectivamente viajó.
--
-- ESTA TABLA NO SE ENCADENA. Es un registro de operación, no un eslabón:
-- encadenarla la volvería imborrable y mezclaría dos cosas que conviene
-- mantener separadas — lo sellado (el cálculo) y lo registrado (el envío).
CREATE TABLE IF NOT EXISTS entregas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          TEXT NOT NULL
                  CHECK (tipo IN ('informe_sesion','informe_mensual','comprobante_transporte','carpeta_mandante')),
  proveedor_id  UUID REFERENCES proveedores(id) ON DELETE SET NULL,
  destinatario_email TEXT NOT NULL,
  hash_archivo  TEXT NOT NULL,
  bytes         INT  NOT NULL,
  -- false = salió en claro. Se registra igual, y a propósito: si algún
  -- día falta la llave maestra y los informes salen sin cifrar, tiene que
  -- quedar constancia de cuáles fueron.
  cifrado       BOOLEAN NOT NULL DEFAULT false,
  periodo       TEXT,
  -- A qué se refiere (id de sesión, de viaje…). Texto y sin FK: el acuse
  -- sobrevive al borrado de lo que anotó.
  referencia    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entregas_proveedor ON entregas (proveedor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entregas_hash ON entregas (hash_archivo);
