-- ============================================================
-- REVERTIR ENTREGA — NEA Cargo Xpress
-- ============================================================
-- Úsalo SOLO cuando un paquete se marcó "entregado" por error.
-- El sistema (la app) bloquea este cambio a propósito, así que
-- esto es la puerta trasera para casos de excepción, corriéndolo
-- directo en la base de datos.
--
-- Cómo usarlo: copia el bloque que necesites al SQL Editor de
-- Neon, reemplaza los valores de ejemplo por los reales, y dale Run.
-- ============================================================


-- ------------------------------------------------------------
-- PASO 1 (opcional): buscar el id del paquete por su tracking,
-- si no lo sabes de memoria.
-- ------------------------------------------------------------
SELECT id, numero_tracking, estado, fecha_entrega
FROM paquetes
WHERE numero_tracking = 'PON_AQUI_EL_TRACKING';


-- ------------------------------------------------------------
-- PASO 2A: revertir el estado, dejando la fecha de entrega y la
-- firma como estaban (útil si solo quieres poder seguir
-- moviéndolo de estado, pero sabes que sí se entregó).
-- ------------------------------------------------------------
UPDATE paquetes
SET estado = 'listo_para_retiro'   -- o el estado que corresponda
WHERE id = 123;                     -- <-- pon aquí el id real


-- ------------------------------------------------------------
-- PASO 2B: revertir por completo, como si nunca se hubiera
-- entregado (borra fecha de entrega y firma también). Usa este
-- si el "entregado" fue un error total, no un dato real.
-- ------------------------------------------------------------
UPDATE paquetes
SET estado = 'listo_para_retiro',   -- o el estado que corresponda
    fecha_entrega = NULL,
    firma_base64 = NULL
WHERE id = 123;                     -- <-- pon aquí el id real


-- ------------------------------------------------------------
-- Nota: este cambio NO dispara el correo/WhatsApp automático al
-- cliente (esas notificaciones solo se disparan cuando el cambio
-- viene de la API/panel admin, no de una consulta SQL directa).
-- Si el cliente necesita saber algo, avísale tú manualmente.
-- ------------------------------------------------------------
