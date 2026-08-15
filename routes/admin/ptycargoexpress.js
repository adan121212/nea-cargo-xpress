const express = require('express');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const pool = require('../../db');
const router = express.Router();

router.use(requiereAutenticacion, requiereAdmin);

const PTY_BASE = 'https://carga.ptycargoexpress.com';
const PTY_TRACK_URL = `${PTY_BASE}/ajax.php`;
const PTY_RASTREO_URL = 'https://ptycargoexpress.com/track/aut_log_consulta.php';

// Obtener PHPSESSID desde variable de entorno
function getSesion() {
  return process.env.PTY_PHPSESSID || '';
}

// --- GET /api/admin/pty/paquetes ---
// Trae la lista de paquetes desde PTY Cargo Express
router.get('/paquetes', async (req, res) => {
  const sesion = getSesion();
  if (!sesion) {
    return res.status(503).json({ mensaje: 'Sesión PTY no configurada. Agrega PTY_PHPSESSID en las variables de entorno de Render.' });
  }
  const pagina = parseInt(req.query.pagina) || 1;
  const porPagina = parseInt(req.query.porPagina) || 100;
  try {
    const body = new URLSearchParams({
      accion: 'tracking',
      pagina: String(pagina),
      orderCol: 'Fecha',
      orderDir: 'DESC',
      porPagina: String(porPagina),
      filtro: req.query.filtro || '',
    });
    const response = await fetch(PTY_TRACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `PHPSESSID=${sesion}`,
        'Origin': PTY_BASE,
        'Referer': `${PTY_BASE}/dashboard.php`,
        'User-Agent': 'Mozilla/5.0 (compatible; NEA-Cargo/1.0)',
      },
      body: body.toString(),
    });
    if (!response.ok) {
      return res.status(502).json({ mensaje: `PTY Cargo respondió con error ${response.status}.` });
    }
    const data = await response.json();
    if (!data.success) {
      return res.status(401).json({ mensaje: 'Sesión PTY expirada. Actualiza PTY_PHPSESSID en Render.' });
    }
    const items = data.data?.items || [];
    // Comparar con paquetes que ya existen en NEA
    const trackingsNea = await pool.query(
      `SELECT numero_tracking FROM paquetes WHERE numero_tracking = ANY($1)`,
      [items.map(i => i.TrackingNum).filter(Boolean)]
    );
    const yaEnNea = new Set(trackingsNea.rows.map(r => r.numero_tracking.toLowerCase()));
    const enriquecidos = items.map(p => ({
      ...p,
      ya_en_nea: yaEnNea.has((p.TrackingNum || '').toLowerCase()),
    }));
    return res.json({
      paquetes: enriquecidos,
      total: data.data?.total || items.length,
      paginas: data.data?.paginas || 1,
      pagina,
    });
  } catch (err) {
    console.error('Error consultando PTY Cargo Express:', err);
    return res.status(502).json({ mensaje: 'No se pudo conectar con PTY Cargo Express.' });
  }
});

// --- POST /api/admin/pty/importar ---
// Importa uno o varios paquetes de PTY a la bodega de NEA
// Body: { paquetes: [{ TrackingNum, WHR, Peso, Referencias, Piezas, Fecha, Status, Comentario }], usuario_id? }
router.post('/importar', async (req, res) => {
  const { paquetes } = req.body;
  if (!Array.isArray(paquetes) || paquetes.length === 0) {
    return res.status(400).json({ mensaje: 'Envía al menos un paquete para importar.' });
  }

  const resultados = { importados: [], duplicados: [], errores: [] };

  for (const p of paquetes) {
    if (!p.TrackingNum) { resultados.errores.push({ tracking: '—', error: 'Sin número de tracking' }); continue; }
    try {
      // Verificar si ya existe
      const existe = await pool.query(
        'SELECT id FROM paquetes WHERE numero_tracking = $1', [p.TrackingNum]
      );
      if (existe.rows.length > 0) {
        resultados.duplicados.push(p.TrackingNum);
        continue;
      }
      // Detectar usuario por casillero si viene en Consignatario (ej. PTY12886)
      let usuarioId = req.body.usuario_id || null;
      if (!usuarioId && p.Consignatario) {
        const match = p.Consignatario.match(/PTY(\d+)/i);
        if (match) {
          const casillero = `PTY-${match[1]}`;
          const u = await pool.query(
            'SELECT id FROM usuarios WHERE numero_casillero = $1 LIMIT 1', [casillero]
          );
          if (u.rows.length > 0) usuarioId = u.rows[0].id;
        }
      }
      // Mapear estado PTY → estado NEA
      const estadoMap = {
        'En Bodega': 'en_bodega_miami',
        'En Transito': 'en_transito',
        'En tránsito': 'en_transito',
        'En Panamá': 'en_panama',
        'En Panama': 'en_panama',
        'Entregado': 'entregado',
        'Listo': 'listo_para_retiro',
      };
      const estadoNea = estadoMap[p.Status] || 'en_bodega_miami';
      // Tienda: intentar extraer de Referencias, si no usar 'PTY Cargo'
      const tienda = p.Referencias?.trim() || 'PTY Cargo Express';
      const pesoLb = parseFloat(p.Peso) || null;
      await pool.query(
        `INSERT INTO paquetes
           (usuario_id, numero_tracking, tienda, estado, peso_lb,
            descripcion, fecha_prealerta, fecha_actualizacion)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
        [
          usuarioId,
          p.TrackingNum,
          tienda,
          estadoNea,
          pesoLb,
          p.Comentario ? p.Comentario.substring(0, 255) : null,
        ]
      );
      resultados.importados.push(p.TrackingNum);
    } catch (err) {
      console.error(`Error importando ${p.TrackingNum}:`, err);
      resultados.errores.push({ tracking: p.TrackingNum, error: err.message });
    }
  }

  return res.json({
    mensaje: `Importados: ${resultados.importados.length} · Duplicados: ${resultados.duplicados.length} · Errores: ${resultados.errores.length}`,
    ...resultados,
  });
});

// --- GET /api/admin/pty/rastrear?guia=XXX ---
// Consulta estado de un tracking específico (API pública, sin sesión)
router.get('/rastrear', async (req, res) => {
  const { guia } = req.query;
  if (!guia?.trim()) return res.status(400).json({ mensaje: 'El número de guía es obligatorio.' });
  try {
    const response = await fetch(PTY_RASTREO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://ptycargoexpress.com',
        'Referer': 'https://ptycargoexpress.com/track/',
        'User-Agent': 'Mozilla/5.0 (compatible; NEA-Cargo/1.0)',
      },
      body: JSON.stringify({ codigo: guia.trim(), tipo: 'tracking' }),
    });
    if (!response.ok) return res.status(502).json({ mensaje: `PTY respondió con error ${response.status}.` });
    const data = await response.json();
    // PTY devuelve {"ok":true} cuando no encuentra el tracking
    if(data && Object.keys(data).length === 1 && data.ok === true){
      return res.status(404).json({ mensaje: 'No se encontró ese número de tracking en PTY Cargo Express.' });
    }
    return res.json({ resultado: data });
  } catch (err) {
    console.error('Error consultando PTY rastreo:', err);
    return res.status(502).json({ mensaje: 'No se pudo conectar con PTY Cargo Express.' });
  }
});

module.exports = router;
