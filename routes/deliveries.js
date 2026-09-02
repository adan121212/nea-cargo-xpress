const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');
const router = express.Router();

// Todas las rutas de este archivo son del CLIENTE.
router.use(requiereAutenticacion);

const SELECT_BASE = `
  SELECT d.*, p.tienda, p.numero_tracking
  FROM deliveries d
  JOIN paquetes p ON p.id = d.paquete_id`;

// --- GET /api/deliveries --- (mis solicitudes)
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `${SELECT_BASE} WHERE d.usuario_id = $1 ORDER BY d.fecha_solicitud DESC`,
      [req.usuario.id]
    );
    return res.json({ deliveries: r.rows });
  } catch (error) {
    console.error('Error en GET /deliveries:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar tus deliveries' });
  }
});

// --- POST /api/deliveries --- (pedir delivery de un paquete listo_para_retiro)
router.post(
  '/',
  [
    body('paquete_id').isInt().withMessage('Paquete inválido'),
    body('telefono').trim().notEmpty().withMessage('Indica un teléfono de contacto'),
    body('direccion_texto').trim().notEmpty().withMessage('Indica la dirección de entrega'),
    body('latitud').optional({ checkFalsy: true }).isFloat(),
    body('longitud').optional({ checkFalsy: true }).isFloat(),
    body('referencia').optional({ checkFalsy: true }).trim(),
    body('zona_nombre').trim().notEmpty().withMessage('Falta la zona de entrega'),
    body('zona_precio').isFloat({ min: 0 }).withMessage('Precio de zona inválido'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const paquete = await pool.query(
        'SELECT id, estado FROM paquetes WHERE id = $1 AND usuario_id = $2',
        [req.body.paquete_id, req.usuario.id]
      );
      if (paquete.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      if (paquete.rows[0].estado !== 'listo_para_retiro') {
        return res.status(409).json({ mensaje: 'Solo puedes pedir delivery de paquetes listos para retiro.' });
      }

      const activa = await pool.query(
        `SELECT id FROM deliveries WHERE paquete_id = $1 AND estado NOT IN ('cancelado','entregado')`,
        [req.body.paquete_id]
      );
      if (activa.rows.length > 0) {
        return res.status(409).json({ mensaje: 'Ya tienes una solicitud de delivery activa para este paquete.' });
      }

      // El flete se calcula del lado del servidor, no se confía en lo que mande el cliente.
      const factura = await pool.query(
        `SELECT total FROM facturas WHERE paquete_id = $1 AND estado != 'anulada'
         ORDER BY fecha_creacion DESC LIMIT 1`,
        [req.body.paquete_id]
      );
      const flete = factura.rows.length > 0 ? Number(factura.rows[0].total) : 0;
      const zonaPrecio = Number(req.body.zona_precio);
      const total = flete + zonaPrecio;

      const r = await pool.query(
        `INSERT INTO deliveries (usuario_id, paquete_id, telefono, latitud, longitud,
                                  direccion_texto, referencia, zona_nombre, zona_precio, flete, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [req.usuario.id, req.body.paquete_id, req.body.telefono.trim(),
         req.body.latitud || null, req.body.longitud || null,
         req.body.direccion_texto.trim(), req.body.referencia || null,
         req.body.zona_nombre.trim(), zonaPrecio.toFixed(2), flete.toFixed(2), total.toFixed(2)]
      );
      const completa = await pool.query(`${SELECT_BASE} WHERE d.id = $1`, [r.rows[0].id]);
      return res.status(201).json({
        mensaje: 'Delivery solicitado. Te avisaremos cuando el mensajero esté en camino.',
        delivery: completa.rows[0],
      });
    } catch (error) {
      console.error('Error en POST /deliveries:', error);
      return res.status(500).json({ mensaje: 'Error interno al solicitar el delivery' });
    }
  }
);

// --- DELETE /api/deliveries/:id --- (cancelar, solo si sigue 'solicitado')
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE deliveries SET estado = 'cancelado', motivo_cancelacion = 'Cancelado por el cliente'
       WHERE id = $1 AND usuario_id = $2 AND estado = 'solicitado' RETURNING id`,
      [req.params.id, req.usuario.id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ mensaje: 'No se puede cancelar esta solicitud.' });
    }
    return res.status(204).send();
  } catch (error) {
    console.error('Error en DELETE /deliveries/:id:', error);
    return res.status(500).json({ mensaje: 'Error interno al cancelar' });
  }
});

module.exports = router;
