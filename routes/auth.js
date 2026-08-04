const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { enviarCorreoConfirmacion, enviarCorreoRecuperacion } = require('../utils/mailer');
const { generarNumeroCasillero, direccionCasillero } = require('../utils/casillero');

const router = express.Router();

// Hash "señuelo" generado una sola vez al arrancar el servidor. Se usa quna
// el correo no existe, para que bcrypt.compare tarde lo mismo que cuando sí
// existe — así el tiempo de respuesta no delata si un correo está registrado.
const HASH_SENUELO = bcrypt.hashSync('contraseña_senuelo_para_evitar_timing_attack', 10);

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

      // Si el correo no existe, igual corremos un bcrypt.compare contra un
      // hash señuelo, para que la respuesta tarde lo mismo que cuando el
      // correo sí existe pero la contraseña es incorrecta. Sin esto, un
      // atacante podría medir el tiempo de respuesta para saber qué correos
      // están registrados (timing attack).
      const usuario = resultado.rows[0];
      const hashParaComparar = usuario ? usuario.password_hash : HASH_SENUELO;
      const coincide = await bcrypt.compare(password, hashParaComparar);

      if (!usuario || !coincide) {
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

// --- POST /api/auth/olvide-password ---
// Solicita el enlace de recuperación. Sirve tanto para clientes como para
// staff/admin — todos comparten la misma tabla de usuarios y este mismo flujo.
// Por seguridad, siempre responde igual exista o no el correo (no revela
// si una cuenta existe o no).
router.post(
  '/olvide-password',
  [body('email').isEmail().withMessage('Email inválido').normalizeEmail()],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const mensajeGenerico = {
      mensaje: 'Si ese correo tiene una cuenta con nosotros, te enviamos un enlace para restablecer tu contraseña.',
    };

    try {
      const resultado = await pool.query(
        'SELECT id, nombre, email, verificado FROM usuarios WHERE email = $1',
        [req.body.email]
      );

      if (resultado.rows.length === 0 || !resultado.rows[0].verificado) {
        // No revelamos si el correo existe o no, ni si está sin verificar.
        return res.json(mensajeGenerico);
      }

      const usuario = resultado.rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expira = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      await pool.query(
        'UPDATE usuarios SET token_reset_password = $1, token_reset_expira = $2 WHERE id = $3',
        [token, expira, usuario.id]
      );

      await enviarCorreoRecuperacion(usuario.email, usuario.nombre, token);

      return res.json(mensajeGenerico);
    } catch (error) {
      console.error('Error en /olvide-password:', error);
      // Igual respondemos genérico para no filtrar información ni romper el flujo.
      return res.json(mensajeGenerico);
    }
  }
);

// --- POST /api/auth/restablecer-password ---
// Completa el cambio de contraseña usando el token del correo.
router.post(
  '/restablecer-password',
  [
    body('token').trim().notEmpty().withMessage('Falta el token'),
    body('password').isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { token, password } = req.body;

    try {
      const resultado = await pool.query(
        `SELECT id FROM usuarios
         WHERE token_reset_password = $1 AND token_reset_expira > NOW()`,
        [token]
      );

      if (resultado.rows.length === 0) {
        return res.status(400).json({
          mensaje: 'Este enlace ya expiró o no es válido. Solicita uno nuevo.',
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      // Al cambiar la contraseña, invalidamos cualquier token (sesión) que
      // haya sido emitido antes de este momento — así, si alguien tenía un
      // token robado, deja de servirle de inmediato.
      await pool.query(
        `UPDATE usuarios
         SET password_hash = $1, token_reset_password = NULL, token_reset_expira = NULL,
             token_valido_desde = NOW()
         WHERE id = $2`,
        [passwordHash, resultado.rows[0].id]
      );

      return res.json({ mensaje: 'Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión.' });
    } catch (error) {
      console.error('Error en /restablecer-password:', error);
      return res.status(500).json({ mensaje: 'Error interno al restablecer la contraseña' });
    }
  }
);

module.exports = router;
