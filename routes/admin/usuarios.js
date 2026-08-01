const express = require('express');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// --- GET /api/admin/usuarios ---
// Lista todos los clientes, con el total de paquetes de cada uno.
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT u.id, u.nombre, u.apellido, u.email, u.telefono, u.numero_casillero,
              u.verificado, u.rol, u.fecha_registro,
              COUNT(p.id) AS total_paquetes
       FROM usuarios u
       LEFT JOIN paquetes p ON p.usuario_id = u.id
       GROUP BY u.id
       ORDER BY u.fecha_registro DESC
       LIMIT 300`
    );
    return res.json({ usuarios: resultado.rows });
  } catch (error) {
    console.error('Error en GET /admin/usuarios:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar usuarios' });
  }
});

// --- GET /api/admin/usuarios/:id ---
// Detalle de un cliente y todos sus paquetes.
router.get('/:id', async (req, res) => {
  try {
    const usuario = await pool.query(
      `SELECT id, nombre, apellido, email, telefono, numero_casillero, verificado, rol, fecha_registro
       FROM usuarios WHERE id = $1`,
      [req.params.id]
    );

    if (usuario.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Cliente no encontrado' });
    }

    const paquetes = await pool.query(
      `SELECT * FROM paquetes WHERE usuario_id = $1 ORDER BY fecha_prealerta DESC`,
      [req.params.id]
    );

    return res.json({ usuario: usuario.rows[0], paquetes: paquetes.rows });
  } catch (error) {
    console.error('Error en GET /admin/usuarios/:id:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener el cliente' });
  }
});

module.exports = router;
