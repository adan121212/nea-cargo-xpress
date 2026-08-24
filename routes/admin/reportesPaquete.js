const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const router = express.Router();

router.use(requiereAutenticacion, requiereAdmin);

// --- GET /api/admin/reportes-paquete --- lista de reportes (opcional ?estado=)
router.get('/', async (req, res) => {
  try {
    const { estado } = req.query;
    const filtros = [];
    const params = [];
    if (estado && ['nuevo', 'en_proceso', 'resuelto'].includes(estado)) {
      params.push(estado);
      filtros.push(`r.estado = $${params.length}`);
    }
    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
    const resultado = await pool.query(
      `SELECT r.id, r.tipo, r.mensaje, r.estado, r.respuesta_admin, r.creado_en, r.actualizado_en,
              r.paquete_id,
              p.tienda, p.numero_tracking, p.numero_casillero AS pkg_casillero,
              u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
              u.email AS cliente_email, u.telefono AS cliente_telefono,
              u.numero_casillero
       FROM reportes_paquete r
       JOIN paquetes p ON p.id = r.paquete_id
       JOIN usuarios u ON u.id = r.usuario_id
       ${where}
       ORDER BY CASE r.estado WHEN 'nuevo' THEN 0 WHEN 'en_proceso' THEN 1 ELSE 2 END, r.creado_en DESC`,
      params
    );
    return res.json({ reportes: resultado.rows });
  } catch (error) {
    console.error('Error en GET /admin/reportes-paquete:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener los reportes' });
  }
});

// --- GET /api/admin/reportes-paquete/conteo --- cuántos nuevos (para el badge)
router.get('/conteo', async (req, res) => {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS nuevos FROM reportes_paquete WHERE estado = 'nuevo'`);
    return res.json({ nuevos: r.rows[0].nuevos });
  } catch (error) {
    return res.status(500).json({ mensaje: 'Error interno' });
  }
});

// --- PATCH /api/admin/reportes-paquete/:id --- responder / cambiar estado
router.patch(
  '/:id',
  [
    body('estado').optional().isIn(['nuevo', 'en_proceso', 'resuelto']),
    body('respuesta_admin').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const { estado, respuesta_admin } = req.body;
      const sets = ['actualizado_en = NOW()'];
      const params = [];
      if (estado) { params.push(estado); sets.push(`estado = $${params.length}`); }
      if (respuesta_admin !== undefined) { params.push(respuesta_admin || null); sets.push(`respuesta_admin = $${params.length}`); }
      params.push(req.params.id);
      const r = await pool.query(
        `UPDATE reportes_paquete SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, estado, respuesta_admin`,
        params
      );
      if (r.rows.length === 0) return res.status(404).json({ mensaje: 'Reporte no encontrado' });
      return res.json({ mensaje: 'Reporte actualizado', reporte: r.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/reportes-paquete/:id:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el reporte' });
    }
  }
);

module.exports = router;
