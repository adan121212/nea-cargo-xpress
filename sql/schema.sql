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
