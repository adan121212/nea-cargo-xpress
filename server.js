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

const app = express();

app.set('trust proxy', 1);

app.use((req, res, next) => {
  if (req.headers.host === 'nea-cargo-xpress.onrender.com') {
    return res.redirect(301, `https://www.neacargoxpress.com${req.url}`);
  }
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
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
app.use('/api/admin/mostrador', adminMostradorRoutes);
app.use('/api/admin/caja', adminCajaRoutes);
app.use('/api/admin/recepcion', adminRecepcionRoutes);
app.use('/api/admin/pty', adminPtyRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  res.status(err.status || 500).json({ mensaje: 'Ocurrió un error interno. Intenta de nuevo.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
