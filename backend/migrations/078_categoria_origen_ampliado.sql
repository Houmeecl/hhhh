-- ============================================================
-- 078 — Dos valores más para `facturas.categoria_origen`
--
-- La migración 077 admitía solo 'glosa' | 'sin_coincidencia' | NULL. Faltan
-- dos casos que hoy se están guardando mal o no se pueden guardar:
--
--  · 'sin_categoria' — el motor NO tuvo qué clasificar. Pasa de verdad:
--    `calcularFactura` devuelve `categoria_codigo: null` y
--    `categoria_coincidencia: false` cuando todos los ítems se descartaron
--    (una nota de crédito, por ejemplo). Hoy eso se guarda como
--    'sin_coincidencia', y el panel del mandante le responde al cliente
--    "sin coincidencia en el motor", cuyo remedio documentado es "agregá la
--    palabra clave que falta". Es un consejo falso: no hay ítems que
--    clasificar y ninguna palabra clave va a cambiar eso.
--
--  · 'operador' — la categoría la asignó una persona en la bandeja de
--    revisión manual. Todavía NADIE escribe este valor: el CHECK se amplía
--    ahora para que la bandeja (con su asiento de ajuste encadenado, que no
--    reescribe el documento sellado) pueda escribirlo cuando exista.
--
-- SIN BACKFILL, por lo mismo que la 077: las filas ya guardadas como
-- 'sin_coincidencia' no distinguen los dos casos hacia atrás, y no hay forma
-- de saberlo. Se corrige hacia adelante.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS y luego ADD. Correr dos veces sobre
-- la misma base deja exactamente el mismo CHECK.
-- ============================================================

ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_categoria_origen_check;

ALTER TABLE facturas ADD CONSTRAINT facturas_categoria_origen_check
  CHECK (categoria_origen IS NULL OR categoria_origen IN
    ('glosa', 'sin_coincidencia', 'sin_categoria', 'operador'));
