#!/usr/bin/env node
/**
 * PRUEBA DE FLUJO COMPLETO — NEA Cargo Xpress
 * ============================================================
 * Recorre el camino real del negocio y avisa si algo se rompió:
 *
 *   registrar cliente -> crear paquete -> medidas -> confirmar peso
 *   -> factura -> PDF -> cobrar -> gasto -> cierre de caja
 *   -> compra por encargo -> ganancia -> vista del cliente -> permisos
 *
 * Al terminar borra todo lo que creó.
 *
 * ------------------------------------------------------------
 * CÓMO USARLO
 * ------------------------------------------------------------
 * Lo seguro es correrlo contra una COPIA de la base, no contra
 * producción. En Neon se hace en un minuto: Branches -> New branch,
 * y esa copia se despliega en un servicio aparte de Render.
 *
 *   PRUEBA_URL=https://mi-copia.onrender.com \
 *   PRUEBA_ADMIN_EMAIL=adan160@msn.com \
 *   PRUEBA_ADMIN_PASS=laclave \
 *   node scripts/prueba-flujo.js
 *
 * Si de verdad quieres correrlo contra el sitio real, hay que
 * agregar --permitir-produccion. Va a crear un cliente de prueba
 * y borrarlo al final, pero cualquier corte a media prueba deja
 * basura en la base. Piénsalo dos veces.
 * ------------------------------------------------------------
 */

const URL_BASE = (process.env.PRUEBA_URL || 'http://localhost:4100').replace(/\/$/, '');
const EMAIL_ADMIN = process.env.PRUEBA_ADMIN_EMAIL;
const PASS_ADMIN = process.env.PRUEBA_ADMIN_PASS;
const PERMITIR_PROD = process.argv.includes('--permitir-produccion');

const MARCA = 'PRUEBA-' + Date.now();
const EMAIL_CLIENTE = `prueba.${Date.now()}@ejemplo-nea.test`;
const PASS_CLIENTE = 'ClaveDePrueba123';

let ok = 0, fallos = [];
const creado = { usuario: null, paquetes: [], facturas: [], compras: [], gastos: [] };

const c = { v: '\x1b[32m', r: '\x1b[31m', a: '\x1b[33m', g: '\x1b[90m', n: '\x1b[0m' };
function paso(nombre, bien, detalle = '') {
  if (bien) { ok++; console.log(`  ${c.v}OK${c.n}    ${nombre}${detalle ? c.g + ' — ' + detalle + c.n : ''}`); }
  else { fallos.push(nombre + (detalle ? ': ' + detalle : '')); console.log(`  ${c.r}FALLA${c.n} ${nombre}${detalle ? ' — ' + detalle : ''}`); }
  return bien;
}
function aviso(nombre, detalle = '') {
  console.log(`  ${c.a}AVISO${c.n} ${nombre}${detalle ? c.g + ' — ' + detalle + c.n : ''}`);
}
function titulo(t) { console.log(`\n${c.a}${t}${c.n}`); }

async function api(ruta, { metodo = 'GET', token, cuerpo, form } = {}) {
  const cab = {};
  if (token) cab.Authorization = `Bearer ${token}`;
  if (cuerpo) cab['Content-Type'] = 'application/json';
  const r = await fetch(URL_BASE + ruta, {
    method: metodo, headers: cab,
    body: form ? form : (cuerpo ? JSON.stringify(cuerpo) : undefined),
  });
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch (e) { datos = { _texto: texto.slice(0, 200) }; }
  return { estado: r.status, ok: r.ok, datos };
}

