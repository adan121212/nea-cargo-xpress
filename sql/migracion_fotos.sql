-- Ejecuta esto en el SQL Editor de Neon si ya tenías la base de datos creada.
-- Si vas a crear la base desde cero, usa sql/schema.sql directamente.

CREATE TABLE IF NOT EXISTS paquete_fotos (
    id SERIAL PRIMARY KEY,
    paquete_id INTEGER NOT NULL REFERENCES paquetes(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    public_id VARCHAR(255),
    fecha_subida TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paquete_fotos_paquete ON paquete_fotos (paquete_id);
