-- ============================================================
-- El adhesivo se vuelve imprimible: sección propia y patente indexada.
--
-- La tabla `activos` (109) existía sin ninguna forma de llenarla que no
-- fuera SQL a mano, y el generador del PDF no tenía quien lo llamara. Esta
-- migración abre el camino de administración.
--
-- 'activos' es SECCIÓN PROPIA y no un rincón de 'proveedores'. Quien
-- imprime adhesivos ve la patente de la flota completa de las empresas del
-- piloto —dato que identifica móviles— y eso es justamente lo que una
-- cuenta de soporte comercial no tiene por qué ver. Aditiva: nadie la
-- tiene, empieza en 0 cuentas.
--
-- migrate.js corre todos los .sql en cada arranque: todo idempotente.
-- ============================================================

DO $$
BEGIN
  ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_secciones_admin_check;
  ALTER TABLE usuarios ADD CONSTRAINT usuarios_secciones_admin_check
    CHECK (secciones_admin <@ ARRAY[
      'dashboard','enrolar','clientes','sesiones','buscar','metricas','sii',
      'capital_natural','trazabilidad','transporte','corredor','origen',
      'capacitacion','apl','prospectos','auspiciadores','juego',
      'accesos_externos','motor_propio','motor_externo','usuarios','actividad',
      'datos_personales','proveedores','cobros','activos'
    ]::text[]);
END $$;

-- La patente se busca al dar de alta ("¿esta camioneta ya está?") y el
-- índice es PARCIAL porque la columna es opcional: una grúa de patio no
-- tiene patente y no tiene por qué ocupar lugar en el índice.
--
-- NO es único. Dos filas pueden compartir patente legítimamente: el mismo
-- móvil auditado en dos contratos distintos lleva dos adhesivos, uno por
-- expediente. Un UNIQUE acá obligaría a elegir cuál de los dos contratos
-- "es" el de la camioneta, que es una pregunta sin respuesta.
CREATE INDEX IF NOT EXISTS activos_patente_idx
  ON activos (identificador_interno)
  WHERE identificador_interno IS NOT NULL;

COMMENT ON COLUMN activos.identificador_interno IS
  'Patente o identificador de flota. Se IMPRIME en el adhesivo (al lado de la placa, no revela nada) y NUNCA sale por GET /api/activo/:codigo (ahí sí sería un directorio de qué móvil es de qué empresa auditada). Ver services/activo.js: activoPublico vs activoParaImpresion.';
