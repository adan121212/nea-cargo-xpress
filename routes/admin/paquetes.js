const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { subirFotoPaquete, eliminarFotoCloudinary } = require('../../utils/cloudinary');
const { enviarCorreoCambioEstado, enviarFacturaListaParaRetiro } = require('../../utils/mailer');
const { generarNumeroFactura } = require('../../utils/factura');
const { generarPdfFactura } = require('../../utils/facturaPdf');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo se permiten imágenes'));
    cb(null, true);
  },
});

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

const ESTADOS_VALIDOS = [
  'prealertado','en_bodega_miami','en_transito',
  'en_panama','listo_para_retiro','entregado',
];

const PAGE_SIZE = 50; // paquetes por página

// --- GET /api/admin/paquetes ---
// Filtros: estado, email, tracking, fecha_desde, fecha_hasta, page
router.get(
  '/',
  [
    query('estado').optional().isIn(ESTADOS_VALIDOS),
    query('email').optional().trim(),
    query('tracking').optional().trim(),
    query('fecha_desde').optional().isDate().withMessage('fecha_desde inválida'),
    query('fecha_hasta').optional().isDate().withMessage('fecha_hasta inválida'),
    query('page').optional().isInt({ min: 1 }).withMessage('Página inválida'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });

    const { estado, email, tracking, fecha_desde, fecha_hasta } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * PAGE_SIZE;

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
    if (fecha_desde) {
      valores.push(fecha_desde);
      condiciones.push(`p.fecha_prealerta >= $${valores.length}::date`);
    }
    if (fecha_hasta) {
      valores.push(fecha_hasta);
      condiciones.push(`p.fecha_prealerta < ($${valores.length}::date + INTERVAL '1 day')`);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    try {
      // Total para la paginación
      const totalRes = await pool.query(
        `SELECT COUNT(*) FROM paquetes p
         JOIN usuarios u ON u.id = p.usuario_id
         ${where}`,
        valores
      );
      const total = parseInt(totalRes.rows[0].count);
      const totalPaginas = Math.ceil(total / PAGE_SIZE);

      // Paquetes de la página actual
      const resultado = await pool.query(
        `SELECT p.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                u.email AS cliente_email, u.numero_casillero,
                f.id AS factura_id, f.numero_factura, f.estado AS factura_estado
         FROM paquetes p
         JOIN usuarios u ON u.id = p.usuario_id
         LEFT JOIN LATERAL (
           SELECT * FROM facturas
           WHERE paquete_id = p.id AND estado <> 'anulada'
           ORDER BY fecha_creacion DESC LIMIT 1
         ) f ON TRUE
         ${where}
         ORDER BY p.fecha_prealerta DESC
         LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
        valores
      );

      return res.json({
        paquetes: resultado.rows,
        paginacion: { page, total_paginas: totalPaginas, total, page_size: PAGE_SIZE },
      });
    } catch (error) {
      console.error('Error en GET /admin/paquetes:', error);
      return res.status(500).json({ mensaje: 'Error interno al listar paquetes' });
    }
  }
);

// --- PATCH /api/admin/paquetes/:id/estado ---
router.patch(
  '/:id/estado',
  [body('estado').isIn(ESTADOS_VALIDOS).withMessage('Estado inválido')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    try {
      const actual = await pool.query('SELECT estado FROM paquetes WHERE id = $1', [req.params.id]);
      if (actual.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      if (actual.rows[0].estado === 'entregado') {
        return res.status(400).json({ mensaje: 'Este paquete ya fue entregado y su estado no se puede modificar.' });
      }
      const resultado = await pool.query(
        `UPDATE paquetes SET estado = $1, fecha_actualizacion = NOW() WHERE id = $2 RETURNING *`,
        [req.body.estado, req.params.id]
      );
      if (resultado.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      const paquete = resultado.rows[0];
      const envios = { correo_enviado: false };
      try {
        const clienteRes = await pool.query('SELECT nombre, email FROM usuarios WHERE id = $1', [paquete.usuario_id]);
        const cliente = clienteRes.rows[0];
        if (cliente) {
          try { await enviarCorreoCambioEstado(cliente.email, cliente.nombre, paquete); envios.correo_enviado = true; }
          catch (e) { console.error('Error notificando cambio de estado:', e); }
        }
      } catch (e) { console.error('Error obteniendo cliente para notificar:', e); }
      return res.json({ mensaje: 'Estado actualizado', paquete, notificaciones: envios });
    } catch (error) {
      console.error('Error en PATCH /admin/paquetes/:id/estado:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el estado' });
    }
  }
);

// --- PATCH /api/admin/paquetes/:id/peso ---
router.patch(
  '/:id/peso',
  [
    body('peso_real_lb').isFloat({ min: 0.01 }).withMessage('Ingresa un peso válido en libras'),
    body('tarifa_id').optional().isInt().withMessage('tarifa_id debe ser un número entero'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const client = await pool.connect();
    try {
      const actual = await client.query('SELECT * FROM paquetes WHERE id = $1', [req.params.id]);
      if (actual.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      if (actual.rows[0].peso_confirmado) {
        return res.status(409).json({ mensaje: 'El peso de este paquete ya fue confirmado y no se puede modificar.', peso_bloqueado: true });
      }
      const paquete = actual.rows[0];
      const pesoConfirmado = req.body.peso_real_lb;
      const tarifaIdSolicitada = req.body.tarifa_id || null;
      const facturaExistente = await client.query(
        `SELECT id FROM facturas WHERE paquete_id = $1 AND estado <> 'anulada'`, [req.params.id]
      );
      await client.query('BEGIN');
      await client.query(
        `UPDATE paquetes SET peso_real_lb = $1, peso_confirmado = TRUE, fecha_actualizacion = NOW() WHERE id = $2`,
        [pesoConfirmado, req.params.id]
      );
      let facturaGenerada = null;
      if (facturaExistente.rows.length === 0) {
        // Usar la tarifa enviada desde el frontend, o la primera activa si no se envió
        let tarifaRows;
        if(tarifaIdSolicitada){
          const r = await client.query('SELECT * FROM tarifas WHERE id = $1 LIMIT 1', [tarifaIdSolicitada]);
          tarifaRows = r.rows;
        } else {
          const r = await client.query('SELECT * FROM tarifas WHERE activa = TRUE ORDER BY id ASC LIMIT 1');
          tarifaRows = r.rows;
          if(tarifaRows.length === 0){
            const r2 = await client.query('SELECT * FROM tarifas ORDER BY id ASC LIMIT 1');
            tarifaRows = r2.rows;
          }
        }
        if (tarifaRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ mensaje: 'No hay ninguna tarifa configurada.' });
        }
        const tarifa = tarifaRows[0];
        const costoEnvio = Math.max(Number(pesoConfirmado) * Number(tarifa.precio_libra), Number(tarifa.cargo_minimo));
        const seguro = paquete.valor_declarado ? (Number(paquete.valor_declarado) * Number(tarifa.pct_seguro)) / 100 : 0;
        const cargoManejo = Number(tarifa.cargo_manejo);
        const total = costoEnvio + cargoManejo + seguro;
        const insercion = await client.query(
          `INSERT INTO facturas (paquete_id, usuario_id, tarifa_id, peso_facturado_lb, precio_libra,
             costo_envio, cargo_manejo, seguro, total, token_pdf, estado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendiente') RETURNING *`,
          [req.params.id, paquete.usuario_id, tarifa.id, pesoConfirmado, tarifa.precio_libra,
           costoEnvio.toFixed(2), cargoManejo.toFixed(2), seguro.toFixed(2), total.toFixed(2),
           crypto.randomBytes(24).toString('hex')]
        );
        facturaGenerada = insercion.rows[0];
        const numeroFactura = generarNumeroFactura(facturaGenerada.id);
        await client.query('UPDATE facturas SET numero_factura = $1 WHERE id = $2', [numeroFactura, facturaGenerada.id]);
        facturaGenerada.numero_factura = numeroFactura;
      }
      await client.query(
        `UPDATE paquetes SET estado = 'listo_para_retiro', fecha_actualizacion = NOW()
         WHERE id = $1 AND estado NOT IN ('entregado', 'listo_para_retiro')`, [req.params.id]
      );
      await client.query('COMMIT');
      const paqueteActualizado = (await pool.query('SELECT * FROM paquetes WHERE id = $1', [req.params.id])).rows[0];
      const envios = { correo_enviado: false };
      if (facturaGenerada) {
        try {
          const datosCompletos = await pool.query(
            `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                    u.email AS cliente_email, u.telefono AS cliente_telefono, u.numero_casillero,
                    p.tienda, p.numero_tracking, p.firma_base64, p.fecha_entrega
             FROM facturas f JOIN usuarios u ON u.id = f.usuario_id JOIN paquetes p ON p.id = f.paquete_id
             WHERE f.id = $1`, [facturaGenerada.id]
          );
          const fd = datosCompletos.rows[0];
          if (fd) {
            try {
              const pdfBuffer = await generarPdfFactura(fd);
              await enviarFacturaListaParaRetiro(fd.cliente_email, fd.cliente_nombre, fd, pdfBuffer);
              envios.correo_enviado = true;
            } catch (e) { console.error('Error enviando correo tras confirmar peso:', e); }
          }
        } catch (e) { console.error('Error obteniendo datos para notificar:', e); }
      }
      return res.json({ mensaje: 'Peso confirmado y bloqueado', paquete: paqueteActualizado, factura: facturaGenerada, envios });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en PATCH /admin/paquetes/:id/peso:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el peso' });
    } finally {
      client.release();
    }
  }
);

