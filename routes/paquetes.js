const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');
const router = express.Router();

// Columnas que se devuelven al cliente (nunca firma_base64: rompe el JSON)
const COLS = `p.id, p.usuario_id, p.tienda, p.numero_tracking, p.descripcion, p.valor_declarado,
              p.peso_lb, p.peso_real_lb, p.peso_confirmado, p.estado,
              p.largo_in, p.ancho_in, p.alto_in, p.peso_volumetrico_lb,
              p.fecha_prealerta, p.fecha_actualizacion, p.fecha_entrega,
              p.firma_url, p.retirado_por_nombre, p.retirado_por_cedula,
              p.sucursal_id,
              s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
              s.telefono AS sucursal_telefono, s.horario AS sucursal_horario`;

// --- POST /api/paquetes/prealertar ---
router.post(
  '/prealertar',
  requiereAutenticacion,
  [
    body('tienda').trim().notEmpty().withMessage('Indica la tienda donde compraste'),
    body('numero_tracking').trim().notEmpty().withMessage('El número de tracking es obligatorio'),
    body('descripcion').optional({ checkFalsy: true }).trim(),
    body('valor_declarado').isFloat({ min: 0 }).withMessage('El valor declarado debe ser un número positivo'),
    body('peso_lb').optional({ checkFalsy: true }).isFloat({ min: 0 }),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const { tienda, numero_tracking, descripcion, valor_declarado, peso_lb } = req.body;
    try {
      const resultado = await pool.query(
        `INSERT INTO paquetes (usuario_id, tienda, numero_tracking, descripcion, valor_declarado, peso_lb)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.usuario.id, tienda, numero_tracking, descripcion || null, valor_declarado, peso_lb || null]
      );
      return res.status(201).json({
        mensaje: 'Paquete prealertado correctamente. Te avisaremos cuando llegue a la bodega.',
        paquete: resultado.rows[0],
      });
    } catch (error) {
      console.error('Error en /paquetes/prealertar:', error);
      return res.status(500).json({ mensaje: 'Error interno al prealertar el paquete' });
    }
  }
);

// --- GET /api/paquetes ---
router.get('/', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT ${COLS}
       FROM paquetes p
       LEFT JOIN sucursales s ON s.id = p.sucursal_id
       WHERE p.usuario_id = $1
       ORDER BY p.fecha_prealerta DESC`,
      [req.usuario.id]
    );
    return res.json({ paquetes: resultado.rows });
  } catch (error) {
    console.error('Error en GET /paquetes:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar paquetes' });
  }
});

// --- DELETE /api/paquetes/:id --- (solo prealertados)
router.delete('/:id', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `DELETE FROM paquetes WHERE id = $1 AND usuario_id = $2 AND estado = 'prealertado' RETURNING id`,
      [req.params.id, req.usuario.id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Paquete no encontrado o ya no se puede cancelar.' });
    }
    return res.status(204).send();
  } catch (error) {
    console.error('Error en DELETE /paquetes/:id:', error);
    return res.status(500).json({ mensaje: 'Error interno al cancelar la prealerta' });
  }
});

// --- GET /api/paquetes/:id ---
router.get('/:id', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT ${COLS}
       FROM paquetes p
       LEFT JOIN sucursales s ON s.id = p.sucursal_id
       WHERE p.id = $1 AND p.usuario_id = $2`,
      [req.params.id, req.usuario.id]
    );
    if (resultado.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
    return res.json({ paquete: resultado.rows[0] });
  } catch (error) {
    console.error('Error en GET /paquetes/:id:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener el paquete' });
  }
});

// --- GET /api/paquetes/:id/fotos ---
router.get('/:id/fotos', requiereAutenticacion, async (req, res) => {
  try {
    const paquete = await pool.query(
      'SELECT id FROM paquetes WHERE id = $1 AND usuario_id = $2',
      [req.params.id, req.usuario.id]
    );
    if (paquete.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
    const resultado = await pool.query(
      'SELECT id, url, fecha_subida FROM paquete_fotos WHERE paquete_id = $1 ORDER BY fecha_subida ASC',
      [req.params.id]
    );
    return res.json({ fotos: resultado.rows });
  } catch (error) {
    console.error('Error en GET /paquetes/:id/fotos:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener las fotos' });
  }
});

// --- POST /api/paquetes/:id/reportar --- (el cliente reporta un problema)
router.post(
  '/:id/reportar',
  requiereAutenticacion,
  [
    body('tipo').isIn(['no_reconozco', 'danado', 'peso_precio', 'otro']).withMessage('Tipo de problema no válido'),
    body('mensaje').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }).withMessage('El mensaje es muy largo'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      // Verificar que el paquete es del cliente.
      const paq = await pool.query(
        'SELECT id FROM paquetes WHERE id = $1 AND usuario_id = $2',
        [req.params.id, req.usuario.id]
      );
      if (paq.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });

      const { tipo, mensaje } = req.body;
      const r = await pool.query(
        `INSERT INTO reportes_paquete (paquete_id, usuario_id, tipo, mensaje)
         VALUES ($1, $2, $3, $4) RETURNING id, tipo, estado, creado_en`,
        [req.params.id, req.usuario.id, tipo, mensaje || null]
      );

      // Avisar al admin por correo (best-effort, no bloquea la respuesta).
      try {
        const { enviarCorreoGenerico } = require('../utils/mailer');
        const correoAdmin = process.env.ADMIN_NOTIFICACION_EMAIL;
        if (correoAdmin) {
          const etiquetas = { no_reconozco: 'No reconozco el paquete', danado: 'Llegó dañado o abierto', peso_precio: 'El peso o precio no cuadra', otro: 'Otro problema' };
          enviarCorreoGenerico(correoAdmin, `Nuevo reporte de paquete — ${etiquetas[tipo] || tipo}`,
            `<p><b>${etiquetas[tipo] || tipo}</b></p><p>Paquete #${req.params.id}</p>${mensaje ? `<p>"${mensaje}"</p>` : ''}<p>Revísalo en el panel de administración.</p>`);
        }
      } catch (e) { /* no bloquear */ }

      return res.status(201).json({ mensaje: 'Reporte enviado', reporte: r.rows[0] });
    } catch (error) {
      console.error('Error en POST /paquetes/:id/reportar:', error);
      return res.status(500).json({ mensaje: 'Error interno al enviar el reporte' });
    }
  }
);

// --- GET /api/paquetes/:id/reportes --- (el cliente ve sus reportes de un paquete)
router.get('/:id/reportes', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT r.id, r.tipo, r.mensaje, r.estado, r.respuesta_admin, r.creado_en
       FROM reportes_paquete r
       JOIN paquetes p ON p.id = r.paquete_id
       WHERE r.paquete_id = $1 AND p.usuario_id = $2
       ORDER BY r.creado_en DESC`,
      [req.params.id, req.usuario.id]
    );
    return res.json({ reportes: resultado.rows });
  } catch (error) {
    console.error('Error en GET /paquetes/:id/reportes:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener los reportes' });
  }
});

module.exports = router;
