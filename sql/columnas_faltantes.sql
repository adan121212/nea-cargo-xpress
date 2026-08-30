-- ============================================================
-- Columnas que el sistema usa y que los archivos sql/ no crean
-- ============================================================
-- Se detectaron levantando el sistema desde cero contra una base
-- vacía: se fueron creando con ALTER TABLE directo en Neon a lo
-- largo del desarrollo y nunca se guardaron en el repo.
--
-- En la base de producción YA EXISTEN, así que correr esto ahí
-- no cambia nada (todo lleva IF NOT EXISTS).
--
-- Para qué sirve: si algún día hay que rearmar la base desde cero
-- (respaldo, copia de pruebas, mudanza de servidor), con solo los
-- archivos sql/ el sistema NO arranca. Este archivo cierra el hueco.
-- ============================================================

-- Registro de empresas
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tipo_cuenta TEXT DEFAULT 'personal';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nombre_contacto TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aviso_operacion_url TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aviso_operacion_public_id TEXT;

-- Cambio de contraseña: invalida los tokens viejos
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_valido_desde TIMESTAMP;

-- Desactivar clientes sin borrarlos
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fecha_desactivacion TIMESTAMP;

-- Firma de entrega guardada en Cloudinary
ALTER TABLE paquetes ADD COLUMN IF NOT EXISTS firma_url TEXT;
ALTER TABLE paquetes ADD COLUMN IF NOT EXISTS firma_public_id TEXT;

-- Sucursal donde el cliente retira
ALTER TABLE paquetes ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES sucursales(id) ON DELETE SET NULL;

-- Paquetes importados de PTY llegan sin dueño hasta asignarlos
ALTER TABLE paquetes ALTER COLUMN usuario_id DROP NOT NULL;

-- Auditoría de anulaciones
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS motivo_anulacion_detalle TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS anulada_por INTEGER REFERENCES usuarios(id);
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS fecha_anulacion TIMESTAMP;
