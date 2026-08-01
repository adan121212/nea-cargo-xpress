const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

const reglasTarifa = [
  body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio'),
  body('precio_libra').isFloat({ min: 0 }).withMessage('precio_libra debe ser un número positivo'),
  body('cargo_minimo').optional().isFloat({ min: 0 }),
  body('cargo_manejo').optional().isFloat({ min: 0 }),
  body('pct_seguro').optional().isFloat({ min: 0, max: 100 }),
  body('activa').optional().isBoolean(),
];

// --- GET /api/admin/tarifas ---
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM tarifas ORDER BY activa DESC, nombre ASC');
    return res.json({ tarifas: resultado.rows });
  } catch (error) {
    console.error('Error en GET /admin/tarifas:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar tarifas' });
  }
});

// --- POST /api/admin/tarifas ---
router.post('/', reglasTarifa, async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) {
    return res.status(400).json({ errores: errores.array() });
  }

  const { nombre, precio_libra, cargo_minimo, cargo_manejo, pct_seguro, activa } = req.body;

  try {
    const resultado = await pool.query(
      `INSERT INTO tarifas (nombre, precio_libra, cargo_minimo, cargo_manejo, pct_seguro, activa)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        nombre,
        precio_libra,
        cargo_minimo ?? 0,
        cargo_manejo ?? 0,
        pct_seguro ?? 0,
        activa ?? true,
      ]
    );
    return res.status(201).json({ mensaje: 'Tarifa creada', tarifa: resultado.rows[0] });
  } catch (error) {
    console.error('Error en POST /admin/tarifas:', error);
    return res.status(500).json({ mensaje: 'Error interno al crear la tarifa' });
  }
});

// --- PUT /api/admin/tarifas/:id ---
router.put('/:id', reglasTarifa, async (req, res) => {
  const errores = validationResult(req);
  if (!errores.isEmpty()) {
    return res.status(400).json({ errores: errores.array() });
  }

  const { nombre, precio_libra, cargo_minimo, cargo_manejo, pct_seguro, activa } = req.body;

  try {
    const resultado = await pool.query(
      `UPDATE tarifas
       SET nombre = $1, precio_libra = $2, cargo_minimo = $3, cargo_manejo = $4,
           pct_seguro = $5, activa = COALESCE($6, activa)
       WHERE id = $7
       RETURNING *`,
      [nombre, precio_libra, cargo_minimo ?? 0, cargo_manejo ?? 0, pct_seguro ?? 0, activa, req.params.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Tarifa no encontrada' });
    }

    return res.json({ mensaje: 'Tarifa actualizada', tarifa: resultado.rows[0] });
  } catch (error) {
    console.error('Error en PUT /admin/tarifas/:id:', error);
    return res.status(500).json({ mensaje: 'Error interno al actualizar la tarifa' });
  }
});

// --- DELETE /api/admin/tarifas/:id ---
router.delete('/:id', async (req, res) => {
  try {
    const resultado = await pool.query('DELETE FROM tarifas WHERE id = $1 RETURNING id', [req.params.id]);
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Tarifa no encontrada' });
    }
    return res.json({ mensaje: 'Tarifa eliminada' });
  } catch (error) {
    console.error('Error en DELETE /admin/tarifas/:id:', error);
    // Si la tarifa ya fue usada en facturas, la FK impide borrarla.
    return res.status(409).json({
      mensaje: 'No se puede eliminar: esta tarifa ya se usó en facturas. Puedes desactivarla en su lugar.',
    });
  }
});

module.exports = router;
