const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { enviarCorreoConfirmacion, enviarCorreoRecuperacion, enviarCorreoNuevoRegistroAdmin } = require('../utils/mailer');
const { enviarCorreoCasillero } = require('../utils/correoCasillero');
const { generarNumeroCasillero } = require('../utils/casillero');
const cloudinary = require('../utils/cloudinary');

const router = express.Router();

// Hash señuelo para evitar timing attacks en el login
const HASH_SENUELO = bcrypt.hashSync('contraseña_senuelo_para_evitar_timing_attack', 10);

// Multer en memoria para recibir el PDF del aviso de operación
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // máximo 8 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos PDF para el aviso de operación'));
    }
  },
});

// --- POST /api/auth/registro ---
// Acepta multipart/form-data porque las empresas suben el PDF.
// Para cuentas personales también funciona — el PDF es ignorado si tipo_cuenta = 'personal'.
router.post(
  '/registro',
  upload.single('aviso_operacion'),
  async (req, res) => {
    const tipo_cuenta = req.body.tipo_cuenta === 'empresa' ? 'empresa' : 'personal';

    // Validaciones base (aplican a ambos tipos)
    const erroresBase = [];
    if (!req.body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email)) {
      erroresBase.push({ msg: 'Email inválido' });
    }
    if (!req.body.password || req.body.password.length < 8) {
      erroresBase.push({ msg: 'La contraseña debe tener al menos 8 caracteres' });
    }
    if (tipo_cuenta === 'personal') {
      if (!req.body.nombre?.trim()) erroresBase.push({ msg: 'El nombre es obligatorio' });
      if (!req.body.apellido?.trim()) erroresBase.push({ msg: 'El apellido es obligatorio' });
    } else {
      if (!req.body.razon_social?.trim()) erroresBase.push({ msg: 'La razón social es obligatoria' });
      if (!req.body.ruc?.trim()) erroresBase.push({ msg: 'El RUC es obligatorio' });
      if (!req.body.nombre_contacto?.trim()) erroresBase.push({ msg: 'El nombre del contacto es obligatorio' });
      if (!req.file) erroresBase.push({ msg: 'El aviso de operación en PDF es obligatorio para cuentas de empresa' });
    }
    if (erroresBase.length > 0) {
      return res.status(400).json({ errores: erroresBase });
    }

    const {
      nombre, apellido, email, telefono, password,
      razon_social, ruc, nombre_contacto,
    } = req.body;

    const emailNorm = email.trim().toLowerCase();

    const client = await pool.connect();
    try {
      const existente = await client.query('SELECT id FROM usuarios WHERE email = $1', [emailNorm]);
      if (existente.rows.length > 0) {
        return res.status(409).json({ mensaje: 'Ese correo ya está registrado' });
      }

      // Si es empresa, sube el PDF del aviso de operación a Cloudinary.
      let avisoUrl = null, avisoPublicId = null;
      if (tipo_cuenta === 'empresa' && req.file) {
        try {
          const resultado = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                resource_type: 'raw',
                folder: 'nea-cargo-xpress/avisos-operacion',
                public_id: `aviso_${emailNorm.replace(/[^a-z0-9]/g, '_')}_${Date.now()}`,
                format: 'pdf',
              },
              (error, result) => (error ? reject(error) : resolve(result))
            );
            stream.end(req.file.buffer);
          });
          avisoUrl = resultado.secure_url;
          avisoPublicId = resultado.public_id;
        } catch (errorCloudinary) {
          console.error('Error subiendo aviso de operación a Cloudinary:', errorCloudinary);
          return res.status(500).json({ mensaje: 'No se pudo subir el aviso de operación. Intenta de nuevo.' });
        }
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const tokenVerificacion = crypto.randomBytes(32).toString('hex');

      // Para empresas usamos razon_social como "nombre" y ruc como "apellido"
      // en los campos existentes, y guardamos los datos extra en las columnas nuevas.
      const nombreDB    = tipo_cuenta === 'empresa' ? razon_social.trim() : nombre.trim();
      const apellidoDB  = tipo_cuenta === 'empresa' ? ruc.trim()          : apellido.trim();

      await client.query('BEGIN');

      const insercion = await client.query(
        `INSERT INTO usuarios
           (nombre, apellido, email, telefono, password_hash, token_verificacion,
            tipo_cuenta, razon_social, ruc, nombre_contacto,
            aviso_operacion_url, aviso_operacion_public_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, nombre, apellido, email, fecha_registro`,
        [
          nombreDB, apellidoDB, emailNorm, telefono?.trim() || null,
          passwordHash, tokenVerificacion,
          tipo_cuenta,
          tipo_cuenta === 'empresa' ? razon_social.trim() : null,
          tipo_cuenta === 'empresa' ? ruc.trim() : null,
          tipo_cuenta === 'empresa' ? nombre_contacto.trim() : null,
          avisoUrl, avisoPublicId,
        ]
      );

      const nuevoUsuario = insercion.rows[0];
      const numeroCasillero = generarNumeroCasillero(nuevoUsuario.id);

      await client.query('UPDATE usuarios SET numero_casillero = $1 WHERE id = $2', [
        numeroCasillero, nuevoUsuario.id,
      ]);

      await client.query('COMMIT');

      // ------------------------------------------------------------------
      // A partir de aquí el usuario YA existe en la base de datos.
      // NINGÚN correo lleva await: si Resend falla, queda en el log pero el
      // cliente recibe su 201 normal. Antes esto tumbaba el registro completo
      // con un 500 aunque el usuario ya estaba creado.
      // ------------------------------------------------------------------
      const nombreParaCorreo = tipo_cuenta === 'empresa' ? razon_social.trim() : nombre.trim();
      const nombreCompleto = tipo_cuenta === 'empresa'
        ? razon_social.trim()
        : `${nombre.trim()} ${apellido.trim()}`;

      enviarCorreoConfirmacion(emailNorm, nombreParaCorreo, tokenVerificacion)
        .catch(err => console.error('Correo confirmación:', err));

      enviarCorreoCasillero(emailNorm, nombreCompleto, numeroCasillero)
        .catch(err => console.error('Correo casillero:', err));

      enviarCorreoNuevoRegistroAdmin({
        ...nuevoUsuario,
        telefono: telefono?.trim() || null,
        numero_casillero: numeroCasillero,
        tipo_cuenta,
        razon_social: tipo_cuenta === 'empresa' ? razon_social.trim() : null,
        ruc: tipo_cuenta === 'empresa' ? ruc.trim() : null,
      }).catch(err => console.error('Aviso admin:', err));

      return res.status(201).json({
        mensaje: 'Cuenta creada correctamente. Revisa tu correo para confirmarla.',
        usuario: { ...nuevoUsuario, numero_casillero: numeroCasillero, tipo_cuenta },
      });
    } catch (error) {
      // El ROLLBACK va protegido: si el error ocurrió después del COMMIT,
      // este rollback ya no aplica y no debe tapar el error real en los logs.
      try { await client.query('ROLLBACK'); } catch (e) { /* ya se había hecho COMMIT */ }
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
    // Ojo: numero_casillero es el CÓDIGO DE CLIENTE, no la dirección de envío.
    // La dirección va en el correo de bienvenida (utils/correoCasillero.js).
    return res.send(
      `¡Tu cuenta ha sido verificada! Tu código de cliente es ${usuario.numero_casillero}. ` +
      `Tu dirección de envío en Miami te llegó por correo. Ya puedes iniciar sesión.`
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
        `SELECT id, nombre, apellido, email, password_hash, verificado,
                numero_casillero, rol, tipo_cuenta
         FROM usuarios WHERE email = $1`,
        [email]
      );

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
        { id: usuario.id, email: usuario.email, numero_casillero: usuario.numero_casillero, rol: usuario.rol },
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
          tipo_cuenta: usuario.tipo_cuenta,
        },
      });
    } catch (error) {
      console.error('Error en /login:', error);
      return res.status(500).json({ mensaje: 'Error interno al iniciar sesión' });
    }
  }
);

// --- POST /api/auth/olvide-password ---
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
        return res.json(mensajeGenerico);
      }

      const usuario = resultado.rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expira = new Date(Date.now() + 60 * 60 * 1000);

      await pool.query(
        'UPDATE usuarios SET token_reset_password = $1, token_reset_expira = $2 WHERE id = $3',
        [token, expira, usuario.id]
      );

      await enviarCorreoRecuperacion(usuario.email, usuario.nombre, token);

      return res.json(mensajeGenerico);
    } catch (error) {
      console.error('Error en /olvide-password:', error);
      return res.json(mensajeGenerico);
    }
  }
);

// --- POST /api/auth/restablecer-password ---
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
