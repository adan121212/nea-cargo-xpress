-- Ejecuta esto en el SQL Editor de Neon.
-- Reemplaza el enfoque anterior (firma_url/firma_public_id vía Cloudinary)
-- por guardar la firma directo en la base de datos, sin depender de ningún
-- servicio externo. Si ya corriste la migración anterior de firma, esta la
-- deja correcta; si no, agrega todo lo necesario desde cero.

ALTER TABLE paquetes
    ADD COLUMN IF NOT EXISTS firma_base64 TEXT,
    ADD COLUMN IF NOT EXISTS fecha_entrega TIMESTAMP;

-- Las columnas anteriores (si las llegaste a crear) ya no se usan y se pueden
-- borrar opcionalmente. No es obligatorio, pero si quieres limpiar:
-- ALTER TABLE paquetes DROP COLUMN IF EXISTS firma_url;
-- ALTER TABLE paquetes DROP COLUMN IF EXISTS firma_public_id;
