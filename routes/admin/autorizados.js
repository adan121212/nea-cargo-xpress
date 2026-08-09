const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');

const router = express.Router();

// --- GET /api/autorizados ---
// Lista las personas autorizadas del usuario autenticado (hasta 3).
router.get('/', requiereAutenticacion, async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT id, nombre, cedula FROM autorizados WHERE usuario_id = $1 ORDER BY id ASC`,
      [req.usuario.id]
    );
    return res.json({ autorizados: resultado.rows });
  } catch (error) {
    console.error('Error en GET /autorizados:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar los autorizados' });
  }
});

// --- PUT /api/autorizados ---
// Reemplaza la lista completa de autorizados del usuario (máximo 3).
// El cliente manda el formulario entero cada vez que guarda, así que
// simplemente borramos lo anterior y guardamos lo nuevo — más simple
// que llevar edición fila por fila para solo 3 registros.
router.put(
  '/',
  requiereAutenticacion,
  [
    body('autorizados').isArray({ max: 3 }).withMessage('Máximo 3 personas autorizadas'),
    body('autorizados.*.nombre').trim().notEmpty().withMessage('Falta el nombre de una persona autorizada'),
    body('autorizados.*.cedula').trim().notEmpty().withMessage('Falta la cédula de una persona autorizada'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { autorizados } = req.body;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM autorizados WHERE usuario_id = $1', [req.usuario.id]);

      for (const persona of autorizados) {
        await client.query(
          'INSERT INTO autorizados (usuario_id, nombre, cedula) VALUES ($1, $2, $3)',
          [req.usuario.id, persona.nombre.trim(), persona.cedula.trim()]
        );
      }

      await client.query('COMMIT');
      return res.json({ mensaje: 'Autorizados guardados correctamente' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en PUT /autorizados:', error);
      return res.status(500).json({ mensaje: 'Error interno al guardar los autorizados' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
