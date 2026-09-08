DO $$
BEGIN
  ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
  ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('cliente', 'admin', 'trabajador'));
END $$;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos_admin TEXT[] NOT NULL DEFAULT '{}';
