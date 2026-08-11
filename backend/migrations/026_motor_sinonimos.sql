-- ============================================================
-- sicr3p — Sinónimos y marcas reales para el clasificador del motor propio.
--
-- Motivación: motorPropio.clasificar() hace substring matching contra
-- palabras_clave; hoy esas listas cubren el término genérico ("electric",
-- "combustible") pero no las marcas/abreviaturas que efectivamente
-- aparecen en la glosa de una factura chilena real (ej. "ENEL", "COPEC",
-- "STARKEN"). Esta migración solo AGREGA sinónimos a categorías ya
-- existentes — nunca crea categorías nuevas ni toca factores.
--
-- Idempotente: cada UPDATE solo agrega las palabras que todavía no están
-- en el array (comparación exacta, sin tildes ya resuelta por limpiar()
-- en tiempo de clasificación) y se puede correr many veces sin duplicar
-- (se re-ejecuta en cada arranque, igual que el resto de migrations/*.sql).
-- ============================================================

UPDATE motor_categorias SET
  palabras_clave = (SELECT array_agg(DISTINCT x) FROM unnest(
    palabras_clave || ARRAY['enel','cge','chilquinta','saesa','frontel','boleta de luz','cuenta de luz']
  ) x),
  updated_at = now()
WHERE codigo = 'electricidad';

UPDATE motor_categorias SET
  palabras_clave = (SELECT array_agg(DISTINCT x) FROM unnest(
    palabras_clave || ARRAY['copec','shell','petrobras','terpel','diesel b5','95 octanos','97 octanos','93 octanos']
  ) x),
  updated_at = now()
WHERE codigo = 'combustible';

UPDATE motor_categorias SET
  palabras_clave = (SELECT array_agg(DISTINCT x) FROM unnest(
    palabras_clave || ARRAY['starken','chilexpress','blue express','correos de chile','flete terrestre']
  ) x),
  updated_at = now()
WHERE codigo = 'transporte';

UPDATE motor_categorias SET
  palabras_clave = (SELECT array_agg(DISTINCT x) FROM unnest(
    palabras_clave || ARRAY['consumibles de oficina','cartucho de tinta','resma de papel']
  ) x),
  updated_at = now()
WHERE codigo = 'materiales';

UPDATE motor_categorias SET
  palabras_clave = (SELECT array_agg(DISTINCT x) FROM unnest(
    palabras_clave || ARRAY['mantenimiento','limpieza','consultoria','consultoría']
  ) x),
  updated_at = now()
WHERE codigo = 'servicios';

UPDATE motor_categorias SET
  palabras_clave = (SELECT array_agg(DISTINCT x) FROM unnest(
    palabras_clave || ARRAY['nuevosur','essal','aguas del valle']
  ) x),
  updated_at = now()
WHERE codigo = 'agua_potable';

UPDATE motor_categorias SET
  palabras_clave = (SELECT array_agg(DISTINCT x) FROM unnest(
    palabras_clave || ARRAY['garrafa','gas licuado de petroleo']
  ) x),
  updated_at = now()
WHERE codigo = 'glp';
