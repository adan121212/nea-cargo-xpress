const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { subirFotoPaquete, eliminarFotoCloudinary } = require('../../utils/cloudinary');
const { enviarCorreoCambioEstado, enviarFacturaListaParaRetiro } = require('../../utils/mailer');
const { enviarWhatsappCambioEstado } = require('../../utils/whatsapp');
const { generarNumeroFactura } = require('../../utils/factura');
const { generarPdfFactura } = require('../../utils/facturaPdf');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
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

// --- POST /api/admin/paquetes/recibir ---
router.post(
  '/recibir',
  [body('numero_tracking').trim().notEmpty().withMessage('Escanea o escribe un número de tracking')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    const tracking = req.body.numero_tracking.trim();
    try {
      const candidatos = await pool.query(
        `SELECT p.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                u.email AS cliente_email, u.telefono AS cliente_telefono, u.numero_casillero
         FROM paquetes p
         JOIN usuarios u ON u.id = p.usuario_id
         WHERE p.numero_tracking ILIKE $1 AND p.estado = 'prealertado'
         ORDER BY p.fecha_prealerta ASC`,
        [tracking]
      );
      if (candidatos.rows.length === 0) {
        return res.status(404).json({
          mensaje: `No encontramos ninguna prealerta pendiente con el tracking "${tracking}". Verifica el número, o puede que el cliente no lo haya prealertado todavía.`,
        });
      }
      if (candidatos.rows.length > 1) {
        return res.json({
          multiples: true,
          candidatos: candidatos.rows.map((p) => ({
            id: p.id,
            tienda: p.tienda,
            cliente_nombre: `${p.cliente_nombre} ${p.cliente_apellido}`,
            numero_casillero: p.numero_casillero,
          })),
        });
      }
      const paqueteEncontrado = candidatos.rows[0];
      const actualizado = await pool.query(
        `UPDATE paquetes SET estado = 'en_bodega_miami', fecha_actualizacion = NOW()
         WHERE id = $1 RETURNING *`,
        [paqueteEncontrado.id]
      );
      const paquete = actualizado.rows[0];
      const envios = { correo_enviado: false, whatsapp_enviado: false };
      try {
        await enviarCorreoCambioEstado(paqueteEncontrado.cliente_email, paqueteEncontrado.cliente_nombre, paquete);
        envios.correo_enviado = true;
      } catch (errorCorreo) {
        console.error('Error notificando recepción por correo:', errorCorreo);
      }
      if (paqueteEncontrado.cliente_telefono) {
        try {
          await enviarWhatsappCambioEstado(paqueteEncontrado.cliente_telefono, paquete);
          envios.whatsapp_enviado = true;
        } catch (errorWhatsapp) {
          console.error('Error notificando recepción por WhatsApp:', errorWhatsapp);
        }
      }
      return res.json({
        multiples: false,
        mensaje: 'Paquete recibido en bodega Miami',
        paquete,
        cliente: {
          nombre: `${paqueteEncontrado.cliente_nombre} ${paqueteEncontrado.cliente_apellido}`,
          numero_casillero: paqueteEncontrado.numero_casillero,
        },
        notificaciones: envios,
      });
    } catch (error) {
      console.error('Error en POST /admin/paquetes/recibir:', error);
      return res.status(500).json({ mensaje: 'Error interno al recibir el paquete' });
    }
  }
);