// --- PATCH /api/admin/paquetes/:id/dimensiones ---
router.patch(
  '/:id/dimensiones',
  [
    body('largo_in').isFloat({ min: 0.1 }),
    body('ancho_in').isFloat({ min: 0.1 }),
    body('alto_in').isFloat({ min: 0.1 }),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const { largo_in, ancho_in, alto_in } = req.body;
    const pesoVolumetrico = (largo_in * ancho_in * alto_in) / 166;
    try {
      const resultado = await pool.query(
        `UPDATE paquetes SET largo_in=$1, ancho_in=$2, alto_in=$3,
         peso_volumetrico_lb=$4, fecha_actualizacion=NOW() WHERE id=$5 RETURNING *`,
        [largo_in, ancho_in, alto_in, pesoVolumetrico.toFixed(2), req.params.id]
      );
      if (resultado.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      return res.json({ mensaje: 'Dimensiones guardadas', paquete: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/paquetes/:id/dimensiones:', error);
      return res.status(500).json({ mensaje: 'Error interno al guardar dimensiones' });
    }
  }
);

// --- POST /api/admin/paquetes/:id/fotos ---
router.post('/:id/fotos', upload.array('fotos', 5), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ mensaje: 'Sube al menos una foto.' });
  try {
    const existe = await pool.query('SELECT id FROM paquetes WHERE id = $1', [req.params.id]);
    if (existe.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
    const subidas = [];
    for (const archivo of req.files) {
      const { url, public_id } = await subirFotoPaquete(archivo.buffer, archivo.mimetype, req.params.id);
      const r = await pool.query(
        `INSERT INTO paquete_fotos (paquete_id, url, public_id) VALUES ($1,$2,$3) RETURNING *`,
        [req.params.id, url, public_id]
      );
      subidas.push(r.rows[0]);
    }
    return res.status(201).json({ mensaje: 'Fotos subidas', fotos: subidas });
  } catch (error) {
    console.error('Error en POST /admin/paquetes/:id/fotos:', error);
    return res.status(500).json({ mensaje: 'Error interno al subir fotos' });
  }
});

// --- GET /api/admin/paquetes/:id/fotos ---
router.get('/:id/fotos', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM paquete_fotos WHERE paquete_id=$1 ORDER BY fecha_subida ASC', [req.params.id]);
    return res.json({ fotos: r.rows });
  } catch (error) {
    console.error('Error en GET /admin/paquetes/:id/fotos:', error);
    return res.status(500).json({ mensaje: 'Error interno al listar fotos' });
  }
});

// --- DELETE /api/admin/paquetes/:id/fotos/:fotoId ---
router.delete('/:id/fotos/:fotoId', async (req, res) => {
  try {
    const foto = await pool.query('SELECT * FROM paquete_fotos WHERE id=$1 AND paquete_id=$2', [req.params.fotoId, req.params.id]);
    if (foto.rows.length === 0) return res.status(404).json({ mensaje: 'Foto no encontrada' });
    await eliminarFotoCloudinary(foto.rows[0].public_id);
    await pool.query('DELETE FROM paquete_fotos WHERE id=$1', [req.params.fotoId]);
    return res.json({ mensaje: 'Foto eliminada' });
  } catch (error) {
    console.error('Error en DELETE /admin/paquetes/:id/fotos/:fotoId:', error);
    return res.status(500).json({ mensaje: 'Error interno al eliminar foto' });
  }
});

module.exports = router;
