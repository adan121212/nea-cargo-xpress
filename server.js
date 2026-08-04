const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const casilleroRoutes = require('./routes/casillero');
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

const app = express();

// Necesario en Render (y cualquier hosting detrás de proxy) para que
// Express identifique la IP real del visitante — sin esto, el rate
// limiting de abajo no funciona correctamente.
app.set('trust proxy', 1);

// Cabeceras de seguridad (clickjacking, sniffing MIME, etc.).
// Se desactivan solo las partes que rompen tu página actual:
// - contentSecurityPolicy: tu app.html usa <script> y <style> internos
//   (no en archivos separados), así que el CSP por defecto los bloquea.
// - crossOriginResourcePolicy / crossOriginEmbedderPolicy: bloqueaban
//   cargar las fotos de los paquetes desde Cloudinary (dominio externo).
// El resto de protecciones de Helmet (X-Frame-Options, HSTS, no-sniff, etc.)
// se mantienen activas.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// Deja de anunciar que usamos Express en cada respuesta.
app.disable('x-powered-by');

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// --- Rate limiting general ---
// Límite amplio para toda la API, evita abuso masivo/bots.
const limiteGeneral = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { mensaje: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
});
app.use('/api', limiteGeneral);

// --- Rate limiting estricto para login/registro/recuperación ---
// Evita fuerza bruta de contraseñas y spam de registros.
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { mensaje: 'Demasiados intentos. Espera unos minutos antes de volver a intentar.' },
});
app.use('/api/auth/login', limiteAuth);
app.use('/api/auth/registro', limiteAuth);
app.use('/api/auth/olvide-password', limiteAuth);
app.use('/api/auth/restablecer-password', limiteAuth);

// --- Rate limiting para rastreo público ---
// Evita que alguien "adivine" números de tracking por fuerza bruta.
const limiteRastreo = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { mensaje: 'Demasiadas búsquedas. Espera unos minutos.' },
});
app.use('/api/public/rastreo', limiteRastreo);

app.use('/api/auth', authRoutes);
app.use('/api/casillero', casilleroRoutes);
app.use('/api/paquetes', paquetesRoutes);
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
app.use('/api/admin/mostrador', adminMostradorRoutes);

// Sirve el frontend (public/index.html) desde el mismo servidor,
// así no hay problemas de CORS al llamar a /api/... desde el navegador.
app.use(express.static(path.join(__dirname, 'public')));

// --- Manejador de errores global ---
// Atrapa cualquier error no controlado (ej. JSON malformado) y responde
// con un mensaje limpio en vez de exponer detalles internos del servidor.
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  res.status(err.status || 500).json({ mensaje: 'Ocurrió un error interno. Intenta de nuevo.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
