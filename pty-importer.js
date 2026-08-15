// NEA Cargo Xpress — PTY Importer
// Este script corre dentro de carga.ptycargoexpress.com
window.NEAImporter = {
  init: function(baseUrl, token) {
    // Si ya hay un panel abierto, cerrarlo
    const existing = document.getElementById('nea-importer-panel');
    if (existing) { existing.remove(); return; }

    // Crear panel flotante
    const panel = document.createElement('div');
    panel.id = 'nea-importer-panel';
    panel.style.cssText = `
      position:fixed;top:20px;right:20px;width:420px;max-height:85vh;
      background:#0c1b33;color:#f1f3f2;border-radius:16px;
      box-shadow:0 24px 60px rgba(0,0,0,0.6);z-index:999999;
      font-family:Inter,sans-serif;font-size:13px;overflow:hidden;
      display:flex;flex-direction:column;border:1px solid rgba(255,255,255,0.1);
    `;
    panel.innerHTML = `
      <div style="padding:16px 18px;background:#ff6a1a;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
        <div style="font-weight:700;font-size:15px;">📦 NEA Cargo — Importador PTY</div>
        <button id="nea-close" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:2px 6px;">✕</button>
      </div>
      <div id="nea-body" style="padding:18px;overflow-y:auto;flex:1;">
        <div id="nea-status" style="text-align:center;padding:20px;color:rgba(255,255,255,0.6);">Leyendo paquetes de PTY Cargo…</div>
      </div>
      <div id="nea-footer" style="padding:14px 18px;border-top:1px solid rgba(255,255,255,0.1);display:none;flex-shrink:0;">
        <button id="nea-importar" style="width:100%;padding:12px;background:#ff6a1a;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">⬇ Importar seleccionados a NEA</button>
      </div>
    `;
    document.body.appendChild(panel);
    document.getElementById('nea-close').onclick = () => panel.remove();

    // Cargar paquetes desde la página actual de PTY
    NEAImporter.cargar(baseUrl, token, panel);
  },

  cargar: async function(baseUrl, token, panel) {
    const status = document.getElementById('nea-status');
    const body = document.getElementById('nea-body');
    const footer = document.getElementById('nea-footer');

    try {
      // Obtener todos los paquetes via ajax.php (misma sesión del navegador)
      const formData = new URLSearchParams({
        accion: 'tracking', pagina: '1', orderCol: 'Fecha',
        orderDir: 'DESC', porPagina: '100', filtro: ''
      });
      const res = await fetch('/ajax.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body: formData.toString(),
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (!data.success) { status.textContent = '❌ Error al leer PTY Cargo. ¿Estás en la sección Tracking?'; return; }

      const items = data.data?.items || [];
      if (items.length === 0) { status.textContent = '⚠ No hay paquetes en PTY Cargo.'; return; }

      // Verificar cuáles ya están en NEA
      let yaEnNea = new Set();
      try {
        const chk = await fetch(`${baseUrl}/api/admin/pty/verificar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ trackings: items.map(i => i.TrackingNum).filter(Boolean) })
        });
        const chkData = await chk.json();
        yaEnNea = new Set((chkData.en_nea || []).map(t => t.toLowerCase()));
      } catch(e) {}

      const nuevos = items.filter(p => !yaEnNea.has((p.TrackingNum||'').toLowerCase()));
      const enNea = items.filter(p => yaEnNea.has((p.TrackingNum||'').toLowerCase()));

      // Renderizar lista
      body.innerHTML = `
        <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
          <span style="color:rgba(255,255,255,0.6);font-size:12px;">${items.length} paquetes · <strong style="color:#ff6a1a;">${nuevos.length} nuevos</strong> · ${enNea.length} ya en NEA</span>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
            <input type="checkbox" id="nea-sel-all" style="accent-color:#ff6a1a;"> Todos los nuevos
          </label>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;" id="nea-lista">
          ${items.map(p => {
            const nuevo = !yaEnNea.has((p.TrackingNum||'').toLowerCase());
            const statusColor = { 'En Bodega':'#3b82f6','En Transito':'#f59e0b','En tránsito':'#f59e0b','En Panamá':'#10b981','En Panama':'#10b981','Entregado':'#6b7280' };
            const color = statusColor[p.Status] || '#ff6a1a';
            return `<div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:10px 12px;border:1px solid ${nuevo?'rgba(255,106,26,0.25)':'rgba(255,255,255,0.07)'};display:flex;align-items:center;gap:10px;${nuevo?'':'opacity:.5'}">
              <input type="checkbox" class="nea-pkg-check" data-idx="${items.indexOf(p)}" ${nuevo?'':'disabled'} ${nuevo?'checked':''} style="accent-color:#ff6a1a;width:15px;height:15px;flex-shrink:0;">
              <div style="flex:1;min-width:0;">
                <div style="font-family:monospace;font-size:11px;color:rgba(255,255,255,0.8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.TrackingNum||'—'}</div>
                <div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:2px;">${p.Referencias||'—'} · ${p.Peso||'?'} lb</div>
              </div>
              <div style="text-align:right;flex-shrink:0;">
                <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${color}22;color:${color};font-weight:600;">${p.Status||'—'}</span>
                ${nuevo ? '' : '<div style="font-size:10px;color:#10b981;margin-top:2px;">✓ En NEA</div>'}
              </div>
            </div>`;
          }).join('')}
        </div>
      `;

      // Guardar items para importar
      panel._items = items;
      if (nuevos.length > 0) footer.style.display = 'block';

      // Seleccionar todos
      document.getElementById('nea-sel-all').onchange = function() {
        document.querySelectorAll('.nea-pkg-check:not(:disabled)').forEach(cb => cb.checked = this.checked);
      };

      // Botón importar
      document.getElementById('nea-importar').onclick = () => NEAImporter.importar(baseUrl, token, panel);

    } catch(err) {
      status.textContent = '❌ Error: ' + err.message;
    }
  },

  importar: async function(baseUrl, token, panel) {
    const checks = [...document.querySelectorAll('.nea-pkg-check:checked')];
    if (checks.length === 0) { alert('Selecciona al menos un paquete.'); return; }
    const indices = checks.map(cb => parseInt(cb.dataset.idx));
    const paquetes = indices.map(i => panel._items[i]).filter(Boolean);
    const btn = document.getElementById('nea-importar');
    btn.textContent = `⏳ Importando ${paquetes.length} paquetes…`;
    btn.disabled = true;
    try {
      const res = await fetch(`${baseUrl}/api/admin/pty/importar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ paquetes })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        btn.textContent = `✓ ${data.mensaje}`;
        btn.style.background = '#177a63';
        setTimeout(() => { panel.remove(); }, 2500);
      } else {
        btn.textContent = data.mensaje || 'Error al importar.';
        btn.style.background = '#c0392b';
        btn.disabled = false;
      }
    } catch(err) {
      btn.textContent = 'Error de conexión.';
      btn.style.background = '#c0392b';
      btn.disabled = false;
    }
  }
};
