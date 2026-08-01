-- Ejecuta esto SOLO si ya habías creado la base de datos antes de esta versión
-- (por ejemplo, la que ya desplegaste en Neon/Render).
-- Si vas a crear la base de datos desde cero, usa sql/schema.sql directamente,
-- ya incluye estos cambios.

ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS rol VARCHAR(20) NOT NULL DEFAULT 'cliente';

-- Agrega la restricción de valores permitidos si aún no existe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_rol_check'
    ) THEN
        ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('cliente', 'admin'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS sucursales (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(120) NOT NULL,
    direccion VARCHAR(255) NOT NULL,
    telefono VARCHAR(30),
    horario VARCHAR(150),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Para convertir tu propia cuenta en administrador, ejecuta (con tu correo real):
-- UPDATE usuarios SET rol = 'admin' WHERE email = 'tu_correo@ejemplo.com';
