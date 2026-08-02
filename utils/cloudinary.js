const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Sube una foto (buffer en memoria) a Cloudinary, dentro de una carpeta por paquete.
 * Devuelve la URL pública y el public_id (necesario para poder borrarla después).
 */
async function subirFotoPaquete(buffer, mimetype, paqueteId) {
  const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`;
  const resultado = await cloudinary.uploader.upload(dataUri, {
    folder: `nea-cargo/paquetes/${paqueteId}`,
    resource_type: 'image',
  });
  return { url: resultado.secure_url, public_id: resultado.public_id };
}

async function eliminarFotoCloudinary(publicId) {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId);
}

module.exports = { subirFotoPaquete, eliminarFotoCloudinary };
