-- ============================================================================
-- Agrega un campo de notas/observaciones libre a cada paquete.
-- Útil para casos como "favor a un amigo que no es cliente registrado",
-- o cualquier aclaración interna que no encaje en los demás campos.
-- Seguro de correr varias veces (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE paquetes
    ADD COLUMN IF NOT EXISTS notas TEXT;
