-- La contabilidad financiera se gobierna como sección propia y privada.
-- Las cuentas existentes quedan fail-closed; el superadmin la ve y puede
-- asignarla explícitamente desde Usuarios y roles.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_secciones_admin_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_secciones_admin_check
  CHECK (secciones_admin <@ ARRAY[
    'dashboard','enrolar','clientes','sesiones','buscar','metricas','sii',
    'capital_natural','trazabilidad','transporte','corredor','origen',
    'capacitacion','apl','prospectos','auspiciadores','juego',
    'accesos_externos','motor_propio','motor_externo','usuarios','actividad',
    'datos_personales','proveedores','cobros','activos','contabilidad'
  ]::text[]);
