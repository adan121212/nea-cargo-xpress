const { Pool } = require('pg');
require('dotenv').config();

// Si defines DATABASE_URL (por ejemplo, el connection string que te da Neon
// o Render), se usa directamente. Si no, se arma con las variables sueltas
// (útil para desarrollo local).
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // necesario para Neon/Render en la nube
    })
  : new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

module.exports = pool;
