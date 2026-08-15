const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// --- GET /api/admin/usuarios ---
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    let queryStr = `
      SELECT u.id, u.nombre, u.apellido, u.email, u.telefono, u.numero_casillero,
             u.verificado, u.rol, u.fecha_registro,
             COUNT(p.id) AS total_paquetes
      FROM usuarios u
      LEFT JOIN paquetes p ON p.usuario_id = u.id
    `;
    const valores = [];
    if (q) {
      valores.push(`%${q}%`);
      queryStr += ` WHERE u.numero_casillero ILIKE $1
                      OR u.email ILIKE $1
                      OR CONCAT(u.nombre, ' ', u.apellido) ILIKE $1`;
    }
    queryStr += ` GROUP BY u.id ORDER BY u.fecha_registro DESC LIMIT 300`;
    const resultado = await pool.query(queryStr, valores);
    return res.json({ usuarios: resultado.rows });
  } catch (error) {
    console.error('Error en GET /admin/usuarios:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar usuarios' });
  }
});

// --- GET /api/admin/usuarios/:id ---
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

// --- PUT /api/admin/usuarios/:id ---
// Edita nombre, apellido, email, teléfono y casillero de un cliente.
router.put(
  '/:id',
  [
    body('nombre').trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 80 }),
    body('apellido').trim().notEmpty().withMessage('El apellido es obligatorio').isLength({ max: 80 }),
    body('email').trim().isEmail().withMessage('Correo inválido').normalizeEmail(),
    body('telefono').optional({ nullable: true }).trim().isLength({ max: 20 }),
    body('numero_casillero').optional({ nullable: true }).trim().isLength({ max: 30 }),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    const { nombre, apellido, email, telefono, numero_casillero } = req.body;
    try {
      // Verificar que el cliente existe
      const existe = await pool.query('SELECT id FROM usuarios WHERE id = $1', [req.params.id]);
      if (existe.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Cliente no encontrado' });
      }
      // Verificar que el email no lo use otro cliente
      if (email) {
        const emailDuplicado = await pool.query(
          'SELECT id FROM usuarios WHERE email = $1 AND id <> $2',
          [email, req.params.id]
        );
        if (emailDuplicado.rows.length > 0) {
          return res.status(409).json({ mensaje: 'Ese correo ya está registrado por otro cliente' });
        }
      }
      // Verificar que el casillero no lo use otro cliente
      if (numero_casillero) {
        const casillDuplicado = await pool.query(
          'SELECT id FROM usuarios WHERE numero_casillero = $1 AND id <> $2',
          [numero_casillero, req.params.id]
        );
        if (casillDuplicado.rows.length > 0) {
          return res.status(409).json({ mensaje: 'Ese número de casillero ya está en uso por otro cliente' });
        }
      }
      const resultado = await pool.query(
        `UPDATE usuarios
         SET nombre = $1, apellido = $2, email = $3,
             telefono = $4, numero_casillero = COALESCE($5, numero_casillero)
         WHERE id = $6
         RETURNING id, nombre, apellido, email, telefono, numero_casillero`,
        [nombre, apellido, email, telefono || null, numero_casillero || null, req.params.id]
      );
      return res.json({ mensaje: 'Cliente actualizado correctamente', usuario: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PUT /admin/usuarios/:id:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el cliente' });
    }
  }
);

module.exports = router;
