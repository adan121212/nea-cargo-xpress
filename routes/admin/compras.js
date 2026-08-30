const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { enviarCorreoGenerico } = require('../../utils/mailer');
const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

const ZONA = 'America/Panama';
const ESTADOS = ['solicitada', 'comprada', 'pagada', 'cancelada'];
const METODOS = ['efectivo', 'tarjeta', 'transferencia', 'yappy'];
const COMISION_DEFECTO = 5.00;

const SELECT_BASE = `
  SELECT c.*,
         u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
         u.email AS cliente_email, u.telefono AS cliente_telefono,
         u.numero_casillero,
         r.nombre AS registrada_por_nombre
  FROM compras c
  JOIN usuarios u ON u.id = c.usuario_id
  LEFT JOIN usuarios r ON r.id = c.registrada_por`;

// --- GET /api/admin/compras ---
router.get(
  '/',
  [query('estado').optional().isIn(ESTADOS), query('q').optional().trim()],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const condiciones = [], valores = [];
    if (req.query.estado) {
      valores.push(req.query.estado);
      condiciones.push(`c.estado = $${valores.length}`);
    }
    if (req.query.q) {
      valores.push(`%${req.query.q}%`);
      const n = valores.length;
      condiciones.push(`(u.nombre ILIKE $${n} OR u.apellido ILIKE $${n} OR u.email ILIKE $${n}
                        OR u.numero_casillero ILIKE $${n} OR c.tienda ILIKE $${n}
                        OR c.descripcion ILIKE $${n} OR c.numero_orden ILIKE $${n}
                        OR c.numero_tracking ILIKE $${n})`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    try {
      const r = await pool.query(
        `${SELECT_BASE} ${where} ORDER BY c.fecha_solicitud DESC LIMIT 200`, valores
      );

      // Totales útiles para la cabecera
      const tot = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE estado = 'solicitada')::int AS por_comprar,
           COUNT(*) FILTER (WHERE estado = 'comprada')::int   AS por_cobrar,
           COALESCE(SUM(total_cobrado) FILTER (WHERE estado = 'comprada'), 0) AS monto_por_cobrar,
           COALESCE(SUM(monto_producto) FILTER (WHERE estado IN ('comprada')), 0) AS adelantado_tarjeta
         FROM compras`
      );

      return res.json({ compras: r.rows, resumen: tot.rows[0] });
    } catch (error) {
      console.error('Error en GET /admin/compras:', error);
      return res.status(500).json({ mensaje: 'Error interno al listar las compras' });
    }
  }
);

// --- POST /api/admin/compras ---
// Registra la solicitud del cliente.
router.post(
  '/',
  [
    body('usuario_id').isInt().withMessage('Selecciona un cliente'),
    body('tienda').trim().notEmpty().withMessage('Indica la tienda'),
    body('descripcion').trim().notEmpty().withMessage('Describe qué se va a comprar'),
    body('monto_producto').isFloat({ min: 0.01 }).withMessage('El monto del producto debe ser mayor que cero'),
    body('comision').optional().isFloat({ min: 0 }),
    body('enlace').optional({ checkFalsy: true }).trim(),
    body('notas').optional({ checkFalsy: true }).trim(),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const monto = Number(req.body.monto_producto);
    const comision = req.body.comision !== undefined ? Number(req.body.comision) : COMISION_DEFECTO;
    const total = monto + comision;
    try {
      const cliente = await pool.query('SELECT id FROM usuarios WHERE id = $1', [req.body.usuario_id]);
      if (cliente.rows.length === 0) return res.status(404).json({ mensaje: 'Cliente no encontrado' });

      const r = await pool.query(
        `INSERT INTO compras (usuario_id, tienda, descripcion, enlace,
                              monto_producto, comision, total_cobrado,
                              notas, registrada_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [req.body.usuario_id, req.body.tienda.trim(), req.body.descripcion.trim(),
         req.body.enlace || null, monto.toFixed(2), comision.toFixed(2), total.toFixed(2),
         req.body.notas || null, req.usuario.id]
      );
      const completa = await pool.query(`${SELECT_BASE} WHERE c.id = $1`, [r.rows[0].id]);
      return res.status(201).json({ mensaje: 'Solicitud de compra registrada', compra: completa.rows[0] });
    } catch (error) {
      console.error('Error en POST /admin/compras:', error);
      return res.status(500).json({ mensaje: 'Error interno al registrar la compra' });
    }
  }
);

