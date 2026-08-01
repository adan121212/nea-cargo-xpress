const express = require('express');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const casilleroRoutes = require('./routes/casillero');
const paquetesRoutes = require('./routes/paquetes');
const sucursalesRoutes = require('./routes/sucursales');
const facturasRoutes = require('./routes/facturas');
const publicoRoutes = require('./routes/publico');
const adminPaquetesRoutes = require('./routes/admin/paquetes');
const adminUsuariosRoutes = require('./routes/admin/usuarios');
const adminSucursalesRoutes = require('./routes/admin/sucursales');
const adminTarifasRoutes = require('./routes/admin/tarifas');
const adminFacturasRoutes = require('./routes/admin/facturas');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/casillero', casilleroRoutes);
app.use('/api/paquetes', paquetesRoutes);
app.use('/api/sucursales', sucursalesRoutes);
app.use('/api/facturas', facturasRoutes);
app.use('/api/public', publicoRoutes);
app.use('/api/admin/paquetes', adminPaquetesRoutes);
app.use('/api/admin/usuarios', adminUsuariosRoutes);
app.use('/api/admin/sucursales', adminSucursalesRoutes);
app.use('/api/admin/tarifas', adminTarifasRoutes);
app.use('/api/admin/facturas', adminFacturasRoutes);

// Sirve el frontend (public/index.html) desde el mismo servidor,
// así no hay problemas de CORS al llamar a /api/... desde el navegador.
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
