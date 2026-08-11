const express = require('express');
const crypto = require('crypto');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { generarNumeroFactura } = require('../../utils/factura');
const { generarPdfFactura } = require('../../utils/facturaPdf');
const { enviarFacturaPorCorreo } = require('../../utils/mailer');
const { enviarFacturaPorWhatsapp } = require('../../utils/whatsapp');
const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// --- POST /api/admin/facturas ---
// Genera la factura de un paquete usando una tarifa específica.
// body: { paquete_id, tarifa_id }
router.post(
  '/',
  [
    body('paquete_id').isInt().withMessage('paquete_id es obligatorio'),
    body('tarifa_id').isInt().withMessage('tarifa_id es obligatorio'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { paquete_id, tarifa_id } = req.body;

    // ── Verificar si la caja de HOY ya fue cerrada ──────────────────────────
    // Si la caja del día de hoy está cerrada, no permitimos generar nuevas
    // facturas para mantener el cierre limpio y evitar diferencias en el corte.
    const hoy = new Date().toISOString().slice(0, 10);
    const cajaHoy = await pool.query(
      'SELECT id FROM cierres_caja WHERE fecha = $1',
      [hoy]
    );
    if (cajaHoy.rows.length > 0) {
      return res.status(409).json({
        mensaje: `La caja del ${hoy} ya fue cerrada. No se pueden generar nuevas facturas para hoy. Si necesitas facturar de todas formas, contacta a un administrador para reabrir la caja.`,
        caja_cerrada: true,
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    const client = await pool.connect();

    try {
      const paqueteRes = await client.query('SELECT * FROM paquetes WHERE id = $1', [paquete_id]);
      if (paqueteRes.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }
      const paquete = paqueteRes.rows[0];

      const pesoFacturado = paquete.peso_real_lb ?? paquete.peso_lb;
      if (!pesoFacturado) {
        return res.status(400).json({
          mensaje: 'Este paquete no tiene un peso registrado. Confirma el peso real antes de facturar.',
        });
      }

      const tarifaRes = await client.query('SELECT * FROM tarifas WHERE id = $1', [tarifa_id]);
      if (tarifaRes.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Tarifa no encontrada' });
      }
      const tarifa = tarifaRes.rows[0];

      const yaFacturado = await client.query(
        `SELECT id FROM facturas WHERE paquete_id = $1 AND estado <> 'anulada'`,
        [paquete_id]
      );
      if (yaFacturado.rows.length > 0) {
        return res.status(409).json({ mensaje: 'Este paquete ya tiene una factura activa.' });
      }

      const costoEnvio = Math.max(
        Number(pesoFacturado) * Number(tarifa.precio_libra),
        Number(tarifa.cargo_minimo)
      );
      const seguro = paquete.valor_declarado
        ? (Number(paquete.valor_declarado) * Number(tarifa.pct_seguro)) / 100
        : 0;
      const cargoManejo = Number(tarifa.cargo_manejo);
      const total = costoEnvio + cargoManejo + seguro;

      await client.query('BEGIN');

      const insercion = await client.query(
        `INSERT INTO facturas
           (paquete_id, usuario_id, tarifa_id, peso_facturado_lb, precio_libra,
            costo_envio, cargo_manejo, seguro, total, token_pdf)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          paquete_id,
          paquete.usuario_id,
          tarifa_id,
          pesoFacturado,
          tarifa.precio_libra,
          costoEnvio.toFixed(2),
          cargoManejo.toFixed(2),
          seguro.toFixed(2),
          total.toFixed(2),
          crypto.randomBytes(24).toString('hex'),
        ]
      );

      const factura = insercion.rows[0];
      const numeroFactura = generarNumeroFactura(factura.id);

      await client.query('UPDATE facturas SET numero_factura = $1 WHERE id = $2', [
        numeroFactura,
        factura.id,
      ]);

      // Al generar la factura el paquete pasa a listo_para_retiro — ya está
      // pesado y facturado, solo falta que el cliente venga a pagar y retirarlo.
      await client.query(
        `UPDATE paquetes SET estado = 'listo_para_retiro', fecha_actualizacion = NOW()
         WHERE id = $1 AND estado NOT IN ('entregado', 'listo_para_retiro')`,
        [paquete_id]
      );

      await client.query('COMMIT');

      const facturaCompleta = { ...factura, numero_factura: numeroFactura };

      // Trae los datos del cliente y del paquete para el PDF y los mensajes.
      const datosCompletos = await pool.query(
        `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                u.email AS cliente_email, u.telefono AS cliente_telefono, u.numero_casillero,
                p.tienda, p.numero_tracking, p.firma_base64, p.fecha_entrega
         FROM facturas f
         JOIN usuarios u ON u.id = f.usuario_id
         JOIN paquetes p ON p.id = f.paquete_id
         WHERE f.id = $1`,
        [factura.id]
      );
      const facturaParaEnvio = datosCompletos.rows[0];

      const envios = { correo_enviado: false, whatsapp_enviado: false, errores_envio: [] };

      // Correo con PDF adjunto (no bloquea la respuesta si falla).
      try {
        const pdfBuffer = await generarPdfFactura(facturaParaEnvio);
        await enviarFacturaPorCorreo(
          facturaParaEnvio.cliente_email,
          facturaParaEnvio.cliente_nombre,
          facturaParaEnvio,
          pdfBuffer
        );
        envios.correo_enviado = true;
      } catch (errorCorreo) {
        console.error('Error enviando factura por correo:', errorCorreo);
        envios.errores_envio.push(`Correo: ${errorCorreo.message}`);
      }

      // WhatsApp con el link al PDF (solo si el cliente tiene teléfono y Twilio está configurado).
      if (facturaParaEnvio.cliente_telefono) {
        try {
          const urlPdfPublica = `${process.env.BASE_URL}/api/public/facturas/${facturaParaEnvio.token_pdf}/pdf`;
          await enviarFacturaPorWhatsapp(facturaParaEnvio.cliente_telefono, facturaParaEnvio, urlPdfPublica);
          envios.whatsapp_enviado = true;
        } catch (errorWhatsapp) {
          console.error('Error enviando factura por WhatsApp:', errorWhatsapp);
          envios.errores_envio.push(`WhatsApp: ${errorWhatsapp.message}`);
        }
      } else {
        envios.errores_envio.push('WhatsApp: el cliente no tiene teléfono registrado.');
      }

      return res.status(201).json({
        mensaje: 'Factura generada',
        factura: facturaCompleta,
        envios,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en POST /admin/facturas:', error);
      return res.status(500).json({ mensaje: 'Error interno al generar la factura' });
    } finally {
      client.release();
    }
  }
);

// --- GET /api/admin/facturas ---
// Lista todas las facturas, con filtros opcionales: ?estado=pendiente&email=ana@ejemplo.com
router.get(
  '/',
  [
    query('estado').optional().isIn(['pendiente', 'pagada', 'anulada']),
    query('email').optional().trim(),
  ],
  async (req, res) => {
    const { estado, email } = req.query;
    const condiciones = [];
    const valores = [];

    if (estado) {
      valores.push(estado);
      condiciones.push(`f.estado = $${valores.length}`);
    }
    if (email) {
      valores.push(`%${email}%`);
      condiciones.push(`u.email ILIKE $${valores.length}`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    try {
      const resultado = await pool.query(
        `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido, u.email AS cliente_email,
                p.id AS paquete_id, p.tienda, p.numero_tracking, p.estado AS paquete_estado
         FROM facturas f
         JOIN usuarios u ON u.id = f.usuario_id
         JOIN paquetes p ON p.id = f.paquete_id
         ${where}
         ORDER BY f.fecha_creacion DESC
         LIMIT 200`,
        valores
      );
      return res.json({ facturas: resultado.rows });
    } catch (error) {
      console.error('Error en GET /admin/facturas:', error);
      return res.status(500).json({ mensaje: 'Error interno al listar facturas' });
    }
  }
);

// --- PATCH /api/admin/facturas/:id/estado ---
// Marca una factura como pagada o anulada.
// Si se anula, requiere codigo_anulacion = '1234'.
// Si la factura pagada pertenece a un cierre ya cerrado, crea nota de ajuste.
router.patch(
  '/:id/estado',
  [body('estado').isIn(['pendiente', 'pagada', 'anulada']).withMessage('Estado inválido')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    // Validar código de anulación
    if (req.body.estado === 'anulada') {
      if (req.body.codigo_anulacion !== '1234') {
        return res.status(403).json({ mensaje: 'Código de anulación incorrecto.' });
      }
    }

    const fechaPago = req.body.estado === 'pagada' ? 'NOW()' : 'NULL';

    try {
      // Traer la factura actual antes de cambiarla
      const facturaActual = await pool.query(
        `SELECT f.*, p.fecha_actualizacion AS fecha_pago_real
         FROM facturas f
         JOIN paquetes p ON p.id = f.paquete_id
         WHERE f.id = $1`,
        [req.params.id]
      );
      if (facturaActual.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Factura no encontrada' });
      }
      const facturaAntes = facturaActual.rows[0];

      const resultado = await pool.query(
        `UPDATE facturas SET estado = $1, fecha_pago = ${fechaPago} WHERE id = $2 RETURNING *`,
        [req.body.estado, req.params.id]
      );

      let nota_ajuste = null;

      // Al anular: liberar el paquete para que pueda refacturarse
      if (req.body.estado === 'anulada') {
        await pool.query(
          `UPDATE paquetes SET estado = 'listo_para_retiro', fecha_actualizacion = NOW()
           WHERE id = (SELECT paquete_id FROM facturas WHERE id = $1)
           AND estado NOT IN ('entregado')`,
          [req.params.id]
        );
      }

      // Si se está anulando una factura que estaba pagada, verificar si su caja ya está cerrada
      if (req.body.estado === 'anulada' && facturaAntes.estado === 'pagada' && facturaAntes.fecha_pago) {
        const fechaPagoStr = new Date(facturaAntes.fecha_pago).toISOString().slice(0, 10);
        const cierreDia = await pool.query(
          'SELECT id FROM cierres_caja WHERE fecha = $1',
          [fechaPagoStr]
        );
        if (cierreDia.rows.length > 0) {
          // Crear nota de ajuste en el cierre
          const textoNota = `AJUSTE: Factura ${facturaAntes.numero_factura} anulada (−$${Number(facturaAntes.total).toFixed(2)}) — ${req.body.motivo || 'sin motivo especificado'}`;
          await pool.query(
            `UPDATE cierres_caja SET notas = COALESCE(notas || E'\\n', '') || $1 WHERE fecha = $2`,
            [textoNota, fechaPagoStr]
          );
          nota_ajuste = { fecha: fechaPagoStr, texto: textoNota };
        }
      }

      return res.json({
        mensaje: 'Estado de factura actualizado',
        factura: resultado.rows[0],
        nota_ajuste,
      });
    } catch (error) {
      console.error('Error en PATCH /admin/facturas/:id/estado:', error);
      return res.status(500).json({ mensaje: 'Error interno al actualizar la factura' });
    }
  }
);

// --- GET /api/admin/facturas/:id/pdf ---
// El admin puede ver el PDF de cualquier factura (no solo las propias).
router.get('/:id/pdf', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
              u.email AS cliente_email, u.numero_casillero, p.tienda, p.numero_tracking,
              p.firma_base64, p.fecha_entrega
       FROM facturas f
       JOIN usuarios u ON u.id = f.usuario_id
       JOIN paquetes p ON p.id = f.paquete_id
       WHERE f.id = $1`,
      [req.params.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Factura no encontrada' });
    }

    const pdfBuffer = await generarPdfFactura(resultado.rows[0]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${resultado.rows[0].numero_factura}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error en GET /admin/facturas/:id/pdf:', error);
    return res.status(500).json({ mensaje: 'Error interno al generar el PDF' });
  }
});

// --- POST /api/admin/facturas/:id/reenviar ---
// Reenvía una factura ya existente por correo (con PDF) y WhatsApp.
router.post('/:id/reenviar', async (req, res) => {
  try {
    const resultado = await pool.query(
      `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
              u.email AS cliente_email, u.telefono AS cliente_telefono, u.numero_casillero,
              p.tienda, p.numero_tracking, p.firma_base64, p.fecha_entrega
       FROM facturas f
       JOIN usuarios u ON u.id = f.usuario_id
       JOIN paquetes p ON p.id = f.paquete_id
       WHERE f.id = $1`,
      [req.params.id]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Factura no encontrada' });
    }

    const factura = resultado.rows[0];

    if (!factura.token_pdf) {
      const nuevoToken = crypto.randomBytes(24).toString('hex');
      await pool.query('UPDATE facturas SET token_pdf = $1 WHERE id = $2', [nuevoToken, factura.id]);
      factura.token_pdf = nuevoToken;
    }

    const envios = { correo_enviado: false, whatsapp_enviado: false, errores_envio: [] };

    try {
      const pdfBuffer = await generarPdfFactura(factura);
      await enviarFacturaPorCorreo(factura.cliente_email, factura.cliente_nombre, factura, pdfBuffer);
      envios.correo_enviado = true;
    } catch (errorCorreo) {
      console.error('Error reenviando factura por correo:', errorCorreo);
      envios.errores_envio.push(`Correo: ${errorCorreo.message}`);
    }

    if (factura.cliente_telefono) {
      try {
        const urlPdfPublica = `${process.env.BASE_URL}/api/public/facturas/${factura.token_pdf}/pdf`;
        await enviarFacturaPorWhatsapp(factura.cliente_telefono, factura, urlPdfPublica);
        envios.whatsapp_enviado = true;
      } catch (errorWhatsapp) {
        console.error('Error reenviando factura por WhatsApp:', errorWhatsapp);
        envios.errores_envio.push(`WhatsApp: ${errorWhatsapp.message}`);
      }
    } else {
      envios.errores_envio.push('WhatsApp: el cliente no tiene teléfono registrado.');
    }

    return res.json({ mensaje: 'Reenvío procesado', envios });
  } catch (error) {
    console.error('Error en POST /admin/facturas/:id/reenviar:', error);
    return res.status(500).json({ mensaje: 'Error interno al reenviar la factura' });
  }
});

// --- POST /api/admin/facturas/generar-y-cobrar ---
// Genera la factura, la cobra y cambia el paquete a listo_para_retiro en un solo paso.
// Usado por el Facturador al apretar "Generar y cobrar".
router.post(
  '/generar-y-cobrar',
  [
    body('paquete_id').isInt().withMessage('paquete_id es obligatorio'),
    body('tarifa_id').isInt().withMessage('tarifa_id es obligatorio'),
    body('metodo_pago').isIn(['efectivo', 'tarjeta', 'transferencia', 'yappy']).withMessage('Método de pago inválido'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { paquete_id, tarifa_id, metodo_pago } = req.body;

    // Verificar caja cerrada
    const hoy = new Date().toISOString().slice(0, 10);
    const cajaHoy = await pool.query('SELECT id FROM cierres_caja WHERE fecha = $1', [hoy]);
    if (cajaHoy.rows.length > 0) {
      return res.status(409).json({
        mensaje: `La caja del ${hoy} ya fue cerrada. No se pueden generar facturas hoy.`,
        caja_cerrada: true,
      });
    }

    const client = await pool.connect();
    try {
      const paqueteRes = await client.query('SELECT * FROM paquetes WHERE id = $1', [paquete_id]);
      if (paqueteRes.rows.length === 0) return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      const paquete = paqueteRes.rows[0];

      const pesoFacturado = paquete.peso_real_lb ?? paquete.peso_lb;
      if (!pesoFacturado || Number(pesoFacturado) === 0) {
        return res.status(400).json({ mensaje: 'El paquete no tiene peso registrado. Ve a Paquetes e ingrésalo primero.' });
      }

      const tarifaRes = await client.query('SELECT * FROM tarifas WHERE id = $1', [tarifa_id]);
      if (tarifaRes.rows.length === 0) return res.status(404).json({ mensaje: 'Tarifa no encontrada' });
      const tarifa = tarifaRes.rows[0];

      const yaFacturado = await client.query(
        `SELECT id FROM facturas WHERE paquete_id = $1 AND estado <> 'anulada'`,
        [paquete_id]
      );
      if (yaFacturado.rows.length > 0) {
        return res.status(409).json({ mensaje: 'Este paquete ya tiene una factura activa.' });
      }

      const costoEnvio = Math.max(Number(pesoFacturado) * Number(tarifa.precio_libra), Number(tarifa.cargo_minimo));
      const seguro = paquete.valor_declarado ? (Number(paquete.valor_declarado) * Number(tarifa.pct_seguro)) / 100 : 0;
      const cargoManejo = Number(tarifa.cargo_manejo);
      const total = costoEnvio + cargoManejo + seguro;

      await client.query('BEGIN');

      // 1. Insertar factura
      const insercion = await client.query(
        `INSERT INTO facturas
           (paquete_id, usuario_id, tarifa_id, peso_facturado_lb, precio_libra,
            costo_envio, cargo_manejo, seguro, total, token_pdf,
            estado, fecha_pago, metodo_pago)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pagada',NOW(),$11)
         RETURNING *`,
        [
          paquete_id, paquete.usuario_id, tarifa_id,
          pesoFacturado, tarifa.precio_libra,
          costoEnvio.toFixed(2), cargoManejo.toFixed(2), seguro.toFixed(2), total.toFixed(2),
          require('crypto').randomBytes(24).toString('hex'),
          metodo_pago,
        ]
      );
      const factura = insercion.rows[0];
      const { generarNumeroFactura } = require('../../utils/factura');
      const numeroFactura = generarNumeroFactura(factura.id);
      await client.query('UPDATE facturas SET numero_factura = $1 WHERE id = $2', [numeroFactura, factura.id]);

      // 2. Cambiar paquete a listo_para_retiro
      await client.query(
        `UPDATE paquetes SET estado = 'listo_para_retiro', fecha_actualizacion = NOW()
         WHERE id = $1 AND estado NOT IN ('entregado','listo_para_retiro')`,
        [paquete_id]
      );

      await client.query('COMMIT');

      const facturaCompleta = { ...factura, numero_factura: numeroFactura };

      // 3. Enviar correo con PDF (best-effort)
      const envios = { correo_enviado: false };
      try {
        const datosCompletos = await pool.query(
          `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                  u.email AS cliente_email, u.telefono AS cliente_telefono, u.numero_casillero,
                  p.tienda, p.numero_tracking, p.firma_base64, p.fecha_entrega
           FROM facturas f
           JOIN usuarios u ON u.id = f.usuario_id
           JOIN paquetes p ON p.id = f.paquete_id
           WHERE f.id = $1`,
          [factura.id]
        );
        const { generarPdfFactura } = require('../../utils/facturaPdf');
        const { enviarFacturaPorCorreo, enviarCorreoCambioEstado } = require('../../utils/mailer');
        const fd = datosCompletos.rows[0];
        if (fd) {
          const pdfBuffer = await generarPdfFactura(fd);
          await enviarFacturaPorCorreo(fd.cliente_email, fd.cliente_nombre, fd, pdfBuffer);
          envios.correo_enviado = true;
          // Correo de "listo para retiro"
          await enviarCorreoCambioEstado(fd.cliente_email, fd.cliente_nombre, {
            estado: 'listo_para_retiro',
            tienda: fd.tienda,
            numero_tracking: fd.numero_tracking,
          });
        }
      } catch (errorCorreo) {
        console.error('Error enviando correo generar-y-cobrar:', errorCorreo);
      }

      return res.status(201).json({
        mensaje: 'Factura generada y cobrada. Paquete listo para retiro.',
        factura: facturaCompleta,
        envios,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en POST /admin/facturas/generar-y-cobrar:', error);
      return res.status(500).json({ mensaje: 'Error interno al generar y cobrar la factura' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
