const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool = require('../../db');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const { generarPdfFactura } = require('../../utils/facturaPdf');
const { enviarFacturaPorCorreo } = require('../../utils/mailer');
const { enviarFacturaPorWhatsapp } = require('../../utils/whatsapp');
const router = express.Router();
router.use(requiereAutenticacion, requiereAdmin);

// --- GET /api/admin/mostrador/buscar?q=... ---
router.get(
  '/buscar',
  [query('q').trim().notEmpty().withMessage('Escribe un casillero, nombre, correo o tracking')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    const q = `%${req.query.q}%`;
    try {
      const usuarioRes = await pool.query(
        `SELECT DISTINCT u.id, u.nombre, u.apellido, u.email, u.telefono, u.numero_casillero
         FROM usuarios u
         LEFT JOIN paquetes p ON p.usuario_id = u.id
         WHERE u.numero_casillero ILIKE $1
            OR u.email ILIKE $1
            OR (u.nombre || ' ' || u.apellido) ILIKE $1
            OR p.numero_tracking ILIKE $1
         LIMIT 5`,
        [q]
      );
      if (usuarioRes.rows.length === 0) {
        return res.status(404).json({ mensaje: 'No encontramos ningún cliente con esos datos.' });
      }
      if (usuarioRes.rows.length > 1) {
        return res.json({ multiples: true, clientes: usuarioRes.rows });
      }
      const usuario = usuarioRes.rows[0];

      const autorizadosRes = await pool.query(
        `SELECT id, nombre, cedula FROM autorizados WHERE usuario_id = $1 ORDER BY id ASC`,
        [usuario.id]
      );

      const paquetesRes = await pool.query(
        `SELECT p.*,
                f.id AS factura_id, f.numero_factura, f.total AS factura_total,
                f.estado AS factura_estado
         FROM paquetes p
         LEFT JOIN LATERAL (
           SELECT * FROM facturas
           WHERE paquete_id = p.id AND estado <> 'anulada'
           ORDER BY fecha_creacion DESC LIMIT 1
         ) f ON TRUE
         WHERE p.usuario_id = $1 AND p.estado <> 'entregado'
         ORDER BY p.fecha_prealerta DESC`,
        [usuario.id]
      );

      const facturasPendientesRes = await pool.query(
        `SELECT f.id, f.numero_factura, f.total, f.fecha_creacion,
                p.tienda, p.numero_tracking, p.estado AS paquete_estado
         FROM facturas f
         JOIN paquetes p ON p.id = f.paquete_id
         WHERE f.usuario_id = $1 AND f.estado = 'pendiente'
         ORDER BY f.fecha_creacion ASC`,
        [usuario.id]
      );

      return res.json({
        multiples: false,
        cliente: usuario,
        autorizados: autorizadosRes.rows,
        paquetes: paquetesRes.rows,
        facturas_pendientes: facturasPendientesRes.rows,
      });
    } catch (error) {
      console.error('Error en GET /admin/mostrador/buscar:', error);
      return res.status(500).json({ mensaje: 'Error interno al buscar el cliente' });
    }
  }
);

