const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { enviarCorreoCambioEstado } = require('../../utils/mailer');
const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// --- GET /api/admin/recepcion/buscar?tracking=... ---
// Busca si existe una prealerta con ese número de tracking.
// Si existe → devuelve el paquete y el cliente.
// Si no existe → devuelve not_found para que el admin cree el paquete manualmente.
router.get('/buscar', [
  query('tracking').trim().notEmpty().withMessage('El número de tracking es obligatorio'),
], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });

  const tracking = req.query.tracking.trim();

  try {
    const resultado = await pool.query(
      `SELECT p.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
              u.email AS cliente_email, u.telefono AS cliente_telefono,
              u.numero_casillero
       FROM paquetes p
       JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.numero_tracking ILIKE $1
       ORDER BY p.fecha_prealerta DESC
       LIMIT 1`,
      [tracking]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ encontrado: false, tracking });
    }

    const paquete = resultado.rows[0];

    if (paquete.estado === 'en_bodega_miami' || paquete.estado === 'en_transito' ||
        paquete.estado === 'en_panama' || paquete.estado === 'listo_para_retiro' ||
        paquete.estado === 'entregado') {
      return res.json({
        encontrado: true,
        ya_recibido: true,
        paquete,
      });
    }

    return res.json({ encontrado: true, ya_recibido: false, paquete });
  } catch (error) {
    console.error('Error en GET /admin/recepcion/buscar:', error);
    return res.status(500).json({ mensaje: 'Error interno al buscar el tracking' });
  }
});

// --- POST /api/admin/recepcion/confirmar ---
// Confirma la llegada de un paquete prealertado → lo pasa a en_bodega_miami.
router.post('/confirmar', [
  body('paquete_id').isInt().withMessage('paquete_id es obligatorio'),
], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });

  try {
    const resultado = await pool.query(
      `UPDATE paquetes
       SET estado = 'en_bodega_miami', fecha_actualizacion = NOW()
       WHERE id = $1 AND estado = 'prealertado'
       RETURNING *`,
      [req.body.paquete_id]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).json({ mensaje: 'El paquete no existe o ya fue recibido.' });
    }

    const paquete = resultado.rows[0];

    // Notifica al cliente por correo (solo si está en bodega miami — ya filtrado en mailer.js)
    try {
      const datosCliente = await pool.query(
        'SELECT nombre, email FROM usuarios WHERE id = $1',
        [paquete.usuario_id]
      );
      if (datosCliente.rows.length > 0) {
        await enviarCorreoCambioEstado(
          datosCliente.rows[0].email,
          datosCliente.rows[0].nombre,
          paquete
        );
      }
    } catch (errorCorreo) {
      console.error('Error enviando correo de recepción:', errorCorreo);
    }

    return res.json({ mensaje: 'Paquete recibido en bodega Miami', paquete });
  } catch (error) {
    console.error('Error en POST /admin/recepcion/confirmar:', error);
    return res.status(500).json({ mensaje: 'Error interno al confirmar la recepción' });
  }
});

// --- POST /api/admin/recepcion/crear ---
// Crea un paquete sin prealerta y lo pasa directo a en_bodega_miami.
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
       VALUES ($1, $2, $3, $4, $5, $6, 'en_bodega_miami', NOW())
       RETURNING *`,
      [usuario_id, numero_tracking, tienda, valor_declarado, peso_lb || null, descripcion || null]
    );

    const paquete = resultado.rows[0];

    try {
      const datosCliente = await pool.query(
        'SELECT nombre, email FROM usuarios WHERE id = $1',
        [usuario_id]
      );
      if (datosCliente.rows.length > 0) {
        await enviarCorreoCambioEstado(
          datosCliente.rows[0].email,
          datosCliente.rows[0].nombre,
          paquete
        );
      }
    } catch (errorCorreo) {
      console.error('Error enviando correo de recepción (sin prealerta):', errorCorreo);
    }

    return res.status(201).json({ mensaje: 'Paquete creado y marcado en bodega Miami', paquete });
  } catch (error) {
    console.error('Error en POST /admin/recepcion/crear:', error);
    return res.status(500).json({ mensaje: 'Error interno al crear el paquete' });
  }
});

// --- PATCH /api/admin/recepcion/:id/dimensiones ---
// Guarda las dimensiones del paquete y calcula el peso volumétrico.
// Fórmula estándar de carga aérea: (largo × ancho × alto en pulgadas) / 139.
// El peso real del paquete queda como el MAYOR entre el peso ya registrado
// y el volumétrico calculado — así nunca se subcobra un paquete grande y liviano.
router.patch('/:id/dimensiones', [
  body('largo_in').isFloat({ min: 0.1 }).withMessage('El largo es obligatorio'),
  body('ancho_in').isFloat({ min: 0.1 }).withMessage('El ancho es obligatorio'),
  body('alto_in').isFloat({ min: 0.1 }).withMessage('El alto es obligatorio'),
], async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });

  const { largo_in, ancho_in, alto_in } = req.body;
  const pesoVolumetrico = (Number(largo_in) * Number(ancho_in) * Number(alto_in)) / 139;

  try {
    const actual = await pool.query('SELECT peso_real_lb, peso_lb FROM paquetes WHERE id = $1', [req.params.id]);
    if (actual.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });

    const pesoActual = Number(actual.rows[0].peso_real_lb || actual.rows[0].peso_lb || 0);
    const pesoFinal = Math.max(pesoActual, pesoVolumetrico);

    const resultado = await pool.query(
      `UPDATE paquetes
       SET largo_in = $1, ancho_in = $2, alto_in = $3,
           peso_volumetrico_lb = $4, peso_real_lb = $5,
           fecha_actualizacion = NOW()
       WHERE id = $6
       RETURNING *`,
      [largo_in, ancho_in, alto_in, pesoVolumetrico.toFixed(2), pesoFinal.toFixed(2), req.params.id]
    );

    return res.json({ mensaje: 'Dimensiones guardadas', paquete: resultado.rows[0], peso_volumetrico: pesoVolumetrico.toFixed(2) });
  } catch (error) {
    console.error('Error en PATCH /admin/recepcion/:id/dimensiones:', error);
    return res.status(500).json({ mensaje: 'Error interno al guardar dimensiones' });
  }
});

module.exports = router;
