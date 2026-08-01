# Desplegar NEA Cargo Xpress gratis (para pruebas)

Combinación recomendada para probar sin pagar nada:

- **Neon** → base de datos PostgreSQL gratis (no expira, a diferencia del Postgres gratis de Render).
- **Render** → hosting del backend Node.js + el frontend (ya vienen juntos: Express sirve `public/index.html`).
- **Gmail (o Mailtrap)** → envío de los correos de confirmación.

No necesitas tarjeta de crédito para ninguno de los dos.

---

## 1. Sube el proyecto a GitHub

1. Crea un repositorio nuevo en [github.com](https://github.com) (puede ser privado).
2. Descomprime este proyecto y súbelo:

```bash
cd sistema-logistica
git init
git add .
git commit -m "Primer commit - NEA Cargo Xpress"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/nea-cargo-xpress.git
git push -u origin main
```

> Asegúrate de que exista un archivo `.gitignore` con `node_modules` y `.env` (te lo dejo abajo) para no subir tus credenciales.

## 2. Crea la base de datos en Neon

1. Entra a [neon.tech](https://neon.tech) y crea una cuenta gratis.
2. Crea un proyecto nuevo → te dará un **connection string** parecido a:
   ```
   postgresql://usuario:password@ep-xxxx-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
3. Copia ese connection string, lo vas a necesitar en el paso 4.
4. Crea las tablas: abre el **SQL Editor** de Neon (en su panel web) y pega el contenido de `sql/schema.sql` de este proyecto. Ejecuta.
5. Para tener acceso al panel administrativo, después de crear tu primer usuario (paso 6, más abajo) vuelve al SQL Editor de Neon y ejecuta:
   ```sql
   UPDATE usuarios SET rol = 'admin' WHERE email = 'tu_correo@ejemplo.com';
   ```

## 3. Crea el servicio en Render

1. Entra a [render.com](https://render.com) y crea una cuenta gratis (puedes usar tu GitHub para entrar).
2. **New → Web Service**.
3. Conecta tu repositorio de GitHub (`nea-cargo-xpress`).
4. Configura:
   - **Name**: `nea-cargo-xpress` (o el que quieras)
   - **Region**: la más cercana a tus usuarios (ej. Ohio si son de Latinoamérica/Panamá)
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**

## 4. Configura las variables de entorno en Render

En la sección **Environment** del servicio, agrega:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | el connection string de Neon del paso 2 |
| `JWT_SECRET` | una cadena larga y aleatoria (genera una en https://generate-secret.vercel.app/32) |
| `JWT_EXPIRES_IN` | `7d` |
| `BASE_URL` | déjalo vacío por ahora, lo completas en el paso 5 |
| `CASILLERO_PREFIJO` | `NEA` |
| `WAREHOUSE_NOMBRE` | `NEA Cargo Xpress` |
| `WAREHOUSE_DIRECCION1` | tu dirección real de bodega en Miami |
| `WAREHOUSE_CIUDAD` | `Miami` |
| `WAREHOUSE_ESTADO` | `FL` |
| `WAREHOUSE_ZIP` | tu código postal |
| `WAREHOUSE_TELEFONO` | tu teléfono |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | tu correo de Gmail |
| `SMTP_PASSWORD` | tu "contraseña de aplicación" de Gmail (ver nota abajo) |
| `SMTP_FROM` | `"NEA Cargo Xpress <tu_correo@gmail.com>"` |

> **Contraseña de aplicación de Gmail**: en tu cuenta de Google, ve a Seguridad → Verificación en 2 pasos (actívala si no la tienes) → Contraseñas de aplicaciones → genera una para "Correo". Usa esa, no tu contraseña normal.

Haz clic en **Deploy**. Render te dará una URL parecida a `https://nea-cargo-xpress.onrender.com`.

## 5. Completa BASE_URL

Vuelve a las variables de entorno y pon:

```
BASE_URL=https://nea-cargo-xpress.onrender.com
```

(con la URL real que te dio Render). Esto es lo que se usa para armar el enlace de verificación en el correo. Guarda — Render redesplegará automáticamente.

## 6. Prueba

1. Abre `https://nea-cargo-xpress.onrender.com` en el navegador → deberías ver la pantalla de NEA Cargo Xpress.
2. Crea un casillero de prueba.
3. Revisa tu correo y haz clic en el enlace de confirmación.
4. Inicia sesión → deberías ver tu casillero, la dirección, y poder prealertar un paquete.

---

## Limitaciones del plan gratis (para que no te tome por sorpresa)

- **Render free**: el servicio "se duerme" tras 15 minutos sin tráfico. La primera visita después de eso tarda ~30-60 segundos en despertar. Perfecto para pruebas, no para producción real con usuarios esperando respuesta instantánea.
- **Neon free**: base de datos gratis permanente, pero con límites de almacenamiento y de cómputo (más que suficiente para pruebas).
- Cuando quieras pasar a producción de verdad, lo normal es subir a Render/Neon de pago (o una alternativa como Railway/Fly.io), lo cual no requiere cambiar nada del código, solo el plan.

## .gitignore sugerido

```
node_modules/
.env
```
