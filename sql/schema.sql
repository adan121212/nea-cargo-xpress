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
    token_reset_password VARCHAR(255),
    token_reset_expira TIMESTAMP,
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
    firma_base64 TEXT, -- firma digital de entrega, guardada directo (sin subirla a ningún servicio externo)
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
    metodo_pago VARCHAR(20) CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia', 'pagueloFacil', 'yappy') OR metodo_pago IS NULL),
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

-- ============================================================================
-- Columnas y tablas agregadas después de la versión inicial del esquema.
-- (Mismo contenido que sql/migracion_dimensiones_y_caja.sql — se incluye aquí
-- para que crear la base desde cero con solo este archivo quede completo.)
-- Todo con IF NOT EXISTS: seguro de correr varias veces.
-- ============================================================================

-- Dimensiones de la caja + peso volumétrico (para tarifas por volumen).
ALTER TABLE paquetes
    ADD COLUMN IF NOT EXISTS largo_in NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS ancho_in NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS alto_in NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS peso_volumetrico_lb NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS peso_confirmado BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES sucursales(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS retirado_por_nombre VARCHAR(120),
    ADD COLUMN IF NOT EXISTS retirado_por_cedula VARCHAR(40);

-- RUC del cliente (para facturación).
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS ruc VARCHAR(40);

-- Cierres de caja diarios (un registro por día cerrado).
CREATE TABLE IF NOT EXISTS cierres_caja (
    id SERIAL PRIMARY KEY,
    fecha DATE NOT NULL UNIQUE,
    cerrado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    detalle_por_metodo JSONB NOT NULL DEFAULT '{}'::jsonb,
    total_general NUMERIC(12,2) NOT NULL DEFAULT 0,
    cantidad_facturas INTEGER NOT NULL DEFAULT 0,
    notas TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cierres_caja_fecha ON cierres_caja (fecha);

-- Tarifa inicial de ejemplo (ajusta los valores a tu negocio real).
INSERT INTO tarifas (nombre, precio_libra, cargo_minimo, cargo_manejo, pct_seguro, activa)
VALUES ('Aéreo estándar', 4.50, 8.00, 2.00, 1.5, TRUE)
ON CONFLICT DO NOTHING;

-- Reportes de problemas de paquetes (cliente reporta, admin gestiona).
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
