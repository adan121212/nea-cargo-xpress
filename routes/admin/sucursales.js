const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// --- GET /api/admin/sucursales ---
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM sucursales ORDER BY nombre ASC');
    return res.json({ sucursales: resultado.rows });
  } catch (error) {
    console.error('Error en GET /admin/sucursales:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar sucursales' });
  }
});

// --- POST /api/admin/sucursales ---
router.post(
  '/',
  [
    body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio'),
    body('direccion').trim().notEmpty().withMessage('La dirección es obligatoria'),
    body('telefono').optional({ checkFalsy: true }).trim(),
    body('horario').optional({ checkFalsy: true }).trim(),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { nombre, direccion, telefono, horario } = req.body;

    try {
      const resultado = await pool.query(
        `INSERT INTO sucursales (nombre, direccion, telefono, horario)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [nombre, direccion, telefono || null, horario || null]
      );
      return res.status(201).json({ mensaje: 'Sucursal creada', sucursal: resultado.rows[0] });
    } catch (error) {
      console.error('Error en POST /admin/sucursales:', error);
      return res.status(500).json({ mensaje: 'Error interno al crear la sucursal' });
    }
  }
);

// --- PUT /api/admin/sucursales/:id ---
router.put(
  '/:id',
  [
    body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio'),
    body('direccion').trim().notEmpty().withMessage('La dirección es obligatoria'),
    body('telefono').optional({ checkFalsy: true }).trim(),
    body('horario').optional({ checkFalsy: true }).trim(),
    body('activa').optional().isBoolean(),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { nombre, direccion, telefono, horario, activa } = req.body;

    try {
      const resultado = await pool.query(
        `UPDATE sucursales
         SET nombre = $1, direccion = $2, telefono = $3, horario = $4,
             activa = COALESCE($5, activa)
         WHERE id = $6
         RETURNING *`,
        [nombre, direccion, telefono || null, horario || null, activa, req.params.id]
      );

      if (resultado.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Sucursal no encontrada' });
      }

      return res.json({ mensaje: 'Sucursal actualizada', sucursal: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PUT /admin/sucursales/:id:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar la sucursal' });
    }
  }
);

// --- DELETE /api/admin/sucursales/:id ---
router.delete('/:id', async (req, res) => {
  try {
    const resultado = await pool.query('DELETE FROM sucursales WHERE id = $1 RETURNING id', [
      req.params.id,
    ]);

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Sucursal no encontrada' });
    }

    return res.json({ mensaje: 'Sucursal eliminada' });
  } catch (error) {
    console.error('Error en DELETE /admin/sucursales/:id:', error);
    return res.status(500).json({ mensaje: 'Error interno al eliminar la sucursal' });
  }
});

module.exports = router;
