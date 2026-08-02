-- Crea la base de datos primero (fuera de este script):
-- CREATE DATABASE sistema_logistica;

CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    telefono VARCHAR(30),
    password_hash VARCHAR(255) NOT NULL,
    numero_casillero VARCHAR(20) UNIQUE,
    rol VARCHAR(20) NOT NULL DEFAULT 'cliente' CHECK (rol IN ('cliente', 'admin')),
    verificado BOOLEAN NOT NULL DEFAULT FALSE,
    token_verificacion VARCHAR(255),
    fecha_registro TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paquetes (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tienda VARCHAR(120) NOT NULL,
    numero_tracking VARCHAR(120) NOT NULL,
    descripcion TEXT,
    valor_declarado NUMERIC(10,2),
    peso_lb NUMERIC(6,2),
    peso_real_lb NUMERIC(6,2), -- peso confirmado por el staff al llegar a bodega, usado para facturar
    firma_url TEXT,
    firma_public_id VARCHAR(255),
    fecha_entrega TIMESTAMP,
    estado VARCHAR(30) NOT NULL DEFAULT 'prealertado'
        CHECK (estado IN (
            'prealertado',
            'en_bodega_miami',
            'en_transito',
            'en_panama',
            'listo_para_retiro',
            'entregado'
        )),
    fecha_prealerta TIMESTAMP NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email);
CREATE INDEX IF NOT EXISTS idx_usuarios_casillero ON usuarios (numero_casillero);
CREATE INDEX IF NOT EXISTS idx_paquetes_usuario ON paquetes (usuario_id);
CREATE INDEX IF NOT EXISTS idx_paquetes_tracking ON paquetes (numero_tracking);

CREATE TABLE IF NOT EXISTS sucursales (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    direccion VARCHAR(255) NOT NULL,
    telefono VARCHAR(30),
    horario VARCHAR(150),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tarifas (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL,
    precio_libra NUMERIC(8,2) NOT NULL,
    cargo_minimo NUMERIC(8,2) NOT NULL DEFAULT 0,
    cargo_manejo NUMERIC(8,2) NOT NULL DEFAULT 0,
    pct_seguro NUMERIC(5,2) NOT NULL DEFAULT 0, -- % sobre el valor declarado del paquete
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
    metodo_pago VARCHAR(20) CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia', 'pagueloFacil') OR metodo_pago IS NULL),
    token_pdf VARCHAR(64) UNIQUE,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
    fecha_pago TIMESTAMP
);

-- Evita facturar dos veces el mismo paquete mientras la factura esté activa
-- (si se anula, se puede volver a facturar).
CREATE UNIQUE INDEX IF NOT EXISTS idx_factura_paquete_activa
    ON facturas (paquete_id) WHERE estado <> 'anulada';

CREATE INDEX IF NOT EXISTS idx_facturas_usuario ON facturas (usuario_id);

CREATE TABLE IF NOT EXISTS paquete_fotos (
    id SERIAL PRIMARY KEY,
    paquete_id INTEGER NOT NULL REFERENCES paquetes(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    public_id VARCHAR(255),
    fecha_subida TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paquete_fotos_paquete ON paquete_fotos (paquete_id);

-- Tarifa inicial de ejemplo (ajusta los valores a tu negocio real).
INSERT INTO tarifas (nombre, precio_libra, cargo_minimo, cargo_manejo, pct_seguro, activa)
VALUES ('Aéreo estándar', 4.50, 8.00, 2.00, 1.5, TRUE)
ON CONFLICT DO NOTHING;
