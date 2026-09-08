const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { generarNumeroCasillero } = require('../../utils/casillero');

const router = express.Router();
router.use(requiereAutenticacion);

// Solo el propio admin puede tocar su propio casillero. No aplica a
// trabajadores (ellos usan PATCH /admin/trabajadores/:id/casillero) ni a
// clientes (ya tienen el suyo desde que se registraron).
function requiereSoloAdminPropio(req, res, next) {
  if (!req.usuario || req.usuario.rol !== 'admin') {
    return res.status(403).json({ mensaje: 'Solo el administrador puede hacer esto.' });
  }
  next();
}

// --- PATCH /api/admin/mi-cuenta/casillero ---
router.patch(
  '/casillero',
  requiereSoloAdminPropio,
  [body('activar').isBoolean().withMessage('Valor inválido')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      if (req.body.activar) {
        const casillero = generarNumeroCasillero(req.usuario.id);
        const resultado = await pool.query(
          `UPDATE usuarios SET numero_casillero = $1 WHERE id = $2
           RETURNING id, nombre, apellido, email, numero_casillero`,
          [casillero, req.usuario.id]
        );
        return res.json({ mensaje: `Ahora también eres cliente, con casillero ${casillero}.`, usuario: resultado.rows[0] });
      }
      const resultado = await pool.query(
        `UPDATE usuarios SET numero_casillero = NULL WHERE id = $1
         RETURNING id, nombre, apellido, email, numero_casillero`,
        [req.usuario.id]
      );
      return res.json({ mensaje: 'Se quitó tu casillero de cliente.', usuario: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/mi-cuenta/casillero:', error);
      return res.status(500).json({ mensaje: 'Error interno al cambiar el casillero' });
    }
  }
);

module.exports = router;
