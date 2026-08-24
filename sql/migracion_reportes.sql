-- ============================================================================
-- Migración: reportes de problemas de paquetes.
-- El cliente puede reportar un problema con un paquete (no es mío, llegó
-- dañado, el peso/precio no cuadra, otro). El admin los ve y gestiona.
-- Seguro de correr varias veces (IF NOT EXISTS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS reportes_paquete (
    id SERIAL PRIMARY KEY,
    paquete_id INTEGER NOT NULL REFERENCES paquetes(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL
        CHECK (tipo IN ('no_reconozco', 'danado', 'peso_precio', 'otro')),
    mensaje TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'nuevo'
        CHECK (estado IN ('nuevo', 'en_proceso', 'resuelto')),
    respuesta_admin TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reportes_paquete ON reportes_paquete (paquete_id);
CREATE INDEX IF NOT EXISTS idx_reportes_usuario ON reportes_paquete (usuario_id);
CREATE INDEX IF NOT EXISTS idx_reportes_estado ON reportes_paquete (estado);
