const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');

const router = express.Router();

// --- POST /api/paquetes/prealertar ---
// El cliente avisa que compró algo, antes de que llegue a la bodega.
router.post(
  '/prealertar',
  requiereAutenticacion,
  [
    body('tienda').trim().notEmpty().withMessage('Indica la tienda donde compraste'),
    body('numero_tracking').trim().notEmpty().withMessage('El número de tracking es obligatorio'),
    body('descripcion').optional({ checkFalsy: true }).trim(),
    body('valor_declarado')
      .isFloat({ min: 0 })
      .withMessage('El valor declarado debe ser un número positivo'),
    body('peso_lb').optional({ checkFalsy: true }).isFloat({ min: 0 }),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { tienda, numero_tracking, descripcion, valor_declarado, peso_lb } = req.body;

    try {
      const resultado = await pool.query(
        `INSERT INTO paquetes (usuario_id, tienda, numero_tracking, descripcion, valor_declarado, peso_lb)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
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
// Lista los paquetes/prealertas del usuario autenticado, más recientes primero.
router.get('/', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT * FROM paquetes WHERE usuario_id = $1 ORDER BY fecha_prealerta DESC`,
      [req.usuario.id]
    );
    return res.json({ paquetes: resultado.rows });
  } catch (error) {
    console.error('Error en GET /paquetes:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar paquetes' });
  }
});

// --- GET /api/paquetes/:id ---
// Detalle de un paquete específico, solo si pertenece al usuario autenticado.
router.get('/:id', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT * FROM paquetes WHERE id = $1 AND usuario_id = $2`,
      [req.params.id, req.usuario.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Paquete no encontrado' });
    }

    return res.json({ paquete: resultado.rows[0] });
  } catch (error) {
    console.error('Error en GET /paquetes/:id:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener el paquete' });
  }
});

module.exports = router;
