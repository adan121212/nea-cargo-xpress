const express = require('express');
const { query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// --- GET /api/admin/reportes ---
// Resumen de operaciones en un rango de fechas.
// Query params opcionales: ?desde=2026-01-01&hasta=2026-01-31 (default: últimos 30 días)
router.get(
  '/',
  [
    query('desde').optional().isISO8601().withMessage('Fecha "desde" inválida'),
    query('hasta').optional().isISO8601().withMessage('Fecha "hasta" inválida'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const hasta = req.query.hasta ? new Date(req.query.hasta) : new Date();
    const desde = req.query.desde
      ? new Date(req.query.desde)
      : new Date(hasta.getTime() - 29 * 24 * 60 * 60 * 1000);

    // Incluye todo el día "hasta"
    const hastaFin = new Date(hasta);
    hastaFin.setHours(23, 59, 59, 999);

    try {
      const [
        ingresos,
        pendientes,
        paquetesNuevos,
        clientesNuevos,
        paquetesPorEstado,
        ingresosPorDia,
        topClientes,
      ] = await Promise.all([
        pool.query(
          `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
           FROM facturas
           WHERE estado = 'pagada' AND fecha_pago BETWEEN $1 AND $2`,
          [desde, hastaFin]
        ),
        pool.query(
          `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cantidad
           FROM facturas WHERE estado = 'pendiente'`
        ),
        pool.query(
          `SELECT COUNT(*) AS cantidad FROM paquetes
           WHERE fecha_prealerta BETWEEN $1 AND $2`,
          [desde, hastaFin]
        ),
        pool.query(
          `SELECT COUNT(*) AS cantidad FROM usuarios
           WHERE fecha_registro BETWEEN $1 AND $2`,
          [desde, hastaFin]
        ),
        pool.query(`SELECT estado, COUNT(*) AS cantidad FROM paquetes GROUP BY estado`),
        pool.query(
          `SELECT DATE(fecha_pago) AS dia, SUM(total) AS total
           FROM facturas
           WHERE estado = 'pagada' AND fecha_pago BETWEEN $1 AND $2
           GROUP BY DATE(fecha_pago)
           ORDER BY dia ASC`,
          [desde, hastaFin]
        ),
        pool.query(
          `SELECT u.id, u.nombre, u.apellido, u.email, COUNT(p.id) AS total_paquetes
           FROM usuarios u
           JOIN paquetes p ON p.usuario_id = u.id
           GROUP BY u.id
           ORDER BY total_paquetes DESC
           LIMIT 5`
        ),
      ]);

      return res.json({
        rango: { desde: desde.toISOString(), hasta: hastaFin.toISOString() },
        ingresos: ingresos.rows[0],
        pendientes: pendientes.rows[0],
        paquetes_nuevos: paquetesNuevos.rows[0].cantidad,
        clientes_nuevos: clientesNuevos.rows[0].cantidad,
        paquetes_por_estado: paquetesPorEstado.rows,
        ingresos_por_dia: ingresosPorDia.rows,
        top_clientes: topClientes.rows,
      });
    } catch (error) {
      console.error('Error en GET /admin/reportes:', error);
      return res.status(500).json({ mensaje: 'Error interno al generar el reporte' });
    }
  }
);

module.exports = router;
