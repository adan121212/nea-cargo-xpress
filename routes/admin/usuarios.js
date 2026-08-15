const express = require('express');
const { body, validationResult } = require('express-validator');
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

// --- GET /api/admin/usuarios/:id/autorizados ---
// Lista las personas autorizadas de un cliente.
router.get('/:id/autorizados', async (req, res) => {
  try {
    const usuario = await pool.query('SELECT id FROM usuarios WHERE id = $1', [req.params.id]);
    if (usuario.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Cliente no encontrado' });
    }
    const resultado = await pool.query(
      `SELECT id, nombre, cedula FROM autorizados WHERE usuario_id = $1 ORDER BY id ASC`,
      [req.params.id]
    );
    return res.json({ autorizados: resultado.rows });
  } catch (error) {
    console.error('Error en GET /admin/usuarios/:id/autorizados:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar autorizados' });
  }
});

// --- PUT /api/admin/usuarios/:id/autorizados ---
// El admin puede editar los autorizados de un cliente.
router.put(
  '/:id/autorizados',
  [
    body('autorizados').isArray({ max: 3 }).withMessage('Máximo 3 personas autorizadas'),
    body('autorizados.*.nombre').trim().notEmpty().withMessage('Falta el nombre'),
    body('autorizados.*.cedula').trim().notEmpty().withMessage('Falta la cédula'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    const { autorizados } = req.body;
    const client = await pool.connect();
    try {
      const usuario = await client.query('SELECT id FROM usuarios WHERE id = $1', [req.params.id]);
      if (usuario.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Cliente no encontrado' });
      }
      await client.query('BEGIN');
      await client.query('DELETE FROM autorizados WHERE usuario_id = $1', [req.params.id]);
      for (const persona of autorizados) {
        await client.query(
          'INSERT INTO autorizados (usuario_id, nombre, cedula) VALUES ($1, $2, $3)',
          [req.params.id, persona.nombre.trim(), persona.cedula.trim()]
        );
      }
      await client.query('COMMIT');
      return res.json({ mensaje: 'Autorizados actualizados correctamente' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en PUT /admin/usuarios/:id/autorizados:', error);
      return res.status(500).json({ mensaje: 'Error interno al guardar autorizados' });
    } finally {
      client.release();
    }
  }
);

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
      const existe = await pool.query('SELECT id FROM usuarios WHERE id = $1', [req.params.id]);
      if (existe.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Cliente no encontrado' });
      }
      if (email) {
        const dup = await pool.query(
          'SELECT id FROM usuarios WHERE email = $1 AND id <> $2',
          [email, req.params.id]
        );
        if (dup.rows.length > 0) {
          return res.status(409).json({ mensaje: 'Ese correo ya está registrado por otro cliente' });
        }
      }
      if (numero_casillero) {
        const dupCas = await pool.query(
          'SELECT id FROM usuarios WHERE numero_casillero = $1 AND id <> $2',
          [numero_casillero, req.params.id]
        );
        if (dupCas.rows.length > 0) {
          return res.status(409).json({ mensaje: 'Ese casillero ya está en uso por otro cliente' });
        }
      }
      const resultado = await pool.query(
        `UPDATE usuarios
         SET nombre=$1, apellido=$2, email=$3,
             telefono=$4, numero_casillero=COALESCE($5, numero_casillero)
         WHERE id=$6
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