// --- POST /api/admin/mostrador/entregar ---
router.post(
  '/entregar',
  [
    body('paquete_id').isInt().withMessage('paquete_id es obligatorio'),
    body('factura_id').optional({ nullable: true }).isInt(),
    body('metodo_pago').optional({ nullable: true }).isIn(['efectivo', 'tarjeta', 'transferencia', 'yappy']),
    body('firma')
      .notEmpty().withMessage('Se requiere la firma digital del cliente para entregar el paquete.')
      .matches(/^data:image\/png;base64,/).withMessage('Formato de firma inválido.'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    const { paquete_id, factura_id, metodo_pago, firma } = req.body;
    const client = await pool.connect();

    try {
      const paqueteRes = await client.query('SELECT * FROM paquetes WHERE id = $1', [paquete_id]);
      if (paqueteRes.rows.length === 0) {
        return res.status(404).json({ mensaje: 'Paquete no encontrado' });
      }
      if (paqueteRes.rows[0].estado === 'entregado') {
        return res.status(400).json({ mensaje: 'Este paquete ya fue entregado.' });
      }

      await client.query('BEGIN');

      if (factura_id) {
        const facturaRes = await client.query('SELECT * FROM facturas WHERE id = $1', [factura_id]);
        if (facturaRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ mensaje: 'Factura no encontrada' });
        }
        if (facturaRes.rows[0].estado === 'pendiente') {
          if (!metodo_pago) {
            await client.query('ROLLBACK');
            return res.status(400).json({ mensaje: 'Indica el método de pago para cobrar esta factura.' });
          }
          await client.query(
            `UPDATE facturas SET estado = 'pagada', fecha_pago = NOW(), metodo_pago = $1 WHERE id = $2`,
            [metodo_pago, factura_id]
          );
        }
      }

      const actualizado = await client.query(
        `UPDATE paquetes
         SET estado = 'entregado',
             fecha_actualizacion = NOW(),
             fecha_entrega = NOW(),
             firma_base64 = $1
         WHERE id = $2
         RETURNING *`,
        [firma, paquete_id]
      );

      await client.query('COMMIT');
      const paquete = actualizado.rows[0];

      const envios = { correo_enviado: false, whatsapp_enviado: false };
      if (factura_id) {
        try {
          const datosCompletos = await pool.query(
            `SELECT f.*, u.nombre AS cliente_nombre, u.apellido AS cliente_apellido,
                    u.email AS cliente_email, u.telefono AS cliente_telefono, u.numero_casillero,
                    p.tienda, p.numero_tracking, p.firma_base64, p.fecha_entrega
             FROM facturas f
             JOIN usuarios u ON u.id = f.usuario_id
             JOIN paquetes p ON p.id = f.paquete_id
             WHERE f.id = $1`,
            [factura_id]
          );
          const facturaCompleta = datosCompletos.rows[0];
          if (facturaCompleta) {
            try {
              const pdfBuffer = await generarPdfFactura(facturaCompleta);
              await enviarFacturaPorCorreo(
                facturaCompleta.cliente_email,
                facturaCompleta.cliente_nombre,
                facturaCompleta,
                pdfBuffer
              );
              envios.correo_enviado = true;
            } catch (errorCorreo) {
              console.error('Error enviando factura tras entrega (correo):', errorCorreo);
            }
            if (facturaCompleta.cliente_telefono && facturaCompleta.token_pdf) {
              try {
                const urlPdfPublica = `${process.env.BASE_URL}/api/public/facturas/${facturaCompleta.token_pdf}/pdf`;
                await enviarFacturaPorWhatsapp(facturaCompleta.cliente_telefono, facturaCompleta, urlPdfPublica);
                envios.whatsapp_enviado = true;
              } catch (errorWhatsapp) {
                console.error('Error enviando factura tras entrega (WhatsApp):', errorWhatsapp);
              }
            }
          }
        } catch (errorFactura) {
          console.error('Error obteniendo la factura para reenviarla tras la entrega:', errorFactura);
        }
      }

      return res.json({
        mensaje: 'Paquete entregado correctamente',
        paquete,
        envios_factura: envios,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error en POST /admin/mostrador/entregar:', error);
      return res.status(500).json({ mensaje: 'Error interno al procesar la entrega' });
    } finally {
      client.release();
    }
  }
);

// --- POST /api/admin/mostrador/cobrar ---
router.post(
  '/cobrar',
  [
    body('factura_id').isInt().withMessage('factura_id es obligatorio'),
    body('metodo_pago').isIn(['efectivo', 'tarjeta', 'transferencia', 'yappy']).withMessage('Indica el método de pago'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }
    try {
      const resultado = await pool.query(
        `UPDATE facturas SET estado = 'pagada', fecha_pago = NOW(), metodo_pago = $1
         WHERE id = $2 AND estado = 'pendiente'
         RETURNING *`,
        [req.body.metodo_pago, req.body.factura_id]
      );
      if (resultado.rows.length === 0) {
        return res.status(400).json({ mensaje: 'Esta factura ya no está pendiente.' });
      }
      return res.json({ mensaje: 'Factura cobrada correctamente', factura: resultado.rows[0] });
    } catch (error) {
      console.error('Error en POST /admin/mostrador/cobrar:', error);
      return res.status(500).json({ mensaje: 'Error interno al cobrar la factura' });
    }
  }
);

module.exports = router;
