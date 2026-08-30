const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const authRoutes = require('./routes/auth');
const casilleroRoutes = require('./routes/casillero');
const autorizadosRoutes = require('./routes/autorizados');
const perfilRoutes = require('./routes/perfil');
const paquetesRoutes = require('./routes/paquetes');
const sucursalesRoutes = require('./routes/sucursales');
const facturasRoutes = require('./routes/facturas');
const publicoRoutes = require('./routes/publico');
const pagosRoutes = require('./routes/pagos');
const adminPaquetesRoutes = require('./routes/admin/paquetes');
const adminUsuariosRoutes = require('./routes/admin/usuarios');
const adminSucursalesRoutes = require('./routes/admin/sucursales');
const adminTarifasRoutes = require('./routes/admin/tarifas');
const adminFacturasRoutes = require('./routes/admin/facturas');
const adminReportesRoutes = require('./routes/admin/reportes');
const adminMostradorRoutes = require('./routes/admin/mostrador');
const adminCajaRoutes = require('./routes/admin/caja');
const adminRecepcionRoutes = require('./routes/admin/recepcion');
const adminPtyRoutes = require('./routes/admin/ptycargoexpress');
const adminComprasRoutes = require('./routes/admin/compras');
const adminGastosRoutes = require('./routes/admin/gastos');
const cronRoutes = require('./routes/cron');
const app = express();
app.set('trust proxy', 1);

// Deshabilitar ETag para evitar respuestas 304 con cuerpo vacío en las APIs
app.set('etag', false);

app.use((req, res, next) => {
  if (req.headers.host === 'nea-cargo-xpress.onrender.com') {
    return res.redirect(301, `https://www.neacargoxpress.com${req.url}`);
  }
  next();
});
app.use(
  helmet({
    // CSP activo. No bloqueamos scripts/estilos inline ('unsafe-inline') porque
    // todo el JS de app.html/admin.html vive en un solo <script> por archivo
    // (separarlo a archivos externos con nonce sería la mejora completa, pero
    // es una refactorización grande). Lo que SÍ nos importa de verdad es
    // connect-src, img-src, base-uri y form-action: aunque algún día se cuele
    // un XSS, estas directivas evitan que ese script pueda mandar el token de
    // sesión (guardado en localStorage) a un servidor que no sea el nuestro.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'", "'unsafe-inline'",
          'https://cdnjs.cloudflare.com', 'https://unpkg.com', 'https://cdn.jsdelivr.net',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        // admin.html usa unos pocos onclick="..." en botones (cámara, copiar
        // casillero). Sin esto, Helmet los bloquea por defecto aunque scriptSrc
        // ya permita 'unsafe-inline' (script-src-attr manda sobre script-src
        // para atributos onX=).
        scriptSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// Evitar caché en TODAS las rutas de API — nunca devolver 304
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

// CORS para que el bookmarklet de PTY Cargo pueda llamar al servidor de NEA
app.use('/api/admin/pty/verificar', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://carga.ptycargoexpress.com');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use('/api/admin/pty/importar', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://carga.ptycargoexpress.com');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
// Servir el script del bookmarklet con cabeceras correctas
app.get('/pty-importer.js', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.sendFile(require('path').join(__dirname, 'public', 'pty-importer.js'));
});
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
const CAMPOS_SIN_ESPACIOS = ['casillero','numero_casillero','tracking','numero_tracking','ruc','cedula','codigo','correo','email'];
const CAMPOS_INTOCABLES = ['password','contrasena','contraseña','clave','token','firma_base64','foto_base64','imagen'];

function limpiarCampos(valor, clave){
  const k = String(clave || '').toLowerCase();
  if (CAMPOS_INTOCABLES.includes(k)) return valor;
  if (typeof valor === 'string'){
    return CAMPOS_SIN_ESPACIOS.includes(k)
      ? valor.replace(/\s+/g, '')
      : valor.trim().replace(/\s{2,}/g, ' ');
  }
  if (Array.isArray(valor)) return valor.map(v => limpiarCampos(v, clave));
  if (valor && typeof valor === 'object'){
    Object.keys(valor).forEach(k2 => { valor[k2] = limpiarCampos(valor[k2], k2); });
    return valor;
  }
  return valor;
}

app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') req.body = limpiarCampos(req.body, '');
  next();
});
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
const limiteGeneral = rateLimit({
  windowMs: 15 * 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { mensaje: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
});
app.use('/api', limiteGeneral);
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { mensaje: 'Demasiados intentos. Espera unos minutos antes de volver a intentar.' },
});
app.use('/api/auth/login', limiteAuth);
app.use('/api/auth/registro', limiteAuth);
app.use('/api/auth/olvide-password', limiteAuth);
app.use('/api/auth/restablecer-password', limiteAuth);
const limiteRastreo = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { mensaje: 'Demasiadas búsquedas. Espera unos minutos.' },
});
app.use('/api/public/rastreo', limiteRastreo);
app.use('/api/auth', authRoutes);
app.use('/api/casillero', casilleroRoutes);
app.use('/api/paquetes', paquetesRoutes);
app.use('/api/autorizados', autorizadosRoutes);
app.use('/api/perfil', perfilRoutes);
app.use('/api/sucursales', sucursalesRoutes);
app.use('/api/facturas', facturasRoutes);
app.use('/api/public', publicoRoutes);
app.use('/api/pagos', pagosRoutes);
app.use('/api/admin/paquetes', adminPaquetesRoutes);
app.use('/api/admin/usuarios', adminUsuariosRoutes);
app.use('/api/admin/sucursales', adminSucursalesRoutes);
app.use('/api/admin/tarifas', adminTarifasRoutes);
app.use('/api/admin/facturas', adminFacturasRoutes);
app.use('/api/admin/reportes', adminReportesRoutes);
app.use('/api/admin/reportes-paquete', require('./routes/admin/reportesPaquete'));
app.use('/api/admin/mostrador', adminMostradorRoutes);
app.use('/api/admin/caja', adminCajaRoutes);
app.use('/api/admin/recepcion', adminRecepcionRoutes);
app.use('/api/admin/pty', adminPtyRoutes);
app.use('/api/admin/compras', adminComprasRoutes);
app.use('/api/admin/gastos', adminGastosRoutes);
app.use('/api/cron', cronRoutes);
// Redirección de la URL bonita del flyer al registro real
app.get('/casillero', (req, res) => {
  res.redirect('/app.html?registro');
});
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  res.status(err.status || 500).json({ mensaje: 'Ocurrió un error interno. Intenta de nuevo.' });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
