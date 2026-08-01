const express = require('express');
const pool = require('../db');

const router = express.Router();

// --- GET /api/sucursales ---
// Pública: cualquiera puede ver las sucursales activas (sin necesidad de login).
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT id, nombre, direccion, telefono, horario FROM sucursales WHERE activa = TRUE ORDER BY nombre ASC'
    );
    return res.json({ sucursales: resultado.rows });
  } catch (error) {
    console.error('Error en GET /sucursales:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar sucursales' });
  }
});

module.exports = router;
