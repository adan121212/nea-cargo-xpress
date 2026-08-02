const express = require('express');
const multer = require('multer');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { subirFotoPaquete, eliminarFotoCloudinary } = require('../../utils/cloudinary');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 }, // 5MB por foto, hasta 5 fotos a la vez
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten imágenes'));
    }
    cb(null, true);
  },
});

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

const ESTADOS_VALIDOS = [
  'prealertado',
  'en_bodega_miami',
  'en_transito',
  'en_panama',
  'listo_para_retiro',
  'entregado',
];

// --- GET /api/admin/paquetes ---
// Lista TODOS los paquetes de TODOS los clientes, con filtros opcionales.
// Query params: ?estado=en_transito&email=ana@ejemplo.com&tracking=1Z999
router.get(
  '/',
  [
    query('estado').optional().isIn(ESTADOS_VALIDOS).withMessage('Estado inválido'),
    query('email').optional().trim(),
    query('tracking').optional().trim(),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { estado, email, tracking } = req.query;
    const condiciones = [];
    const valores = [];

    if (estado) {
      valores.push(estado);
      condiciones.push(`p.estado = $${valores.length}`);
    }
    if (email) {
      valores.push(`%${email}%`);
      condiciones.push(`u.email ILIKE $${valores.length}`);
    }
    if (tracking) {
      valores.push(`%${tracking}%`);
      condiciones.push(`p.numero_tracking ILIKE $${valores.length}`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    try {
      const resultado = await pool.query(
        `SELECT p.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                u.email AS cliente_email, u.numero_casillero
         FROM paquetes p
         JOIN usuarios u ON u.id = p.usuario_id
         ${where}
         ORDER BY p.fecha_prealerta DESC
         LIMIT 200`,
        valores
      );
      return res.json({ paquetes: resultado.rows });
    } catch (error) {
      console.error('Error en GET /admin/paquetes:', error);
      return res.status(500).json({ mensaje: 'Error interno al listar paquetes' });
    }
  }
);

// --- PATCH /api/admin/paquetes/:id/estado ---
// Actualiza el estado de un paquete (ej. cuando llega a bodega, sale a tránsito, etc.)
router.patch(
  '/:id/estado',
  [body('estado').isIn(ESTADOS_VALIDOS).withMessage('Estado inválido')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    try {
      const resultado = await pool.query(
        `UPDATE paquetes
         SET estado = $1, fecha_actualizacion = NOW()
         WHERE id = $2
         RETURNING *`,
        [req.body.estado, req.params.id]
      );

      if (resultado.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }

      return res.json({ mensaje: 'Estado actualizado', paquete: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/paquetes/:id/estado:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el estado' });
    }
  }
);

// --- PATCH /api/admin/paquetes/:id/peso ---
// El staff confirma el peso real al recibir el paquete en bodega (para facturar con precisión).
router.patch(
  '/:id/peso',
  [body('peso_real_lb').isFloat({ min: 0.01 }).withMessage('Ingresa un peso válido en libras')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    try {
      const resultado = await pool.query(
        `UPDATE paquetes SET peso_real_lb = $1, fecha_actualizacion = NOW()
         WHERE id = $2 RETURNING *`,
        [req.body.peso_real_lb, req.params.id]
      );

      if (resultado.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }

      return res.json({ mensaje: 'Peso actualizado', paquete: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/paquetes/:id/peso:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el peso' });
    }
  }
);

// --- POST /api/admin/paquetes/:id/fotos ---
// Sube hasta 5 fotos del paquete (ej. al recibirlo en bodega). Campo: "fotos".
router.post('/:id/fotos', upload.array('fotos', 5), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ mensaje: 'Sube al menos una foto (campo "fotos").' });
  }

  try {
    const paqueteExiste = await pool.query('SELECT id FROM paquetes WHERE id = $1', [req.params.id]);
    if (paqueteExiste.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Paquete no encontrado' });
    }

    const subidas = [];
    for (const archivo of req.files) {
      const { url, public_id } = await subirFotoPaquete(archivo.buffer, archivo.mimetype, req.params.id);
      const resultado = await pool.query(
        `INSERT INTO paquete_fotos (paquete_id, url, public_id) VALUES ($1, $2, $3) RETURNING *`,
        [req.params.id, url, public_id]
      );
      subidas.push(resultado.rows[0]);
    }

    return res.status(201).json({ mensaje: 'Fotos subidas', fotos: subidas });
  } catch (error) {
    console.error('Error en POST /admin/paquetes/:id/fotos:', error);
    return res.status(500).json({ mensaje: 'Error interno al subir las fotos' });
  }
});

// --- GET /api/admin/paquetes/:id/fotos ---
router.get('/:id/fotos', async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT * FROM paquete_fotos WHERE paquete_id = $1 ORDER BY fecha_subida ASC',
      [req.params.id]
    );
    return res.json({ fotos: resultado.rows });
  } catch (error) {
    console.error('Error en GET /admin/paquetes/:id/fotos:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar las fotos' });
  }
});

// --- DELETE /api/admin/paquetes/:id/fotos/:fotoId ---
router.delete('/:id/fotos/:fotoId', async (req, res) => {
  try {
    const foto = await pool.query(
      'SELECT * FROM paquete_fotos WHERE id = $1 AND paquete_id = $2',
      [req.params.fotoId, req.params.id]
    );
    if (foto.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Foto no encontrada' });
    }

    await eliminarFotoCloudinary(foto.rows[0].public_id);
    await pool.query('DELETE FROM paquete_fotos WHERE id = $1', [req.params.fotoId]);

    return res.json({ mensaje: 'Foto eliminada' });
  } catch (error) {
    console.error('Error en DELETE /admin/paquetes/:id/fotos/:fotoId:', error);
    return res.status(500).json({ mensaje: 'Error interno al eliminar la foto' });
  }
});

module.exports = router;
