const express = require('express');
const pool = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');
const { direccionCasillero } = require('../utils/casillero');

const router = express.Router();

// --- GET /api/casillero/perfil ---
// Devuelve los datos del usuario autenticado y su dirección de casillero en Miami.
router.get('/perfil', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT id, nombre, apellido, email, telefono, numero_casillero, verificado, fecha_registro
       FROM usuarios WHERE id = $1`,
      [req.usuario.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    const usuario = resultado.rows[0];

    return res.json({
      usuario,
      direccion_casillero: direccionCasillero(usuario.numero_casillero),
    });
  } catch (error) {
    console.error('Error en /casillero/perfil:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener el perfil' });
  }
});

module.exports = router;
