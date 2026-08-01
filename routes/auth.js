const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { enviarCorreoConfirmacion } = require('../utils/mailer');
const { generarNumeroCasillero, direccionCasillero } = require('../utils/casillero');

const router = express.Router();

// --- POST /api/auth/registro ---
router.post(
  '/registro',
  [
    body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio'),
    body('apellido').trim().notEmpty().withMessage('El apellido es obligatorio'),
    body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
    body('telefono').optional({ checkFalsy: true }).trim(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('La contraseña debe tener al menos 8 caracteres'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { nombre, apellido, email, telefono, password } = req.body;
    const client = await pool.connect();

    try {
      const existente = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
      if (existente.rows.length > 0) {
        return res.status(409).json({ mensaje: 'Ese correo ya está registrado' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const tokenVerificacion = crypto.randomBytes(32).toString('hex');

      await client.query('BEGIN');

      const insercion = await client.query(
        `INSERT INTO usuarios (nombre, apellido, email, telefono, password_hash, token_verificacion)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, nombre, apellido, email, fecha_registro`,
        [nombre, apellido, email, telefono || null, passwordHash, tokenVerificacion]
      );

      const nuevoUsuario = insercion.rows[0];
      const numeroCasillero = generarNumeroCasillero(nuevoUsuario.id);

      await client.query('UPDATE usuarios SET numero_casillero = $1 WHERE id = $2', [
        numeroCasillero,
        nuevoUsuario.id,
      ]);

      await client.query('COMMIT');

      await enviarCorreoConfirmacion(email, nombre, tokenVerificacion);

      return res.status(201).json({
        mensaje: 'Cuenta creada correctamente. Revisa tu correo para confirmarla.',
        usuario: { ...nuevoUsuario, numero_casillero: numeroCasillero },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en /registro:', error);
      return res.status(500).json({ mensaje: 'Error interno al registrar el usuario' });
    } finally {
      client.release();
    }
  }
);

// --- GET /api/auth/verificar/:token ---
router.get('/verificar/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const resultado = await pool.query(
      `UPDATE usuarios
       SET verificado = TRUE, token_verificacion = NULL
       WHERE token_verificacion = $1
       RETURNING id, nombre, email, numero_casillero`,
      [token]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).send('Token inválido o cuenta ya verificada.');
    }

    const usuario = resultado.rows[0];
    return res.send(
      `¡Tu cuenta ha sido verificada! Tu número de casillero es ${usuario.numero_casillero}. Ya puedes iniciar sesión.`
    );
  } catch (error) {
    console.error('Error en /verificar:', error);
    return res.status(500).send('Error interno al verificar la cuenta.');
  }
});

// --- POST /api/auth/login ---
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
    body('password').notEmpty().withMessage('La contraseña es obligatoria'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { email, password } = req.body;

    try {
      const resultado = await pool.query(
        `SELECT id, nombre, apellido, email, password_hash, verificado, numero_casillero, rol
         FROM usuarios WHERE email = $1`,
        [email]
      );

      if (resultado.rows.length === 0) {
        return res.status(401).json({ mensaje: 'Correo o contraseña incorrectos' });
      }

      const usuario = resultado.rows[0];
      const coincide = await bcrypt.compare(password, usuario.password_hash);

      if (!coincide) {
        return res.status(401).json({ mensaje: 'Correo o contraseña incorrectos' });
      }

      if (!usuario.verificado) {
        return res.status(403).json({
          mensaje: 'Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.',
        });
      }

      const token = jwt.sign(
        {
          id: usuario.id,
          email: usuario.email,
          numero_casillero: usuario.numero_casillero,
          rol: usuario.rol,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      return res.json({
        mensaje: 'Inicio de sesión exitoso',
        token,
        usuario: {
          id: usuario.id,
          nombre: usuario.nombre,
          apellido: usuario.apellido,
          email: usuario.email,
          numero_casillero: usuario.numero_casillero,
          rol: usuario.rol,
        },
      });
    } catch (error) {
      console.error('Error en /login:', error);
      return res.status(500).json({ mensaje: 'Error interno al iniciar sesión' });
    }
  }
);

module.exports = router;
