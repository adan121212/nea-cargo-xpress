const express = require('express');
const bcrypt = require('bcrypt');
const { body, param, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereSoloAdmin } = require('../../middleware/permiso');

const router = express.Router();

// Crear trabajadores, ver la lista y tocar sus permisos es SIEMPRE solo del
// administrador — nunca delegable, aunque a un trabajador se le diera por
// error el permiso de esta pantalla.
router.use(requiereAutenticacion, requiereSoloAdmin);

// Debe coincidir con las pantallas reales del panel (routes/admin/*.js).
const CLAVES_VALIDAS = [
  'mostrador', 'recepcion', 'paquetes', 'clientes', 'compras', 'deliveries',
  'gastos', 'facturas', 'tarifas', 'sucursales', 'reportes', 'caja', 'pty',
];

function limpiarPermisos(lista) {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.filter((p) => CLAVES_VALIDAS.includes(p)))];
}

// --- GET /api/admin/trabajadores ---
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT id, nombre, apellido, email, permisos_admin, activo, creado_en
       FROM usuarios WHERE rol = 'trabajador' ORDER BY creado_en DESC`
    );
    return res.json({ trabajadores: resultado.rows, claves_disponibles: CLAVES_VALIDAS });
  } catch (error) {
    console.error('Error en GET /admin/trabajadores:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar trabajadores' });
  }
});

// --- POST /api/admin/trabajadores ---
router.post(
  '/',
  [
    body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio'),
    body('apellido').trim().notEmpty().withMessage('El apellido es obligatorio'),
    body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
    body('permisos').optional().isArray().withMessage('Los permisos deben ser una lista'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const { nombre, apellido, email, password } = req.body;
    const permisos = limpiarPermisos(req.body.permisos);
    try {
      const existente = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
      if (existente.rows.length > 0) {
        return res.status(409).json({ mensaje: 'Ese correo ya está registrado.' });
      }
      const hash = await bcrypt.hash(password, 10);
      const resultado = await pool.query(
        `INSERT INTO usuarios (nombre, apellido, email, password_hash, rol, verificado, permisos_admin, tipo_cuenta)
         VALUES ($1, $2, $3, $4, 'trabajador', TRUE, $5, 'personal')
         RETURNING id, nombre, apellido, email, permisos_admin, activo, creado_en`,
        [nombre.trim(), apellido.trim(), email, hash, permisos]
      );
      return res.status(201).json({ mensaje: 'Trabajador creado correctamente', trabajador: resultado.rows[0] });
    } catch (error) {
      console.error('Error en POST /admin/trabajadores:', error);
      return res.status(500).json({ mensaje: 'Error interno al crear el trabajador' });
    }
  }
);

// --- PATCH /api/admin/trabajadores/:id/permisos ---
router.patch(
  '/:id/permisos',
  [
    param('id').isInt().withMessage('Id inválido'),
    body('permisos').isArray().withMessage('Los permisos deben ser una lista'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const permisos = limpiarPermisos(req.body.permisos);
    try {
      const resultado = await pool.query(
        `UPDATE usuarios SET permisos_admin = $1
         WHERE id = $2 AND rol = 'trabajador'
         RETURNING id, nombre, apellido, email, permisos_admin, activo`,
        [permisos, req.params.id]
      );
      if (resultado.rows.length === 0) return res.status(404).json({ mensaje: 'Trabajador no encontrado' });
      return res.json({ mensaje: 'Permisos actualizados', trabajador: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/trabajadores/:id/permisos:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar permisos' });
    }
  }
);

// --- PATCH /api/admin/trabajadores/:id/password ---
// Para cuando un trabajador olvida su contraseña; el admin la resetea a mano.
router.patch(
  '/:id/password',
  [
    param('id').isInt().withMessage('Id inválido'),
    body('password').isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const hash = await bcrypt.hash(req.body.password, 10);
      const resultado = await pool.query(
        `UPDATE usuarios SET password_hash = $1, token_valido_desde = NOW()
         WHERE id = $2 AND rol = 'trabajador' RETURNING id`,
        [hash, req.params.id]
      );
      if (resultado.rows.length === 0) return res.status(404).json({ mensaje: 'Trabajador no encontrado' });
      return res.json({ mensaje: 'Contraseña actualizada correctamente' });
    } catch (error) {
      console.error('Error en PATCH /admin/trabajadores/:id/password:', error);
      return res.status(500).json({ mensaje: 'Error interno al cambiar la contraseña' });
    }
  }
);

// --- PATCH /api/admin/trabajadores/:id/activo ---
// Se desactiva en vez de borrar: un trabajador puede haber cerrado cajas o
// registrado gastos, y esos registros necesitan seguir apuntando a alguien.
router.patch(
  '/:id/activo',
  [param('id').isInt().withMessage('Id inválido'), body('activo').isBoolean().withMessage('Valor inválido')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const resultado = await pool.query(
        `UPDATE usuarios SET activo = $1 WHERE id = $2 AND rol = 'trabajador'
         RETURNING id, nombre, apellido, email, permisos_admin, activo`,
        [req.body.activo, req.params.id]
      );
      if (resultado.rows.length === 0) return res.status(404).json({ mensaje: 'Trabajador no encontrado' });
      return res.json({ mensaje: req.body.activo ? 'Trabajador reactivado' : 'Trabajador desactivado', trabajador: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/trabajadores/:id/activo:', error);
      return res.status(500).json({ mensaje: 'Error interno al cambiar el estado' });
    }
  }
);

module.exports = router;
