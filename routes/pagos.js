const express = require('express');
const pool = require('../db');
const { validarRespuestaYappy } = require('../utils/yappy');

const router = express.Router();

// --- GET /api/pagos/yappy/retorno ---
// Yappy redirige aquí al cliente después de confirmar (o cancelar/rechazar)
// el pago en su app de Banco General.
// status: "E" = Ejecutado (pagado), "R" = Rechazado, "C" = Cancelado.
router.get('/yappy/retorno', async (req, res) => {
  const baseUrl = process.env.BASE_URL || '';
  const { orderId, status } = req.query;

  try {
    let valido = false;
    try {
      valido = validarRespuestaYappy(req.query);
    } catch (errorValidacion) {
      console.error('Error validando respuesta de Yappy:', errorValidacion);
    }

    if (valido && status === 'E' && orderId) {
      await pool.query(
        `UPDATE facturas SET estado = 'pagada', fecha_pago = NOW(), metodo_pago = 'yappy'
         WHERE id = $1 AND estado = 'pendiente'`,
        [orderId]
      );
      return res.redirect(`${baseUrl}/app.html?pago=exito`);
    }

    return res.redirect(`${baseUrl}/app.html?pago=fallido`);
  } catch (error) {
    console.error('Error en /pagos/yappy/retorno:', error);
    return res.redirect(`${baseUrl}/app.html?pago=error`);
  }
});

module.exports = router;
