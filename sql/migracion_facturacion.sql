-- Ejecuta esto en el SQL Editor de Neon si ya tenías la base de datos creada
-- (por ejemplo, la que ya desplegaste). Si vas a crear la base desde cero,
-- usa sql/schema.sql directamente, ya incluye estos cambios.

ALTER TABLE paquetes
    ADD COLUMN IF NOT EXISTS peso_real_lb NUMERIC(6,2);

CREATE TABLE IF NOT EXISTS tarifas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    precio_libra NUMERIC(8,2) NOT NULL,
    cargo_minimo NUMERIC(8,2) NOT NULL DEFAULT 0,
    cargo_manejo NUMERIC(8,2) NOT NULL DEFAULT 0,
    pct_seguro NUMERIC(5,2) NOT NULL DEFAULT 0,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facturas (
    id SERIAL PRIMARY KEY,
    numero_factura VARCHAR(30) UNIQUE,
    paquete_id INTEGER NOT NULL REFERENCES paquetes(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tarifa_id INTEGER REFERENCES tarifas(id),
    peso_facturado_lb NUMERIC(6,2) NOT NULL,
    precio_libra NUMERIC(8,2) NOT NULL,
    costo_envio NUMERIC(10,2) NOT NULL,
    cargo_manejo NUMERIC(10,2) NOT NULL DEFAULT 0,
    seguro NUMERIC(10,2) NOT NULL DEFAULT 0,
    total NUMERIC(10,2) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada', 'anulada')),
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
    fecha_pago TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_factura_paquete_activa
    ON facturas (paquete_id) WHERE estado <> 'anulada';

CREATE INDEX IF NOT EXISTS idx_facturas_usuario ON facturas (usuario_id);

-- Crea una tarifa inicial de ejemplo (ajusta los valores a tu negocio real):
INSERT INTO tarifas (nombre, precio_libra, cargo_minimo, cargo_manejo, pct_seguro, activa)
VALUES ('Aéreo estándar', 4.50, 8.00, 2.00, 1.5, TRUE)
ON CONFLICT DO NOTHING;
