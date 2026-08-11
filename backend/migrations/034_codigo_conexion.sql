-- Marca cuándo un código de acceso se usó por primera vez para ENTRAR
-- (validar el código en /prueba), distinto de cuándo consumió un crédito
-- (subir una factura). Hoy ambos eventos se confunden: `ultimo_uso` solo
-- se actualiza al consumir crédito, así que un prospecto que recibió el
-- código y ni lo probó se ve idéntico a uno que entró pero no llegó a
-- subir nada. `primera_conexion_at` resuelve eso para el panel admin.
ALTER TABLE codigos_acceso ADD COLUMN IF NOT EXISTS primera_conexion_at TIMESTAMPTZ;
