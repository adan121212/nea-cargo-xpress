const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');
const router = express.Router();

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
      `SELECT id, usuario_id, tienda, numero_tracking, descripcion, valor_declarado,
              peso_lb, peso_real_lb, peso_confirmado, estado,
              largo_in, ancho_in, alto_in, peso_volumetrico_lb,
              fecha_prealerta, fecha_actualizacion, fecha_entrega,
              firma_url, retirado_por_nombre, retirado_por_cedula
       FROM paquetes WHERE usuario_id = $1 ORDER BY fecha_prealerta DESC`,
      [req.usuario.id]
    );
    return res.json({ paquetes: resultado.rows });
  } catch (error) {
    console.error('Error en GET /paquetes:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar paquetes' });
  }
});

// --- DELETE /api/paquetes/:id ---
// Solo permite borrar prealertados (no recibidos aún)
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
      `SELECT id, usuario_id, tienda, numero_tracking, descripcion, valor_declarado,
              peso_lb, peso_real_lb, peso_confirmado, estado,
              largo_in, ancho_in, alto_in, peso_volumetrico_lb,
              fecha_prealerta, fecha_actualizacion, fecha_entrega,
              firma_url, retirado_por_nombre, retirado_por_cedula
       FROM paquetes WHERE id = $1 AND usuario_id = $2`,
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

module.exports = router;
