const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// --- GET /api/admin/recepcion/buscar?tracking=... ---
router.get('/buscar', [
  query('tracking').trim().notEmpty().withMessage('El número de tracking es obligatorio'),
], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
  const tracking = req.query.tracking.trim();
  try {
    const resultado = await pool.query(
      `SELECT p.*,
              u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
              u.email AS cliente_email, u.telefono AS cliente_telefono,
              u.numero_casillero
       FROM paquetes p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.numero_tracking ILIKE $1
       ORDER BY p.fecha_prealerta DESC
       LIMIT 1`,
      [tracking]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ encontrado: false, tracking });
    }
    const paquete = resultado.rows[0];
    // Paquete importado desde PTY sin cliente asignado
    if (!paquete.usuario_id) {
      return res.json({
        encontrado: true,
        ya_recibido: false,
        sin_cliente: true,
        paquete,
      });
    }
    if (paquete.estado === 'en_bodega_miami' || paquete.estado === 'en_transito' ||
        paquete.estado === 'en_panama' || paquete.estado === 'listo_para_retiro' ||
        paquete.estado === 'entregado') {
      return res.json({ encontrado: true, ya_recibido: true, paquete });
    }
    return res.json({ encontrado: true, ya_recibido: false, paquete });
  } catch (error) {
    console.error('Error en GET /admin/recepcion/buscar:', error);
    return res.status(500).json({ mensaje: 'Error interno al buscar el tracking' });
  }
});

// --- POST /api/admin/recepcion/confirmar ---
router.post('/confirmar', [
  body('paquete_id').isInt().withMessage('paquete_id es obligatorio'),
], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
  try {
    const resultado = await pool.query(
      `UPDATE paquetes
       SET estado = 'listo_para_retiro', fecha_actualizacion = NOW()
       WHERE id = $1 AND estado = 'prealertado'
       RETURNING *`,
      [req.body.paquete_id]
    );
    if (resultado.rows.length === 0) {
      return res.status(400).json({ mensaje: 'El paquete no existe o ya fue recibido.' });
    }
    return res.json({ mensaje: 'Paquete recibido y listo para retiro', paquete: resultado.rows[0] });
  } catch (error) {
    console.error('Error en POST /admin/recepcion/confirmar:', error);
    return res.status(500).json({ mensaje: 'Error interno al confirmar la recepción' });
  }
});

// --- POST /api/admin/recepcion/asignar-cliente ---
// Asigna un cliente a un paquete importado de PTY (usuario_id era NULL)
router.post('/asignar-cliente', [
  body('paquete_id').isInt().withMessage('paquete_id es obligatorio'),
  body('usuario_id').isInt().withMessage('usuario_id es obligatorio'),
], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
  try {
    const resultado = await pool.query(
      `UPDATE paquetes
       SET usuario_id = $1, estado = 'listo_para_retiro', fecha_actualizacion = NOW()
       WHERE id = $2
       RETURNING *`,
      [req.body.usuario_id, req.body.paquete_id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Paquete no encontrado.' });
    }
    return res.json({ mensaje: 'Cliente asignado correctamente', paquete: resultado.rows[0] });
  } catch (error) {
    console.error('Error en POST /admin/recepcion/asignar-cliente:', error);
    return res.status(500).json({ mensaje: 'Error interno al asignar cliente' });
  }
});

// --- POST /api/admin/recepcion/crear ---
router.post('/crear', [
  body('usuario_id').isInt().withMessage('usuario_id es obligatorio'),
  body('numero_tracking').trim().notEmpty().withMessage('El tracking es obligatorio'),
  body('tienda').trim().notEmpty().withMessage('La tienda es obligatoria'),
  body('valor_declarado').isFloat({ min: 0 }).withMessage('El valor declarado es obligatorio'),
  body('peso_lb').optional({ checkFalsy: true }).isFloat({ min: 0 }),
], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
  const { usuario_id, numero_tracking, tienda, valor_declarado, peso_lb, descripcion } = req.body;
  try {
    const resultado = await pool.query(
      `INSERT INTO paquetes
         (usuario_id, numero_tracking, tienda, valor_declarado, peso_lb, descripcion, estado, fecha_actualizacion)
       VALUES ($1, $2, $3, $4, $5, $6, 'listo_para_retiro', NOW())
       RETURNING *`,
      [usuario_id, numero_tracking, tienda, valor_declarado, peso_lb || null, descripcion || null]
    );
    return res.status(201).json({ mensaje: 'Paquete creado y listo para retiro', paquete: resultado.rows[0] });
  } catch (error) {
    console.error('Error en POST /admin/recepcion/crear:', error);
    return res.status(500).json({ mensaje: 'Error interno al crear el paquete' });
  }
});

module.exports = router;
