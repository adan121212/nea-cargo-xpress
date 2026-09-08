const express = require('express');
const cheerio = require('cheerio');
const { requiereAutenticacion } = require('../../middleware/auth');
const { requiereAdmin } = require('../../middleware/admin');
const pool = require('../../db');
const router = express.Router();

router.use(requiereAutenticacion, requiereAdmin);

const PTY_BASE = 'https://carga.ptycargoexpress.com';
const PTY_TRACK_URL = `${PTY_BASE}/ajax.php`;
const PTY_RASTREO_URL = 'https://ptycargoexpress.com/track/aut_log_consulta.php';

// Obtener PHPSESSID desde variable de entorno (respaldo manual, opcional)
function getSesion() {
  return process.env.PTY_PHPSESSID || '';
}

// Extrae el PHPSESSID de las cabeceras Set-Cookie de una respuesta fetch,
// soportando tanto getSetCookie() (Node 18.14+) como el fallback de un solo header.
function extraerPhpSessId(headers) {
  let cookies = [];
  if (typeof headers.getSetCookie === 'function') {
    cookies = headers.getSetCookie();
  } else {
    const raw = headers.get('set-cookie');
    if (raw) cookies = [raw];
  }
  for (const c of cookies) {
    const m = c.match(/PHPSESSID=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

// Inicia sesión en PTY Cargo Express usando usuario/contraseña guardados en
// variables de entorno (PTY_USUARIO / PTY_PASSWORD). Lee el formulario de
// login real de la página (sin adivinar nombres de campos a ciegas): toma
// el primer input visible como usuario y el input type=password como
// contraseña, conservando cualquier campo oculto (token CSRF, etc.).
async function iniciarSesionPTY() {
  const usuario = process.env.PTY_USUARIO;
  const contrasena = process.env.PTY_PASSWORD;
  if (!usuario || !contrasena) {
    throw new Error('Faltan PTY_USUARIO / PTY_PASSWORD en las variables de entorno.');
  }

  // 1) Pedimos la página principal; si no hay sesión, PTY normalmente
  //    responde directo con el formulario de login (o redirige a él).
  const resInicio = await fetch(`${PTY_BASE}/`, { redirect: 'follow' });
  const htmlInicio = await resInicio.text();
  const $ = cheerio.load(htmlInicio);

  // Guardamos la sesión (PHPSESSID) que PTY nos da desde esta primera
  // visita: el login normalmente se valida sobre ESA misma sesión, no
  // sobre una nueva. Si no la reenviamos en el POST de abajo, PTY puede
  // procesar el usuario/contraseña "sueltos" y nunca marcar la sesión
  // como autenticada, aunque no devuelva ningún error en el momento.
  const sesionInicial = extraerPhpSessId(resInicio.headers);

  const form = $('form').filter((i, el) => $(el).find('input[type="password"]').length > 0).first();
  if (form.length === 0) {
    throw new Error('No se encontró el formulario de login en la página de PTY Cargo (puede que ya haya cambiado de diseño).');
  }

  const accion = form.attr('action') || resInicio.url;
  const urlAccion = new URL(accion, resInicio.url).toString();
  const metodo = (form.attr('method') || 'POST').toUpperCase();

  const datos = new URLSearchParams();
  let campoUsuarioLlenado = false;
  form.find('input').each((i, el) => {
    const $el = $(el);
    const name = $el.attr('name');
    if (!name) return;
    const tipo = ($el.attr('type') || 'text').toLowerCase();
    if (tipo === 'password') {
      datos.set(name, contrasena);
    } else if (tipo === 'submit' || tipo === 'button') {
      // no enviar botones
    } else if (tipo === 'text' || tipo === 'email' || !campoUsuarioLlenado && tipo !== 'hidden' && tipo !== 'checkbox' && tipo !== 'radio') {
      datos.set(name, usuario);
      campoUsuarioLlenado = true;
    } else {
      datos.set(name, $el.attr('value') || '');
    }
  });

  if (!campoUsuarioLlenado) {
    throw new Error('No se encontró un campo de usuario/correo en el formulario de login de PTY Cargo.');
  }

  const headersLogin = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Referer': resInicio.url,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
  // Reenviamos la cookie de la sesión inicial para que el login se valide
  // sobre esa misma sesión (ver nota arriba).
  if (sesionInicial) {
    headersLogin['Cookie'] = `PHPSESSID=${sesionInicial}`;
  }

  const resLogin = await fetch(urlAccion, {
    method: metodo,
    headers: headersLogin,
    body: datos.toString(),
    redirect: 'manual',
  });

  // Si el login no devuelve una cookie nueva, es porque PTY conserva la
  // misma sesión inicial (ya autenticada) — usamos esa.
  const sesion = extraerPhpSessId(resLogin.headers) || sesionInicial;
  if (!sesion) {
    throw new Error('PTY Cargo no devolvió una sesión válida. Revisa que PTY_USUARIO/PTY_PASSWORD sean correctos.');
  }
  return sesion;
}

// --- GET /api/admin/pty/paquetes ---
// Trae la lista de paquetes desde PTY Cargo Express. Si no hay una sesión
// manual (PTY_PHPSESSID) configurada, inicia sesión sola con PTY_USUARIO /
// PTY_PASSWORD — el admin no tiene que copiar ningún PHPSESSID a mano.
router.get('/paquetes', async (req, res) => {
  let sesion = req.query.sesion || getSesion();
  let sesionAutomatica = false;
  if (!sesion) {
    try {
      sesion = await iniciarSesionPTY();
      sesionAutomatica = true;
    } catch (err) {
      console.error('Error iniciando sesión automática en PTY:', err);
      return res.status(503).json({ mensaje: 'No se pudo iniciar sesión automática en PTY Cargo: ' + err.message });
    }
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
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Cookie': `PHPSESSID=${sesion}`,
        'Origin': PTY_BASE,
        'Referer': `${PTY_BASE}/dashboard.php`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'es-ES,es;q=0.9',
        'X-Requested-With': 'XMLHttpRequest',
        'sec-ch-ua': '"Not=A?Brand";v="99", "Google Chrome";v="131", "Chromium";v="131"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
      body: body.toString(),
    });
    // OJO: nunca usar status 401/403 aquí. En este proyecto esos códigos
    // los intercepta apiAdmin() en el frontend y los trata como "tu sesión
    // de NEA expiró" (cierra sesión y tapa el mensaje real). Estos errores
    // son de la sesión de PTY Cargo, no de la del admin — van con 503/502.
    if (response.status === 401 || response.status === 403) {
      const detalle401 = sesionAutomatica
        ? 'PTY Cargo rechazó la sesión automática. Revisa que PTY_USUARIO/PTY_PASSWORD en Render sean correctos.'
        : 'Sesión PTY expirada o inválida. Actualiza PTY_PHPSESSID en Render.';
      return res.status(503).json({ mensaje: detalle401 });
    }
    if (!response.ok) {
      return res.status(502).json({ mensaje: `PTY Cargo respondió con error ${response.status}.` });
    }
    const data = await response.json();
    if (!data.success) {
      const detalle = sesionAutomatica
        ? 'La sesión automática no funcionó. Revisa PTY_USUARIO/PTY_PASSWORD en Render.'
        : 'Sesión PTY expirada. Actualiza PTY_PHPSESSID en Render.';
      return res.status(503).json({ mensaje: detalle });
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
      sesion_automatica: sesionAutomatica,
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
      // Tienda: PTY no la da, usar el consignatario o valor por defecto
      const tienda = 'PTY Cargo Express';
      const pesoLb = p.Peso ? parseFloat(parseFloat(p.Peso).toFixed(2)) : null;
      // Combinar WHR + Referencias + Comentario en descripcion
      const partes = [];
      if(p.WHR) partes.push('WHR: ' + p.WHR);
      if(p.Referencias && p.Referencias.trim()) partes.push(p.Referencias.trim());
      if(p.Comentario && p.Comentario.trim()) partes.push(p.Comentario.trim().substring(0, 200));
      const descripcion = partes.join(' | ').substring(0, 500) || null;

      // Fecha de prealerta: usar la de PTY o ahora
      const fechaPrealerta = p.Fecha ? new Date(p.Fecha) : new Date();

      await pool.query(
        `INSERT INTO paquetes
           (usuario_id, numero_tracking, tienda, estado, peso_lb,
            descripcion, fecha_prealerta, fecha_actualizacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [
          usuarioId,
          p.TrackingNum,
          tienda,
          estadoNea,
          pesoLb,
          descripcion,
          fechaPrealerta,
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

// --- POST /api/admin/pty/verificar ---
// Recibe una lista de trackings y devuelve cuáles ya existen en NEA
router.post('/verificar', async (req, res) => {
  const { trackings } = req.body;
  if (!Array.isArray(trackings) || trackings.length === 0) {
    return res.json({ en_nea: [] });
  }
  try {
    const resultado = await pool.query(
      `SELECT numero_tracking FROM paquetes WHERE numero_tracking = ANY($1)`,
      [trackings]
    );
    return res.json({ en_nea: resultado.rows.map(r => r.numero_tracking) });
  } catch (err) {
    console.error('Error verificando trackings en NEA:', err);
    return res.json({ en_nea: [] });
  }
});

module.exports = router;