// --- PATCH /api/admin/compras/:id/comprada ---
// Ya se pagó con la tarjeta de la empresa.
router.patch(
  '/:id/comprada',
  [
    body('numero_orden').trim().notEmpty().withMessage('Ingresa el número de orden de la tienda'),
    body('numero_tracking').optional({ checkFalsy: true }).trim(),
    body('monto_producto').optional().isFloat({ min: 0.01 }),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const actual = await pool.query('SELECT * FROM compras WHERE id = $1', [req.params.id]);
      if (actual.rows.length === 0) return res.status(404).json({ mensaje: 'Compra no encontrada' });
      if (actual.rows[0].estado !== 'solicitada') {
        return res.status(409).json({ mensaje: 'Esta compra ya no está pendiente de comprar.' });
      }

      // El precio final a veces cambia (impuestos, envío interno). Se puede ajustar aquí.
      const monto = req.body.monto_producto !== undefined
        ? Number(req.body.monto_producto)
        : Number(actual.rows[0].monto_producto);
      const total = monto + Number(actual.rows[0].comision);

      await pool.query(
        `UPDATE compras
         SET estado = 'comprada', numero_orden = $1, numero_tracking = $2,
             monto_producto = $3, total_cobrado = $4,
             fecha_compra = NOW(), comprada_por = $5
         WHERE id = $6`,
        [req.body.numero_orden.trim(), req.body.numero_tracking || null,
         monto.toFixed(2), total.toFixed(2), req.usuario.id, req.params.id]
      );
      const completa = await pool.query(`${SELECT_BASE} WHERE c.id = $1`, [req.params.id]);
      return res.json({ mensaje: 'Compra registrada como comprada', compra: completa.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/compras/:id/comprada:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar la compra' });
    }
  }
);

// --- PATCH /api/admin/compras/:id/pagada ---
// El cliente reembolsó el producto y pagó la comisión.
// A partir de aquí los $5 cuentan como venta del día.
router.patch(
  '/:id/pagada',
  [body('metodo_pago').isIn(METODOS).withMessage('Método de pago inválido')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const actual = await pool.query('SELECT * FROM compras WHERE id = $1', [req.params.id]);
      if (actual.rows.length === 0) return res.status(404).json({ mensaje: 'Compra no encontrada' });
      const c = actual.rows[0];
      if (c.estado === 'pagada') return res.status(409).json({ mensaje: 'Esta compra ya está pagada.' });
      if (c.estado === 'cancelada') return res.status(409).json({ mensaje: 'Esta compra está cancelada.' });
      if (c.estado !== 'comprada') {
        return res.status(409).json({ mensaje: 'Primero marca la compra como comprada.' });
      }

      await pool.query(
        `UPDATE compras SET estado = 'pagada', metodo_pago = $1, fecha_pago = NOW() WHERE id = $2`,
        [req.body.metodo_pago, req.params.id]
      );
      const completa = await pool.query(`${SELECT_BASE} WHERE c.id = $1`, [req.params.id]);
      return res.json({
        mensaje: `Cobrado. A caja entran $${Number(c.comision).toFixed(2)} por servicio de compras.`,
        compra: completa.rows[0],
      });
    } catch (error) {
      console.error('Error en PATCH /admin/compras/:id/pagada:', error);
      return res.status(500).json({ mensaje: 'Error interno al cobrar la compra' });
    }
  }
);

// --- PATCH /api/admin/compras/:id/cancelar ---
router.patch(
  '/:id/cancelar',
  [body('motivo').trim().notEmpty().withMessage('Indica el motivo de la cancelación')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const actual = await pool.query('SELECT estado FROM compras WHERE id = $1', [req.params.id]);
      if (actual.rows.length === 0) return res.status(404).json({ mensaje: 'Compra no encontrada' });
      if (actual.rows[0].estado === 'pagada') {
        return res.status(409).json({ mensaje: 'Esta compra ya fue pagada. No se puede cancelar desde aquí.' });
      }
      await pool.query(
        `UPDATE compras SET estado = 'cancelada', motivo_cancelacion = $1 WHERE id = $2`,
        [req.body.motivo.trim(), req.params.id]
      );
      return res.json({ mensaje: 'Compra cancelada' });
    } catch (error) {
      console.error('Error en PATCH /admin/compras/:id/cancelar:', error);
      return res.status(500).json({ mensaje: 'Error interno al cancelar la compra' });
    }
  }
);

// --- GET /api/admin/compras/tarjeta ---
// Cuánto se ha adelantado con la tarjeta y no se ha recuperado.
// Sirve para cuadrar contra el estado de cuenta.
router.get('/tarjeta', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         COALESCE(SUM(monto_producto) FILTER (WHERE estado = 'comprada'), 0) AS pendiente_recuperar,
         COUNT(*) FILTER (WHERE estado = 'comprada')::int AS compras_pendientes,
         COALESCE(SUM(monto_producto) FILTER (WHERE estado = 'pagada'), 0) AS ya_recuperado,
         COALESCE(SUM(comision) FILTER (WHERE estado = 'pagada'), 0) AS comisiones_ganadas,
         COALESCE(SUM(monto_producto) FILTER (
           WHERE estado IN ('comprada','pagada')
             AND (fecha_compra AT TIME ZONE 'UTC' AT TIME ZONE '${ZONA}')::date
                 >= date_trunc('month', (NOW() AT TIME ZONE '${ZONA}'))::date
         ), 0) AS gastado_este_mes
       FROM compras`
    );
    return res.json(r.rows[0]);
  } catch (error) {
    console.error('Error en GET /admin/compras/tarjeta:', error);
    return res.status(500).json({ mensaje: 'Error interno al calcular el estado de la tarjeta' });
  }
});

module.exports = router;
