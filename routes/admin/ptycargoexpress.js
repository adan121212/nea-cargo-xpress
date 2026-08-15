const express = require('express');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const router = express.Router();

router.use(requiereAutenticacion, requiereAdmin);

const PTY_URL = 'https://ptycargoexpress.com/track/aut_log_consulta.php';

// --- GET /api/admin/pty/rastrear?guia=XXXXXXX ---
// Consulta el estado de un paquete en el sistema de PTY Cargo Express.
// No requiere sesión — la API de ellos es pública.
router.get('/rastrear', async (req, res) => {
  const { guia } = req.query;
  if (!guia || !guia.trim()) {
    return res.status(400).json({ mensaje: 'El número de guía es obligatorio.' });
  }
  try {
    const response = await fetch(PTY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://ptycargoexpress.com',
        'Referer': 'https://ptycargoexpress.com/track/',
        'User-Agent': 'Mozilla/5.0 (compatible; NEA-Cargo/1.0)',
      },
      body: JSON.stringify({ codigo: guia.trim(), tipo: 'tracking' }),
    });
    if (!response.ok) {
      return res.status(502).json({ mensaje: `PTY Cargo respondió con error ${response.status}.` });
    }
    const data = await response.json();
    return res.json({ resultado: data });
  } catch (err) {
    console.error('Error consultando PTY Cargo Express:', err);
    return res.status(502).json({ mensaje: 'No se pudo conectar con PTY Cargo Express.' });
  }
});

module.exports = router;