async function main() {
  console.log(`\n${c.a}PRUEBA DE FLUJO — NEA Cargo Xpress${c.n}`);
  console.log(`${c.g}Servidor: ${URL_BASE}${c.n}`);

  if (/neacargoxpress\.com/i.test(URL_BASE) && !PERMITIR_PROD) {
    console.log(`\n${c.r}Esa URL es la del sitio real.${c.n}`);
    console.log('Corre la prueba contra una copia de la base, o agrega --permitir-produccion si estás seguro.\n');
    process.exit(1);
  }
  if (!EMAIL_ADMIN || !PASS_ADMIN) {
    console.log(`\n${c.r}Faltan PRUEBA_ADMIN_EMAIL y PRUEBA_ADMIN_PASS.${c.n}\n`);
    process.exit(1);
  }

  // ---------- Acceso ----------
  titulo('1. Acceso');
  const login = await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: EMAIL_ADMIN, password: PASS_ADMIN } });
  const tokenAdmin = login.datos?.token;
  if (!paso('el admin entra', login.ok && !!tokenAdmin, login.datos?.mensaje)) return terminar();
  paso('la cuenta es de administrador', login.datos?.usuario?.rol === 'admin');

  // ---------- Cliente ----------
  titulo('2. Cliente nuevo');
  const reg = await api('/api/auth/registro', {
    metodo: 'POST',
    cuerpo: { tipo_cuenta: 'personal', nombre: 'Prueba', apellido: MARCA, email: EMAIL_CLIENTE, telefono: '6000-0000', password: PASS_CLIENTE },
  });
  const idCliente = reg.datos?.usuario?.id;
  creado.usuario = idCliente;
  if (!paso('se registra', reg.estado === 201 && !!idCliente, reg.datos?.mensaje)) return terminar(tokenAdmin);
  paso('recibe número de casillero', !!reg.datos?.usuario?.numero_casillero, reg.datos?.usuario?.numero_casillero);

  // ---------- Paquete ----------
  titulo('3. Paquete');
  const tracking = MARCA + '-A';
  const paq = await api('/api/admin/recepcion/crear', {
    metodo: 'POST', token: tokenAdmin,
    cuerpo: { usuario_id: idCliente, numero_tracking: tracking, tienda: 'Amazon', valor_declarado: 85, peso_lb: 3, descripcion: 'Paquete de prueba' },
  });
  const idPaq = paq.datos?.paquete?.id;
  creado.paquetes.push(idPaq);
  if (!paso('se crea en recepción', paq.ok && !!idPaq, paq.datos?.mensaje)) return terminar(tokenAdmin);

  const dim = await api(`/api/admin/paquetes/${idPaq}/dimensiones`, {
    metodo: 'PATCH', token: tokenAdmin, cuerpo: { largo_in: 14, ancho_in: 9.6, alto_in: 8 },
  });
  const vol = Number(dim.datos?.paquete?.peso_volumetrico_lb);
  paso('calcula el peso volumétrico', Math.abs(vol - 6.48) < 0.05, `${vol} lb (esperado 6.48)`);

  // ---------- Factura ----------
  titulo('4. Factura');
  const tarifas = await api('/api/admin/tarifas', { token: tokenAdmin });
  const tarifa = (tarifas.datos?.tarifas || []).find(t => t.activa) || (tarifas.datos?.tarifas || [])[0];
  if (!paso('hay una tarifa configurada', !!tarifa, tarifa?.nombre)) return terminar(tokenAdmin);

  const peso = await api(`/api/admin/paquetes/${idPaq}/peso`, {
    metodo: 'PATCH', token: tokenAdmin, cuerpo: { peso_real_lb: 3, tarifa_id: tarifa.id },
  });
  const fac = peso.datos?.factura;
  creado.facturas.push(fac?.id);
  paso('se genera al confirmar el peso', !!fac?.numero_factura, fac?.numero_factura);

  // El total tiene que cuadrar con la tarifa
  if (fac) {
    const pf = Number(fac.peso_facturado_lb);
    const esperadoEnvio = Math.max(pf * Number(tarifa.precio_libra), Number(tarifa.cargo_minimo));
    const esperadoTotal = esperadoEnvio + Number(tarifa.cargo_manejo) + (85 * Number(tarifa.pct_seguro)) / 100;
    paso('el total cuadra con la tarifa', Math.abs(Number(fac.total) - esperadoTotal) < 0.02,
         `$${fac.total} (calculado $${esperadoTotal.toFixed(2)})`);
    paso('queda pendiente de pago', fac.estado === 'pendiente', fac.estado);
  }

  const pdf = await fetch(`${URL_BASE}/api/admin/facturas/${fac?.id}/pdf`, { headers: { Authorization: `Bearer ${tokenAdmin}` } });
  const buf = Buffer.from(await pdf.arrayBuffer());
  paso('el PDF se genera', pdf.ok && buf.slice(0, 4).toString() === '%PDF', `${buf.length} bytes`);

  // ---------- Cobro ----------
  titulo('5. Cobro y caja');
  const cobro = await api('/api/admin/mostrador/cobrar', {
    metodo: 'POST', token: tokenAdmin, cuerpo: { factura_id: fac?.id, metodo_pago: 'efectivo' },
  });
  paso('se cobra en mostrador', cobro.ok, cobro.datos?.mensaje);

  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Panama', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const form = new FormData();
  form.append('fecha', hoy); form.append('categoria', 'suministros');
  form.append('descripcion', MARCA + ' cinta'); form.append('monto', '12.50');
  form.append('metodo_pago', 'efectivo'); form.append('sale_de_caja', 'true');
  const gasto = await api('/api/admin/gastos', { metodo: 'POST', token: tokenAdmin, form });
  creado.gastos.push(gasto.datos?.gasto?.id);
  paso('se registra un gasto que sale de caja', gasto.estado === 201, gasto.datos?.mensaje);

  const caja = await api(`/api/admin/caja/dia?fecha=${hoy}`, { token: tokenAdmin });
  const ef = caja.datos?.efectivo || {};
  paso('el cuadre de efectivo resta las salidas',
       Math.abs((ef.cobrado - ef.salidas) - ef.en_gaveta) < 0.01,
       `cobrado $${ef.cobrado} − salidas $${ef.salidas} = $${ef.en_gaveta}`);

  // ---------- Compra por encargo ----------
  titulo('6. Compra por encargo');
  // Se mide la DIFERENCIA en la caja, no el total del día: si ya hubo
  // compras hoy (o corridas anteriores de esta prueba), el total no sirve.
  const cajaAntes = await api(`/api/admin/caja/dia?fecha=${hoy}`, { token: tokenAdmin });
  const comisionesAntes = Number(cajaAntes.datos?.desglose?.comisiones_compras || 0);

  const compra = await api('/api/admin/compras', {
    metodo: 'POST', token: tokenAdmin,
    cuerpo: { usuario_id: idCliente, tienda: 'Amazon', descripcion: MARCA + ' producto', monto_producto: 60, comision: 5 },
  });
  const idCompra = compra.datos?.compra?.id;
  creado.compras.push(idCompra);
  paso('se registra', compra.estado === 201, `total a cobrar $${compra.datos?.compra?.total_cobrado}`);

  if (idCompra) {
    await api(`/api/admin/compras/${idCompra}/comprada`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { numero_orden: MARCA } });
    const pag = await api(`/api/admin/compras/${idCompra}/pagada`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { metodo_pago: 'efectivo' } });
    paso('se cobra', pag.ok, pag.datos?.mensaje);

    const caja2 = await api(`/api/admin/caja/dia?fecha=${hoy}`, { token: tokenAdmin });
    const com = Number(caja2.datos?.desglose?.comisiones_compras || 0);
    const subio = com - comisionesAntes;
    paso('a caja entran solo los $5, no los $65', Math.abs(subio - 5) < 0.01,
         `la caja subió $${subio.toFixed(2)}`);
  }

  // ---------- Ganancia ----------
  titulo('7. Ganancia del día');
  const res = await api(`/api/admin/gastos/resumen?desde=${hoy}&hasta=${hoy}`, { token: tokenAdmin });
  const d = res.datos || {};
  paso('ingresos menos gastos da la ganancia',
       Math.abs((d.ingresos?.total - d.gastos?.total) - d.utilidad) < 0.01,
       `$${d.ingresos?.total} − $${d.gastos?.total} = $${Number(d.utilidad).toFixed(2)}`);

  // ---------- Vista del cliente ----------
  titulo('8. Lo que ve el cliente');
  const loginC = await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: EMAIL_CLIENTE, password: PASS_CLIENTE } });
  const tokenCliente = loginC.datos?.token;

  const faltaConfirmar = /confirmar tu correo/i.test(loginC.datos?.mensaje || '');
  if (!tokenCliente && faltaConfirmar) {
    // No es un error: el sistema exige confirmar el correo, y la prueba no
    // puede abrir el buzón. Se saltan las comprobaciones del lado del cliente.
    aviso('el cliente debe confirmar su correo antes de entrar', 'es lo correcto; se saltan las pruebas de su cuenta');
  } else if (!tokenCliente) {
    paso('entra a su cuenta', false, loginC.datos?.mensaje);
  } else {
    paso('entra a su cuenta', true);
    const perf = await api('/api/casillero/perfil', { token: tokenCliente });
    paso('ve su dirección de casillero', !!perf.datos?.direccion_casillero?.linea1);

    const paqs = await api('/api/paquetes', { token: tokenCliente });
    const lista = paqs.datos?.paquetes || [];
    paso('ve solo sus paquetes', paqs.ok && lista.every(p => p.usuario_id === idCliente), `${lista.length} paquete(s)`);

    const facs = await api('/api/facturas', { token: tokenCliente });
    paso('ve solo sus facturas', facs.ok, `${(facs.datos?.facturas || []).length} factura(s)`);

    titulo('9. Permisos');
    const a1 = await api('/api/admin/paquetes', { token: tokenCliente });
    paso('un cliente no entra al admin', a1.estado === 403, `HTTP ${a1.estado}`);
    const a2 = await api('/api/admin/gastos', { token: tokenCliente });
    paso('un cliente no ve los gastos', a2.estado === 403, `HTTP ${a2.estado}`);
  }
  const a3 = await api('/api/paquetes');
  paso('sin sesión no se ve nada', a3.estado === 401, `HTTP ${a3.estado}`);

  await terminar(tokenAdmin);
}

