const express = require('express');
const pool = require('../db');

const router = express.Router();

// --- GET/POST /api/pagos/retorno ---
// PagueloFacil redirige aquí al cliente después de intentar pagar.
// Si el pago fue aprobado, marcamos la factura como pagada y mandamos
// al cliente de vuelta a su dashboard con un mensaje de éxito o error.
router.all('/retorno', async (req, res) => {
  const datos = { ...req.query, ...req.body };
  const totalPagado = parseFloat(datos.TotalPagado || '0');
  const estado = datos.Estado;
  const facturaId = datos.PARM_1;

  const baseUrl = process.env.BASE_URL || '';

  try {
    if (totalPagado > 0 && estado === 'Aprobada' && facturaId) {
      await pool.query(
        `UPDATE facturas SET estado = 'pagada', fecha_pago = NOW(), metodo_pago = 'pagueloFacil'
         WHERE id = $1 AND estado = 'pendiente'`,
        [facturaId]
      );
      return res.redirect(`${baseUrl}/app.html?pago=exito`);
    }

    return res.redirect(`${baseUrl}/app.html?pago=fallido`);
  } catch (error) {
    console.error('Error en /pagos/retorno:', error);
    return res.redirect(`${baseUrl}/app.html?pago=error`);
  }
});

// --- POST /api/pagos/webhook ---
// Confirmación asíncrona server-to-server. PagueloFacil debe configurar esta
// URL manualmente (escribiendo a customerservice@paguelofacil.com). Es la
// vía más confiable, ya que el retorno del navegador puede manipularse.
router.post('/webhook', async (req, res) => {
  const evento = req.body;

  try {
    const operacionesQueAcreditan = ['CAPTURE', 'AUTH_CAPTURE', 'RECURRENT'];
    const esAcreditado = evento.status === 1 && operacionesQueAcreditan.includes(evento.operationType);

    if (!esAcreditado) {
      return res.status(200).json({ recibido: true, acreditado: false });
    }

    // La descripción se armó como "Factura FAC-000123 - NEA Cargo Xpress"
    const match = (evento.description || '').match(/FAC-\d+/);
    if (!match) {
      console.warn('Webhook de PagueloFacil sin número de factura reconocible:', evento.description);
      return res.status(200).json({ recibido: true, acreditado: false });
    }

    const numeroFactura = match[0];
    await pool.query(
      `UPDATE facturas SET estado = 'pagada', fecha_pago = NOW(), metodo_pago = 'pagueloFacil'
       WHERE numero_factura = $1 AND estado = 'pendiente'`,
      [numeroFactura]
    );

    return res.status(200).json({ recibido: true, acreditado: true });
  } catch (error) {
    console.error('Error en /pagos/webhook:', error);
    return res.status(500).json({ mensaje: 'Error interno procesando el webhook' });
  }
});

module.exports = router;
