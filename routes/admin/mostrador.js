const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// --- GET /api/admin/mostrador/buscar?q=... ---
// Busca un cliente por número de casillero, correo, nombre, o por el tracking
// de uno de sus paquetes. Devuelve al cliente y todos sus paquetes NO entregados,
// cada uno con su factura más reciente (si tiene).
router.get(
  '/buscar',
  [query('q').trim().notEmpty().withMessage('Escribe un casillero, nombre, correo o tracking')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const q = `%${req.query.q}%`;

    try {
      const usuarioRes = await pool.query(
        `SELECT DISTINCT u.id, u.nombre, u.apellido, u.email, u.telefono, u.numero_casillero
         FROM usuarios u
         LEFT JOIN paquetes p ON p.usuario_id = u.id
         WHERE u.numero_casillero ILIKE $1
            OR u.email ILIKE $1
            OR (u.nombre || ' ' || u.apellido) ILIKE $1
            OR p.numero_tracking ILIKE $1
         LIMIT 5`,
        [q]
      );

      if (usuarioRes.rows.length === 0) {
        return res.status(404).json({ mensaje: 'No encontramos ningún cliente con esos datos.' });
      }

      // Si hay varias coincidencias (ej. nombre común), el staff elige cuál es.
      if (usuarioRes.rows.length > 1) {
        return res.json({ multiples: true, clientes: usuarioRes.rows });
      }

      const usuario = usuarioRes.rows[0];

      const paquetesRes = await pool.query(
        `SELECT p.*,
                f.id AS factura_id, f.numero_factura, f.total AS factura_total,
                f.estado AS factura_estado
         FROM paquetes p
         LEFT JOIN LATERAL (
           SELECT * FROM facturas
           WHERE paquete_id = p.id AND estado <> 'anulada'
           ORDER BY fecha_creacion DESC LIMIT 1
         ) f ON TRUE
         WHERE p.usuario_id = $1 AND p.estado <> 'entregado'
         ORDER BY p.fecha_prealerta DESC`,
        [usuario.id]
      );

      return res.json({ multiples: false, cliente: usuario, paquetes: paquetesRes.rows });
    } catch (error) {
      console.error('Error en GET /admin/mostrador/buscar:', error);
      return res.status(500).json({ mensaje: 'Error interno al buscar el cliente' });
    }
  }
);

// --- POST /api/admin/mostrador/entregar ---
// Entrega un paquete en mostrador. Si tiene una factura pendiente, la cobra
// (requiere metodo_pago) y la marca pagada en la misma operación.
router.post(
  '/entregar',
  [
    body('paquete_id').isInt().withMessage('paquete_id es obligatorio'),
    body('factura_id').optional({ nullable: true }).isInt(),
    body('metodo_pago').optional({ nullable: true }).isIn(['efectivo', 'tarjeta', 'transferencia']),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { paquete_id, factura_id, metodo_pago } = req.body;
    const client = await pool.connect();

    try {
      const paqueteRes = await client.query('SELECT * FROM paquetes WHERE id = $1', [paquete_id]);
      if (paqueteRes.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }
      if (paqueteRes.rows[0].estado === 'entregado') {
        return res.status(400).json({ mensaje: 'Este paquete ya fue entregado.' });
      }

      await client.query('BEGIN');

      if (factura_id) {
        const facturaRes = await client.query('SELECT * FROM facturas WHERE id = $1', [factura_id]);
        if (facturaRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ mensaje: 'Factura no encontrada' });
        }

        if (facturaRes.rows[0].estado === 'pendiente') {
          if (!metodo_pago) {
            await client.query('ROLLBACK');
            return res.status(400).json({ mensaje: 'Indica el método de pago (efectivo, tarjeta o transferencia) para cobrar esta factura.' });
          }
          await client.query(
            `UPDATE facturas SET estado = 'pagada', fecha_pago = NOW(), metodo_pago = $1 WHERE id = $2`,
            [metodo_pago, factura_id]
          );
        }
      }

      const actualizado = await client.query(
        `UPDATE paquetes SET estado = 'entregado', fecha_actualizacion = NOW() WHERE id = $1 RETURNING *`,
        [paquete_id]
      );

      await client.query('COMMIT');

      return res.json({ mensaje: 'Paquete entregado correctamente', paquete: actualizado.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en POST /admin/mostrador/entregar:', error);
      return res.status(500).json({ mensaje: 'Error interno al procesar la entrega' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