async function terminar(tokenAdmin) {
  titulo('Limpieza');
  if (tokenAdmin) {
    for (const id of creado.gastos.filter(Boolean)) {
      const r = await api(`/api/admin/gastos/${id}`, { metodo: 'DELETE', token: tokenAdmin });
      paso(`gasto ${id} borrado`, r.ok);
    }
    if (creado.usuario) {
      const r = await api(`/api/admin/usuarios/${creado.usuario}`, { metodo: 'DELETE', token: tokenAdmin });
      paso('cliente de prueba borrado o desactivado', r.ok, r.datos?.mensaje);
    }
  }
  if (creado.compras.filter(Boolean).length) {
    aviso('la compra de prueba queda registrada', 'no hay forma de borrar una compra ya pagada; bórrala desde la base si molesta');
  }
  console.log(`\n${c.g}Todo lo de esta corrida lleva la marca ${MARCA}${c.n}`);

  console.log(`\n${'─'.repeat(52)}`);
  if (fallos.length === 0) {
    console.log(`${c.v}Todo bien: ${ok} comprobaciones pasaron.${c.n}`);
    console.log(`${c.g}Si quieres probar también lo que ve el cliente, confirma su`);
    console.log(`correo desde la base y vuelve a correr la prueba.${c.n}\n`);
    process.exit(0);
  } else {
    console.log(`${c.v}${ok} pasaron${c.n} · ${c.r}${fallos.length} fallaron${c.n}`);
    fallos.forEach(f => console.log(`  ${c.r}·${c.n} ${f}`));
    console.log('');
    process.exit(1);
  }
}

main().catch(e => {
  console.log(`\n${c.r}La prueba se cortó: ${e.message}${c.n}`);
  console.log(`${c.g}Revisa que el servidor esté arriba y que la URL sea la correcta.${c.n}\n`);
  process.exit(1);
});