// --- POST /api/admin/paquetes/recibir/:id/confirmar ---
router.post('/recibir/:id/confirmar', async (req, res) => {
  try {
    const paqueteRes = await pool.query(
      `SELECT p.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
              u.email AS cliente_email, u.telefono AS cliente_telefono, u.numero_casillero
       FROM paquetes p
       JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.id = $1 AND p.estado = 'prealertado'`,
      [req.params.id]
    );
    if (paqueteRes.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Paquete no encontrado o ya no está prealertado' });
    }
    const info = paqueteRes.rows[0];
    const actualizado = await pool.query(
      `UPDATE paquetes SET estado = 'en_bodega_miami', fecha_actualizacion = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    const paquete = actualizado.rows[0];
    const envios = { correo_enviado: false, whatsapp_enviado: false };
    try {
      await enviarCorreoCambioEstado(info.cliente_email, info.cliente_nombre, paquete);
      envios.correo_enviado = true;
    } catch (err) { console.error('Error notificando por correo:', err); }
    if (info.cliente_telefono) {
      try {
        await enviarWhatsappCambioEstado(info.cliente_telefono, paquete);
        envios.whatsapp_enviado = true;
      } catch (err) { console.error('Error notificando por WhatsApp:', err); }
    }
    return res.json({ mensaje: 'Paquete recibido en bodega Miami', paquete, notificaciones: envios });
  } catch (error) {
    console.error('Error en POST /admin/paquetes/recibir/:id/confirmar:', error);
    return res.status(500).json({ mensaje: 'Error interno al recibir el paquete' });
  }
});

// --- GET /api/admin/paquetes ---
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
router.patch(
  '/:id/estado',
  [body('estado').isIn(ESTADOS_VALIDOS).withMessage('Estado inválido')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    try {
      const actual = await pool.query('SELECT estado FROM paquetes WHERE id = $1', [req.params.id]);
      if (actual.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }
      if (actual.rows[0].estado === 'entregado') {
        return res.status(400).json({
          mensaje: 'Este paquete ya fue entregado y su estado no se puede modificar.',
        });
      }
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
      const paquete = resultado.rows[0];
      const envios = { correo_enviado: false, whatsapp_enviado: false };
      try {
        const clienteRes = await pool.query(
          'SELECT nombre, email, telefono FROM usuarios WHERE id = $1',
          [paquete.usuario_id]
        );
        const cliente = clienteRes.rows[0];
        if (cliente) {
          try {
            await enviarCorreoCambioEstado(cliente.email, cliente.nombre, paquete);
            envios.correo_enviado = true;
          } catch (errorCorreo) {
            console.error('Error notificando cambio de estado por correo:', errorCorreo);
          }
          if (cliente.telefono) {
            try {
              await enviarWhatsappCambioEstado(cliente.telefono, paquete);
              envios.whatsapp_enviado = true;
            } catch (errorWhatsapp) {
              console.error('Error notificando cambio de estado por WhatsApp:', errorWhatsapp);
            }
          }
        }
      } catch (errorNotificacion) {
        console.error('Error obteniendo datos del cliente para notificar:', errorNotificacion);
      }
      return res.json({ mensaje: 'Estado actualizado', paquete, notificaciones: envios });
    } catch (error) {
      console.error('Error en PATCH /admin/paquetes/:id/estado:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar el estado' });
    }
  }
);

// --- PATCH /api/admin/paquetes/:id/peso ---
// El staff confirma el peso real al recibir el paquete en bodega.
// Al confirmarse (queda bloqueado con peso_confirmado = true), automáticamente:
//   1. Genera la factura (con la tarifa activa) en estado PENDIENTE de pago.
//   2. Cambia el paquete a "listo_para_retiro".
//   3. Envía al cliente: el PDF de la factura + el aviso de que puede pasar a recogerlo.
router.patch(
  '/:id/peso',
  [body('peso_real_lb').isFloat({ min: 0.01 }).withMessage('Ingresa un peso válido en libras')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const client = await pool.connect();
    try {
      const actual = await client.query('SELECT * FROM paquetes WHERE id = $1', [req.params.id]);
      if (actual.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }
      if (actual.rows[0].peso_confirmado) {
        return res.status(409).json({
          mensaje: 'El peso de este paquete ya fue confirmado y no se puede modificar. Si fue un error, contacta a un administrador.',
          peso_bloqueado: true,
        });
      }

      const paquete = actual.rows[0];
      const pesoConfirmado = req.body.peso_real_lb;

      // ¿Ya tiene una factura activa? (evita duplicar si alguien confirma dos veces)
      const facturaExistente = await client.query(
        `SELECT id FROM facturas WHERE paquete_id = $1 AND estado <> 'anulada'`,
        [req.params.id]
      );

      await client.query('BEGIN');

      // 1. Bloquea el peso
      await client.query(
        `UPDATE paquetes SET peso_real_lb = $1, peso_confirmado = TRUE, fecha_actualizacion = NOW()
         WHERE id = $2`,
        [pesoConfirmado, req.params.id]
      );

      let facturaGenerada = null;

      if (facturaExistente.rows.length === 0) {
        // Tarifa activa (la más reciente configurada — misma lógica que usa el Facturador)
        const tarifaRes = await client.query('SELECT * FROM tarifas ORDER BY id ASC LIMIT 1');
        if (tarifaRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ mensaje: 'No hay ninguna tarifa configurada. Ve a la pestaña Tarifas y crea una antes de confirmar pesos.' });
        }
        const tarifa = tarifaRes.rows[0];

        const costoEnvio = Math.max(Number(pesoConfirmado) * Number(tarifa.precio_libra), Number(tarifa.cargo_minimo));
        const seguro = paquete.valor_declarado ? (Number(paquete.valor_declarado) * Number(tarifa.pct_seguro)) / 100 : 0;
        const cargoManejo = Number(tarifa.cargo_manejo);
        const total = costoEnvio + cargoManejo + seguro;

        const insercion = await client.query(
          `INSERT INTO facturas
             (paquete_id, usuario_id, tarifa_id, peso_facturado_lb, precio_libra,
              costo_envio, cargo_manejo, seguro, total, token_pdf, estado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendiente')
           RETURNING *`,
          [
            req.params.id, paquete.usuario_id, tarifa.id,
            pesoConfirmado, tarifa.precio_libra,
            costoEnvio.toFixed(2), cargoManejo.toFixed(2), seguro.toFixed(2), total.toFixed(2),
            crypto.randomBytes(24).toString('hex'),
          ]
        );
        facturaGenerada = insercion.rows[0];
        const numeroFactura = generarNumeroFactura(facturaGenerada.id);
        await client.query('UPDATE facturas SET numero_factura = $1 WHERE id = $2', [numeroFactura, facturaGenerada.id]);
        facturaGenerada.numero_factura = numeroFactura;
      }

      // 2. El paquete pasa a listo_para_retiro
      await client.query(
        `UPDATE paquetes SET estado = 'listo_para_retiro', fecha_actualizacion = NOW()
         WHERE id = $1 AND estado NOT IN ('entregado', 'listo_para_retiro')`,
        [req.params.id]
      );

      await client.query('COMMIT');

      const paqueteActualizado = (await pool.query('SELECT * FROM paquetes WHERE id = $1', [req.params.id])).rows[0];

      // 3. Notificación: UN SOLO correo combinado (factura + listo para retiro)
      const envios = { correo_enviado: false };
      if (facturaGenerada) {
        try {
          const datosCompletos = await pool.query(
            `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                    u.email AS cliente_email, u.telefono AS cliente_telefono, u.numero_casillero,
                    p.tienda, p.numero_tracking, p.firma_base64, p.fecha_entrega
             FROM facturas f
             JOIN usuarios u ON u.id = f.usuario_id
             JOIN paquetes p ON p.id = f.paquete_id
             WHERE f.id = $1`,
            [facturaGenerada.id]
          );
          const fd = datosCompletos.rows[0];
          if (fd) {
            try {
              const pdfBuffer = await generarPdfFactura(fd);
              await enviarFacturaListaParaRetiro(fd.cliente_email, fd.cliente_nombre, fd, pdfBuffer);
              envios.correo_enviado = true;
            } catch (errCorreo) {
              console.error('Error enviando correo combinado tras confirmar peso:', errCorreo);
            }
          }
        } catch (errDatos) {
          console.error('Error obteniendo datos para notificar tras confirmar peso:', errDatos);
        }
      }

      return res.json({
        mensaje: 'Peso confirmado y bloqueado',
        paquete: paqueteActualizado,
        factura: facturaGenerada,
        envios,
      });
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
    body('largo_in').isFloat({ min: 0.1 }).withMessage('Ingresa un largo válido'),
    body('ancho_in').isFloat({ min: 0.1 }).withMessage('Ingresa un ancho válido'),
    body('alto_in').isFloat({ min: 0.1 }).withMessage('Ingresa un alto válido'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    const { largo_in, ancho_in, alto_in } = req.body;
    const DIVISOR_VOLUMETRICO = 166;
    const pesoVolumetrico = (largo_in * ancho_in * alto_in) / DIVISOR_VOLUMETRICO;
    try {
      const resultado = await pool.query(
        `UPDATE paquetes
         SET largo_in = $1, ancho_in = $2, alto_in = $3,
             peso_volumetrico_lb = $4, fecha_actualizacion = NOW()
         WHERE id = $5
         RETURNING *`,
        [largo_in, ancho_in, alto_in, pesoVolumetrico.toFixed(2), req.params.id]
      );
      if (resultado.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }
      return res.json({ mensaje: 'Dimensiones guardadas', paquete: resultado.rows[0] });
    } catch (error) {
      console.error('Error en PATCH /admin/paquetes/:id/dimensiones:', error);
      return res.status(500).json({ mensaje: 'Error interno al guardar las dimensiones' });
    }
  }
);

// --- POST /api/admin/paquetes/:id/fotos ---
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
