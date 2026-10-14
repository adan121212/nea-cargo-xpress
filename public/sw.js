// Service worker mínimo de NEA Cargo Xpress.
// Solo existe para que el celular permita "Instalar aplicación".
// NO guarda nada en caché: todo se pide siempre al servidor, así la app
// nunca muestra datos viejos y cada cambio que subimos se ve de inmediato.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
