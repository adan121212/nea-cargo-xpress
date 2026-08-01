const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

const ESTADOS_VALIDOS = [
  'prealertado',
  'en_bodega_miami',
  'en_transito',
  'en_panama',
  'listo_para_retiro',
  'entregado',
];

// --- GET /api/admin/paquetes ---
// Lista TODOS los paquetes de TODOS los clientes, con filtros opcionales.
// Query params: ?estado=en_transito&email=ana@ejemplo.com&tracking=1Z999
router.get(
  '/',
  [
    query('estado').optional().isIn(ESTADOS_VALIDOS).withMessage('Estado inválido'),
    query('email').optional().trim(),
    query('tracking').optional().trim(),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { estado, email, tracking } = req.query;
    const condiciones = [];
    const valores = [];

    if (estado) {
      valores.push(estado);
      condiciones.push(`p.estado = $${valores.length}`);
    }
    if (email) {
      valores.push(`%${email}%`);
      condiciones.push(`u.email ILIKE $${valores.length}`);
    }
    if (tracking) {
      valores.push(`%${tracking}%`);
      condiciones.push(`p.numero_tracking ILIKE $${valores.length}`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    try {
      const resultado = await pool.query(
        `SELECT p.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                u.email AS cliente_email, u.numero_casillero
         FROM paquetes p
         JOIN usuarios u ON u.id = p.usuario_id
         ${where}
         ORDER BY p.fecha_prealerta DESC
         LIMIT 200`,
        valores
      );
      return res.json({ paquetes: resultado.rows });
    } catch (error) {
      console.error('Error en GET /admin/paquetes:', error);
      return res.status(500).json({ mensaje: 'Error interno al listar paquetes' });
    }
  }
);

// --- PATCH /api/admin/paquetes/:id/estado ---
// Actualiza el estado de un paquete (ej. cuando llega a bodega, sale a tránsito, etc.)
router.patch(
  '/:id/estado',
  [body('estado').isIn(ESTADOS_VALIDOS).withMessage('Estado inválido')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    try {
      const resultado = await pool.query(
        `UPDATE paquetes
         SET estado = $1, fecha_actualizacion = NOW()
         WHERE id = $2
         RETURNING *`,
        [req.body.estado, req.params.id]
      );

      if (resultado.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }

      return res.json({ mensaje: 'Estado actualizado', paquete: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/paquetes/:id/estado:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el estado' });
    }
  }
);

// --- PATCH /api/admin/paquetes/:id/peso ---
// El staff confirma el peso real al recibir el paquete en bodega (para facturar con precisión).
router.patch(
  '/:id/peso',
  [body('peso_real_lb').isFloat({ min: 0.01 }).withMessage('Ingresa un peso válido en libras')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    try {
      const resultado = await pool.query(
        `UPDATE paquetes SET peso_real_lb = $1, fecha_actualizacion = NOW()
         WHERE id = $2 RETURNING *`,
        [req.body.peso_real_lb, req.params.id]
      );

      if (resultado.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }

      return res.json({ mensaje: 'Peso actualizado', paquete: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/paquetes/:id/peso:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el peso' });
    }
  }
);

module.exports = router;
