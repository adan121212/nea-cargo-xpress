const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');
const router = express.Router();
router.use(requiereAutenticacion);

// --- GET /api/perfil ---
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT id, nombre, apellido, email, telefono, numero_casillero, fecha_registro
       FROM usuarios WHERE id = $1`,
      [req.usuario.id]
    );
    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }
    return res.json({ perfil: resultado.rows[0] });
  } catch (error) {
    console.error('Error en GET /perfil:', error);
    return res.status(500).json({ mensaje: 'Error interno al obtener el perfil' });
  }
});

// --- PATCH /api/perfil/telefono ---
router.patch(
  '/telefono',
  [
    body('telefono')
      .trim()
      .notEmpty().withMessage('El teléfono es obligatorio')
      .isLength({ max: 20 }).withMessage('Teléfono demasiado largo'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    const { telefono } = req.body;
    try {
      await pool.query(
        'UPDATE usuarios SET telefono = $1 WHERE id = $2',
        [telefono, req.usuario.id]
      );
      return res.json({ mensaje: 'Teléfono actualizado correctamente' });
    } catch (error) {
      console.error('Error en PATCH /perfil/telefono:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el teléfono' });
    }
  }
);

// --- PATCH /api/perfil/nombre ---
// Permite al cliente cambiar el nombre y apellido que aparecen en su casillero.
router.patch(
  '/nombre',
  [
    body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 80 }),
    body('apellido').trim().optional({ nullable: true }).isLength({ max: 80 }),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    const { nombre, apellido } = req.body;
    try {
      await pool.query(
        'UPDATE usuarios SET nombre = $1, apellido = $2 WHERE id = $3',
        [nombre, apellido || '', req.usuario.id]
      );
      return res.json({ mensaje: 'Nombre actualizado correctamente' });
    } catch (error) {
      console.error('Error en PATCH /perfil/nombre:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el nombre' });
    }
  }
);

// --- PATCH /api/perfil/password ---
router.patch(
  '/password',
  [
    body('password_actual').notEmpty().withMessage('La contraseña actual es obligatoria'),
    body('password_nueva')
      .isLength({ min: 8 }).withMessage('La nueva contraseña debe tener al menos 8 caracteres'),
    body('password_confirmar').notEmpty().withMessage('Confirma la nueva contraseña'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    const { password_actual, password_nueva, password_confirmar } = req.body;
    if (password_nueva !== password_confirmar) {
      return res.status(400).json({ mensaje: 'Las contraseñas nuevas no coinciden' });
    }
    if (password_actual === password_nueva) {
      return res.status(400).json({ mensaje: 'La nueva contraseña debe ser diferente a la actual' });
    }
    try {
      const resultado = await pool.query(
        'SELECT password_hash FROM usuarios WHERE id = $1',
        [req.usuario.id]
      );
      if (resultado.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Usuario no encontrado' });
      }
      const passwordValida = await bcrypt.compare(
        password_actual,
        resultado.rows[0].password_hash
      );
      if (!passwordValida) {
        return res.status(401).json({ mensaje: 'La contraseña actual es incorrecta' });
      }
      const nuevoHash = await bcrypt.hash(password_nueva, 12);
      await pool.query(
        'UPDATE usuarios SET password_hash = $1, token_valido_desde = NOW() WHERE id = $2',
        [nuevoHash, req.usuario.id]
      );
      return res.json({ mensaje: 'Contraseña actualizada correctamente. Por seguridad, inicia sesión de nuevo.' });
    } catch (error) {
      console.error('Error en PATCH /perfil/password:', error);
      return res.status(500).json({ mensaje: 'Error interno al cambiar la contraseña' });
    }
  }
);

module.exports = router;
