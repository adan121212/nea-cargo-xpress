const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

const ESTADOS = ['solicitado', 'asignado', 'entregado', 'cancelado'];

const SELECT_BASE = `
  SELECT d.*,
         u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
         u.email AS cliente_email, u.numero_casillero,
         p.tienda, p.numero_tracking
  FROM deliveries d
  JOIN usuarios u ON u.id = d.usuario_id
  JOIN paquetes p ON p.id = d.paquete_id`;

// --- GET /api/admin/deliveries ---
router.get('/', [query('estado').optional().isIn(ESTADOS)], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
  try {
    const condiciones = [], valores = [];
    if (req.query.estado) {
      valores.push(req.query.estado);
      condiciones.push(`d.estado = $${valores.length}`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const r = await pool.query(`${SELECT_BASE} ${where} ORDER BY d.fecha_solicitud DESC LIMIT 200`, valores);

    const tot = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE estado = 'solicitado')::int AS pendientes,
         COUNT(*) FILTER (WHERE estado = 'asignado')::int   AS en_camino,
         COUNT(*) FILTER (WHERE estado = 'entregado' AND fecha_entregado::date = CURRENT_DATE)::int AS entregados_hoy,
         COALESCE(SUM(zona_precio) FILTER (WHERE estado = 'entregado' AND fecha_entregado::date = CURRENT_DATE), 0) AS cobrado_delivery_hoy
       FROM deliveries`
    );
    return res.json({ deliveries: r.rows, resumen: tot.rows[0] });
  } catch (error) {
    console.error('Error en GET /admin/deliveries:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar deliveries' });
  }
});

// --- PATCH /api/admin/deliveries/:id/asignar ---
router.patch(
  '/:id/asignar',
  [
    body('mensajero_nombre').trim().notEmpty().withMessage('Indica el nombre del mensajero'),
    body('mensajero_telefono').optional({ checkFalsy: true }).trim(),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const actual = await pool.query('SELECT estado FROM deliveries WHERE id = $1', [req.params.id]);
      if (actual.rows.length === 0) return res.status(404).json({ mensaje: 'Solicitud no encontrada' });
      if (actual.rows[0].estado !== 'solicitado') {
        return res.status(409).json({ mensaje: 'Esta solicitud ya no está pendiente de asignar.' });
      }
      await pool.query(
        `UPDATE deliveries
         SET estado = 'asignado', mensajero_nombre = $1, mensajero_telefono = $2, fecha_asignado = NOW()
         WHERE id = $3`,
        [req.body.mensajero_nombre.trim(), req.body.mensajero_telefono || null, req.params.id]
      );
      const completa = await pool.query(`${SELECT_BASE} WHERE d.id = $1`, [req.params.id]);
      return res.json({ mensaje: 'Mensajero asignado', delivery: completa.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/deliveries/:id/asignar:', error);
      return res.status(500).json({ mensaje: 'Error interno al asignar el mensajero' });
    }
  }
);

// --- PATCH /api/admin/deliveries/:id/entregado ---
router.patch('/:id/entregado', async (req, res) => {
  try {
    const actual = await pool.query('SELECT estado FROM deliveries WHERE id = $1', [req.params.id]);
    if (actual.rows.length === 0) return res.status(404).json({ mensaje: 'Solicitud no encontrada' });
    if (actual.rows[0].estado === 'entregado') {
      return res.status(409).json({ mensaje: 'Ya estaba marcado como entregado.' });
    }
    if (actual.rows[0].estado === 'cancelado') {
      return res.status(409).json({ mensaje: 'Esta solicitud está cancelada.' });
    }
    await pool.query(`UPDATE deliveries SET estado = 'entregado', fecha_entregado = NOW() WHERE id = $1`, [req.params.id]);
    const completa = await pool.query(`${SELECT_BASE} WHERE d.id = $1`, [req.params.id]);
    return res.json({ mensaje: 'Delivery marcado como entregado', delivery: completa.rows[0] });
  } catch (error) {
    console.error('Error en PATCH /admin/deliveries/:id/entregado:', error);
    return res.status(500).json({ mensaje: 'Error interno' });
  }
});

// --- PATCH /api/admin/deliveries/:id/cancelar ---
router.patch(
  '/:id/cancelar',
  [body('motivo').trim().notEmpty().withMessage('Indica el motivo de la cancelación')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const actual = await pool.query('SELECT estado FROM deliveries WHERE id = $1', [req.params.id]);
      if (actual.rows.length === 0) return res.status(404).json({ mensaje: 'Solicitud no encontrada' });
      if (actual.rows[0].estado === 'entregado') {
        return res.status(409).json({ mensaje: 'Ya fue entregado, no se puede cancelar.' });
      }
      await pool.query(
        `UPDATE deliveries SET estado = 'cancelado', motivo_cancelacion = $1 WHERE id = $2`,
        [req.body.motivo.trim(), req.params.id]
      );
      return res.json({ mensaje: 'Solicitud cancelada' });
    } catch (error) {
      console.error('Error en PATCH /admin/deliveries/:id/cancelar:', error);
      return res.status(500).json({ mensaje: 'Error interno al cancelar' });
    }
  }
);

module.exports = router;
