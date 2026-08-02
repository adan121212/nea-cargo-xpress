-- ============================================================
-- BLANQUEAR BASE DE DATOS — NEA Cargo Xpress
-- ============================================================
-- ADVERTENCIA: Este script BORRA TODOS LOS DATOS de forma
-- permanente (usuarios, paquetes, facturas, tarifas, sucursales,
-- fotos). La ESTRUCTURA de las tablas se mantiene intacta —
-- después de correrlo, el sistema queda como recién instalado,
-- listo para empezar de cero.
--
-- NO hay forma de deshacer esto. Si tienes datos reales de
-- clientes, haz un respaldo antes (Neon permite branches /
-- point-in-time restore desde su panel).
--
-- Cómo usarlo: copia y pega todo esto en el SQL Editor de Neon,
-- y dale Run.
-- ============================================================

TRUNCATE TABLE
    usuarios,
    paquetes,
    paquete_fotos,
    tarifas,
    facturas,
    sucursales
RESTART IDENTITY CASCADE;

-- RESTART IDENTITY reinicia los contadores de ID (el próximo
-- usuario será id=1, el próximo paquete id=1, etc.) — así los
-- números de casillero y de factura también vuelven a empezar
-- desde PN-00001 / FAC-000001.

-- Opcional: vuelve a crear una tarifa de ejemplo para poder
-- probar el sistema de inmediato (ajusta los valores a los tuyos
-- reales, o bórralo si prefieres crearla tú mismo desde el panel).
INSERT INTO tarifas (nombre, precio_libra, cargo_minimo, cargo_manejo, pct_seguro, activa)
VALUES ('Aéreo estándar', 4.50, 8.00, 2.00, 1.5, TRUE);

-- ============================================================
-- Después de correr esto, recuerda:
-- 1. Registrar de nuevo tu(s) cuenta(s) de administrador desde
--    la página principal (ya no existe ningún usuario).
-- 2. Convertirte en admin otra vez con:
--    UPDATE usuarios SET rol = 'admin' WHERE email = 'tu_correo@ejemplo.com';
-- 3. Volver a crear tus sucursales desde el panel admin.
-- ============================================================
