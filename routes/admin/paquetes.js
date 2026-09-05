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
const { aplicarSaldoAFavor } = require('../../utils/referidos');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Solo se permiten imágenes'));
    cb(null, true);
  },
});

require('dotenv').config();

const ESTADO_LABEL = {
  prealertado: 'Prealertado', en_bodega_miami: 'En bodega Miami', en_transito: 'En tránsito',
  en_panama: 'En Panamá', listo_para_retiro: 'Listo para retiro', entregado: 'Entregado',
};

const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

const ESTADOS_VALIDOS = [
  'prealertado','en_bodega_miami','en_transito',
  'en_panama','listo_para_retiro','entregado',
];

const PAGE_SIZE = 50;

// --- GET /api/admin/paquetes ---
router.get(
  '/',
  [
    query('estado').optional().isIn(ESTADOS_VALIDOS),
    query('email').optional().trim(),
    query('tracking').optional().trim(),
    query('fecha_desde').optional().isDate(),
    query('fecha_hasta').optional().isDate(),
    query('page').optional().isInt({ min: 1 }),
    query('antiguedad').optional().isInt({ min: 1 }),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const { estado, email, tracking, fecha_desde, fecha_hasta, antiguedad } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * PAGE_SIZE;
    const condiciones = [];
    const valores = [];
    if (estado) { valores.push(estado); condiciones.push(`p.estado = $${valores.length}`); }
    if (email) { valores.push(`%${email}%`); condiciones.push(`u.email ILIKE $${valores.length}`); }
    if (tracking) { valores.push(`%${tracking}%`); condiciones.push(`p.numero_tracking ILIKE $${valores.length}`); }
    if (fecha_desde) { valores.push(fecha_desde); condiciones.push(`p.fecha_prealerta >= $${valores.length}::date`); }
    if (fecha_hasta) { valores.push(fecha_hasta); condiciones.push(`p.fecha_prealerta < ($${valores.length}::date + INTERVAL '1 day')`); }
    if (antiguedad) {
      valores.push(parseInt(antiguedad));
      // Paquetes que llevan N días o más sin retirarse (los entregados no cuentan)
      condiciones.push(`(NOW()::date - p.fecha_prealerta::date) >= $${valores.length} AND p.estado <> 'entregado'`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    try {
      const totalRes = await pool.query(
        `SELECT COUNT(*) FROM paquetes p LEFT JOIN usuarios u ON u.id = p.usuario_id ${where}`, valores
      );
      const total = parseInt(totalRes.rows[0].count);
      const totalPaginas = Math.ceil(total / PAGE_SIZE);
      const resultado = await pool.query(
        `SELECT p.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                u.email AS cliente_email, u.numero_casillero, u.telefono AS cliente_telefono,
                (NOW()::date - p.fecha_prealerta::date) AS dias_transcurridos,
                (p.fecha_entrega::date - p.fecha_prealerta::date) AS dias_hasta_entrega,
                s.nombre AS sucursal_nombre,
                f.id AS factura_id, f.numero_factura, f.estado AS factura_estado
         FROM paquetes p
         LEFT JOIN usuarios u ON u.id = p.usuario_id
         LEFT JOIN sucursales s ON s.id = p.sucursal_id
         LEFT JOIN LATERAL (
           SELECT * FROM facturas WHERE paquete_id = p.id AND estado <> 'anulada'
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
  [
    body('estado').isIn(ESTADOS_VALIDOS).withMessage('Estado inválido'),
    body('sucursal_id').optional({ nullable: true }).isInt().withMessage('sucursal_id inválido'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const sucursalId = req.body.sucursal_id || null;
    try {
      const actual = await pool.query('SELECT estado FROM paquetes WHERE id = $1', [req.params.id]);
      if (actual.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      if (actual.rows[0].estado === 'entregado') {
        return res.status(400).json({ mensaje: 'Este paquete ya fue entregado y su estado no se puede modificar.' });
      }
      const resultado = await pool.query(
        `UPDATE paquetes SET estado = $1, fecha_actualizacion = NOW(),
         sucursal_id = COALESCE($3::integer, sucursal_id)
         WHERE id = $2 RETURNING *`,
        [req.body.estado, req.params.id, sucursalId]
      );
      if (resultado.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      const paquete = resultado.rows[0];
      const envios = { correo_enviado: false };
      try {
        // Traemos los datos de la sucursal para incluirlos en el correo
        const sucRes = await pool.query(
          `SELECT s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
                  s.telefono AS sucursal_telefono, s.horario AS sucursal_horario
           FROM sucursales s WHERE s.id = $1`, [paquete.sucursal_id]
        );
        if (sucRes.rows.length > 0) Object.assign(paquete, sucRes.rows[0]);
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
// Confirma el peso real (balanza) y genera la factura automáticamente.
// La factura se cobra sobre el MAYOR entre el peso real y el peso volumétrico
// (calculado a partir de las medidas, si el paquete las tiene guardadas).
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
      // El peso real de la balanza SIEMPRE se guarda tal cual, sin tocar.
      await client.query(
        `UPDATE paquetes SET peso_real_lb = $1, peso_confirmado = TRUE, fecha_actualizacion = NOW() WHERE id = $2`,
        [pesoConfirmado, req.params.id]
      );
      let facturaGenerada = null;
      if (facturaExistente.rows.length === 0) {
        let tarifaRows;
        if (tarifaIdSolicitada) {
          const r = await client.query('SELECT * FROM tarifas WHERE id = $1 LIMIT 1', [tarifaIdSolicitada]);
          tarifaRows = r.rows;
        } else {
          const r = await client.query('SELECT * FROM tarifas WHERE activa = TRUE ORDER BY id ASC LIMIT 1');
          tarifaRows = r.rows;
          if (tarifaRows.length === 0) {
            const r2 = await client.query('SELECT * FROM tarifas ORDER BY id ASC LIMIT 1');
            tarifaRows = r2.rows;
          }
        }
        if (tarifaRows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ mensaje: 'No hay ninguna tarifa configurada.' });
        }
        const tarifa = tarifaRows[0];
        // Cada tarifa cobra por SU propio peso: si su nombre dice "volumen", se cobra el peso
        // volumétrico; cualquier otra tarifa cobra el peso real. La tarifa que se elija es la
        // que decide qué peso se factura — no hay comparación automática entre los dos.
        const pesoVolumetrico = Number(paquete.peso_volumetrico_lb || 0);
        const esTarifaVolumetrica = /volum/i.test(tarifa.nombre || '');
        const pesoParaCobrar = (esTarifaVolumetrica && pesoVolumetrico > 0) ? pesoVolumetrico : Number(pesoConfirmado);
        const costoEnvio = Math.max(Number(pesoParaCobrar) * Number(tarifa.precio_libra), Number(tarifa.cargo_minimo));
        const seguro = paquete.valor_declarado ? (Number(paquete.valor_declarado) * Number(tarifa.pct_seguro)) / 100 : 0;
        const cargoManejo = Number(tarifa.cargo_manejo);
        const totalAntes = costoEnvio + cargoManejo + seguro;
        const descuentoReferido = await aplicarSaldoAFavor(client, paquete.usuario_id, totalAntes);
        const total = totalAntes - descuentoReferido;
        const insercion = await client.query(
          `INSERT INTO facturas (paquete_id, usuario_id, tarifa_id, peso_facturado_lb, precio_libra,
             costo_envio, cargo_manejo, seguro, total, descuento_referido, token_pdf, estado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pendiente') RETURNING *`,
          [req.params.id, paquete.usuario_id, tarifa.id, pesoParaCobrar, tarifa.precio_libra,
           costoEnvio.toFixed(2), cargoManejo.toFixed(2), seguro.toFixed(2), total.toFixed(2),
           descuentoReferido.toFixed(2), crypto.randomBytes(24).toString('hex')]
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
                    u.email AS cliente_email, u.telefono AS cliente_telefono,
                    u.ruc AS cliente_ruc, u.numero_casillero,
                    p.tienda, p.numero_tracking, p.firma_base64, p.fecha_entrega,
                    p.largo_in, p.ancho_in, p.alto_in, p.peso_volumetrico_lb, p.peso_real_lb,
                    s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion,
                    s.telefono AS sucursal_telefono, s.horario AS sucursal_horario
             FROM facturas f
             JOIN usuarios u ON u.id = f.usuario_id
             JOIN paquetes p ON p.id = f.paquete_id
             LEFT JOIN sucursales s ON s.id = p.sucursal_id
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

// --- PATCH /api/admin/paquetes/:id/cliente ---
// Reasigna un paquete a otro cliente. Si ya tiene factura activa,
// la mueve también, para que no quede a nombre de quien no es.
router.patch(
  '/:id/cliente',
  [body('usuario_id').isInt().withMessage('usuario_id es obligatorio')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) return res.status(400).json({ errores: errores.array() });
    const client = await pool.connect();
    try {
      const paqueteRes = await client.query('SELECT * FROM paquetes WHERE id = $1', [req.params.id]);
      if (paqueteRes.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      const paquete = paqueteRes.rows[0];
      if (paquete.estado === 'entregado') {
        return res.status(409).json({ mensaje: 'Este paquete ya fue entregado. No se puede cambiar de cliente.' });
      }
      const clienteRes = await client.query(
        'SELECT id, nombre, apellido, email, numero_casillero FROM usuarios WHERE id = $1',
        [req.body.usuario_id]
      );
      if (clienteRes.rows.length === 0) return res.status(404).json({ mensaje: 'Cliente no encontrado' });
      const nuevoCliente = clienteRes.rows[0];
      if (paquete.usuario_id === nuevoCliente.id) {
        return res.status(409).json({ mensaje: 'El paquete ya está a nombre de ese cliente.' });
      }
      await client.query('BEGIN');
      await client.query(
        'UPDATE paquetes SET usuario_id = $1, fecha_actualizacion = NOW() WHERE id = $2',
        [nuevoCliente.id, req.params.id]
      );
      // Mueve también las facturas no anuladas del paquete
      const facturas = await client.query(
        `UPDATE facturas SET usuario_id = $1
         WHERE paquete_id = $2 AND estado <> 'anulada'
         RETURNING numero_factura`,
        [nuevoCliente.id, req.params.id]
      );
      await client.query('COMMIT');
      return res.json({
        mensaje: `Paquete reasignado a ${nuevoCliente.nombre} ${nuevoCliente.apellido}.`,
        cliente: nuevoCliente,
        facturas_movidas: facturas.rows.map(f => f.numero_factura),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en PATCH /admin/paquetes/:id/cliente:', error);
      return res.status(500).json({ mensaje: 'Error interno al reasignar el paquete' });
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
    return res.status(500).json({ mensaje: 'Error interno al eliminar foto' });
  }
});

// --- DELETE /api/admin/paquetes/:id --- (elimina el paquete y, por CASCADE,
// su factura y registros de fotos; también borra las imágenes de Cloudinary)
router.delete('/:id', async (req, res) => {
  try {
    const paqId = req.params.id;
    const existe = await pool.query('SELECT id FROM paquetes WHERE id=$1', [paqId]);
    if (existe.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });

    // Borrar imágenes en Cloudinary antes de eliminar el paquete (best-effort).
    const fotos = await pool.query('SELECT public_id FROM paquete_fotos WHERE paquete_id=$1', [paqId]);
    for (const f of fotos.rows) {
      if (f.public_id) {
        try { await eliminarFotoCloudinary(f.public_id); } catch (e) { /* no bloquear el borrado */ }
      }
    }

    // El resto (facturas y paquete_fotos) se borra solo por ON DELETE CASCADE.
    await pool.query('DELETE FROM paquetes WHERE id=$1', [paqId]);
    return res.json({ mensaje: 'Paquete eliminado' });
  } catch (error) {
    console.error('Error en DELETE /admin/paquetes/:id:', error);
    return res.status(500).json({ mensaje: 'Error interno al eliminar el paquete' });
  }
});

module.exports = router;
