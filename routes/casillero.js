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
      `SELECT id, nombre, apellido, email, telefono, numero_casillero, verificado, fecha_registro, saldo_a_favor
       FROM usuarios WHERE id = $1`,
      [req.usuario.id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }
    const usuario = resultado.rows[0];
    const nombreCompleto = `${usuario.nombre} ${usuario.apellido}`;
    return res.json({
      usuario,
      direccion_casillero: direccionCasillero(usuario.numero_casillero, nombreCompleto),
    });
  } catch (error) {
    console.error('Error en /casillero/perfil:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener el perfil' });
  }
});

// --- GET /api/casillero/referidos ---
// Lista de personas que este cliente ha referido, con su estado
// (pendiente = aún no ha pagado su primer envío, activado = ya generó el crédito).
router.get('/referidos', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT r.estado, r.monto_credito, r.fecha_registro, r.fecha_activacion,
              u.nombre, u.apellido
       FROM referidos r
       JOIN usuarios u ON u.id = r.referido_id
       WHERE r.referidor_id = $1
       ORDER BY r.fecha_registro DESC`,
      [req.usuario.id]
    );
    return res.json({ referidos: resultado.rows });
  } catch (error) {
    console.error('Error en /casillero/referidos:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener los referidos' });
  }
});

module.exports = router;
