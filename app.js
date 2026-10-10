'use strict';

(() => {
  const DB_KEY = 'hmt_medicines_v1';
  const SETTINGS_KEY = 'hmt_settings_v1';
  const ALERTS_KEY = 'hmt_sent_reminders_v1';
  const DRIVE_FILE_NAME = 'home-medicine-tracker.json';
  const DEFAULT_OFFSETS = [-2, -1, 0, 1];
  const $ = id => document.getElementById(id);
  let medicines = readJson(localStorage.getItem(DB_KEY), []);
  let settings = readJson(localStorage.getItem(SETTINGS_KEY), { clientId: '' });
  let sentAlerts = new Set(readJson(localStorage.getItem(ALERTS_KEY), []));
  let currentFilter = 'all';
  let pendingImage = null;
  let driveToken = null;
  let driveTokenExpiry = 0;
  let driveFileId = null;
  let driveEmail = '';
  let driveBusy = false;
  let toastTimeout = null;
  let swRegistration = null;

  function readJson(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
  }
  function persistLocal() {
    localStorage.setItem(DB_KEY, JSON.stringify(medicines));
    localStorage.setItem(ALERTS_KEY, JSON.stringify([...sentAlerts]));
  }
  function persistSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`); }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function shiftISO(dateISO, days) {
    const d = new Date(`${dateISO}T12:00:00`);
    d.setDate(d.getDate() + Number(days));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function daysUntil(dateISO) {
    if (!dateISO) return null;
    const a = new Date(`${todayISO()}T00:00:00`);
    const b = new Date(`${dateISO}T00:00:00`);
    return Math.round((b - a) / 86400000);
  }
  function formatDate(dateISO) {
    if (!dateISO) return 'Not set';
    const d = new Date(`${dateISO}T12:00:00`);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function cleanIngredients(text) {
    return String(text || '').split('\n').map(s => s.trim().replace(/^[•●▪*-]\s*/, '')).filter(Boolean);
  }
  function htmlEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function activeMedicines() { return medicines.filter(m => !m.deletedAt); }
  function showToast(message) {
    const node = $('toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => node.classList.remove('show'), 3200);
  }
  function statusFor(m) {
    const days = daysUntil(m.expiryDate);
    if (days < 0) return { key: 'expired', label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`, days };
    if (days === 0) return { key: 'soon', label: 'Expires today', days };
    if (days <= 30) return { key: 'soon', label: `Expires in ${days} day${days === 1 ? '' : 's'}`, days };
    return { key: 'ok', label: `Expires ${formatDate(m.expiryDate)}`, days };
  }
  function render() {
    const list = activeMedicines();
    $('statTotal').textContent = list.length;
    $('statSoon').textContent = list.filter(m => { const d = daysUntil(m.expiryDate); return d >= 0 && d <= 30; }).length;
    $('statExpired').textContent = list.filter(m => daysUntil(m.expiryDate) < 0).length;
    const q = $('searchInput').value.trim().toLowerCase();
    const filtered = list.filter(m => {
      const s = statusFor(m);
      if (currentFilter === 'soon' && !(s.days >= 0 && s.days <= 30)) return false;
      if (currentFilter === 'expired' && s.days >= 0) return false;
      const corpus = [m.name, m.ingredients, m.notes].join(' ').toLowerCase();
      return !q || corpus.includes(q);
    }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.name.localeCompare(b.name));
    $('medicineList').innerHTML = filtered.map(m => {
      const s = statusFor(m);
      const ingredients = cleanIngredients(m.ingredients).map(x => `<li>${htmlEscape(x)}</li>`).join('');
      const reminderPhrase = (m.reminders || DEFAULT_OFFSETS).slice().sort((a,b)=>a-b).map(n => n === 0 ? 'on expiry day' : `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n < 0 ? 'before' : 'after'}`).join(' · ');
      const image = m.imageData ? `<img src="${htmlEscape(m.imageData)}" alt="${htmlEscape(m.name)}">` : '<span aria-hidden="true">✚</span>';
      return `<article class="med-card">
        <div class="med-thumb">${image}</div>
        <div class="med-main">
          <div class="med-title-row"><h2 class="med-title">${htmlEscape(m.name)}</h2><span class="status-pill ${s.key === 'ok' ? '' : s.key}">${htmlEscape(s.label)}</span></div>
          <p class="med-meta"><strong>Qty:</strong> ${htmlEscape(m.qty)} &nbsp;·&nbsp; <strong>Opened:</strong> ${m.openedDate ? htmlEscape(formatDate(m.openedDate)) : 'Not recorded'}</p>
          <p class="med-meta"><strong>Expiry:</strong> ${htmlEscape(formatDate(m.expiryDate))}</p>
          <ul class="ingredient-list">${ingredients}</ul>
          ${m.notes ? `<p class="notes">${htmlEscape(m.notes)}</p>` : ''}
          <p class="reminder-line">🔔 ${htmlEscape(reminderPhrase || 'No reminders set')}</p>
        </div>
        <div class="med-actions"><button class="mini-btn" data-edit="${htmlEscape(m.id)}" aria-label="Edit ${htmlEscape(m.name)}" title="Edit">✎</button><button class="mini-btn" data-delete="${htmlEscape(m.id)}" aria-label="Delete ${htmlEscape(m.name)}" title="Delete">⌫</button></div>
      </article>`;
    }).join('');
    $('emptyState').classList.toggle('hidden', list.length > 0);
    $('medicineList').classList.toggle('hidden', list.length === 0 || filtered.length === 0);
    if (list.length && filtered.length === 0) {
      $('medicineList').innerHTML = '<div class="empty-state"><h2>No matching medicines</h2><p>Try another search or filter.</p></div>';
      $('medicineList').classList.remove('hidden');
    }
  }
  function setDriveStatus(title, message, connected = false) {
    $('driveStatusTitle').textContent = title; $('driveStatusText').textContent = message;
    $('driveDot').classList.toggle('online', connected);
    $('connectDriveBtn').textContent = connected ? 'Sync now' : 'Connect Drive';
    $('connectFromSettingsBtn').textContent = connected ? 'Reconnect' : 'Connect Drive';
  }
  function showDialog(id) { const d = $(id); if (!d.open) d.showModal(); }
  function closeDialog(id) { const d = $(id); if (d.open) d.close(); }
  function setFormError(msg) { $('formError').textContent = msg; $('formError').classList.toggle('hidden', !msg); }
  function renderOffsets(offsets) {
    const unique = [...new Set((offsets || []).map(Number).filter(Number.isInteger))].sort((a,b)=>a-b);
    $('reminderOffsets').innerHTML = unique.map(n => {
      const phrase = n === 0 ? 'On expiry date' : `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n < 0 ? 'before' : 'after'} expiry`;
      return `<div class="offset-item"><span>${htmlEscape(phrase)}</span><strong>${n > 0 ? '+' : ''}${n} day${Math.abs(n) === 1 ? '' : 's'}</strong><button type="button" data-remove-offset="${n}" aria-label="Remove ${htmlEscape(phrase)}">×</button></div>`;
    }).join('') || '<p class="field-help">No reminders added yet. Add at least one reminder.</p>';
  }
  function readOffsets() {
    return [...$('reminderOffsets').querySelectorAll('[data-remove-offset]')].map(el => Number(el.dataset.removeOffset)).sort((a,b)=>a-b);
  }
  function openNewMedicine() {
    $('medicineForm').reset(); $('medicineId').value = ''; pendingImage = null;
    $('formTitle').textContent = 'Add medicine'; $('formEyebrow').textContent = 'INVENTORY ENTRY'; $('saveMedicineBtn').textContent = 'Save medicine';
    $('imagePreviewWrap').classList.add('hidden'); $('imagePreview').src = ''; setFormError(''); renderOffsets(DEFAULT_OFFSETS); showDialog('medicineDialog');
  }
  function openEditMedicine(id) {
    const m = medicines.find(x => x.id === id && !x.deletedAt); if (!m) return;
    $('medicineForm').reset(); pendingImage = m.imageData || null;
    $('medicineId').value = m.id; $('nameInput').value = m.name; $('ingredientsInput').value = cleanIngredients(m.ingredients).join('\n');
    $('qtyInput').value = m.qty; $('openedInput').value = m.openedDate || ''; $('expiryInput').value = m.expiryDate; $('notesInput').value = m.notes || '';
    $('formTitle').textContent = 'Edit medicine'; $('formEyebrow').textContent = 'UPDATE INVENTORY'; $('saveMedicineBtn').textContent = 'Save changes'; setFormError('');
    if (pendingImage) { $('imagePreview').src = pendingImage; $('imagePreviewWrap').classList.remove('hidden'); } else $('imagePreviewWrap').classList.add('hidden');
    renderOffsets(m.reminders || DEFAULT_OFFSETS); showDialog('medicineDialog');
  }
  function saveMedicine(event) {
    event.preventDefault(); setFormError('');
    const name = $('nameInput').value.trim(); const ingredients = cleanIngredients($('ingredientsInput').value);
    const qty = Number($('qtyInput').value); const openedDate = $('openedInput').value || ''; const expiryDate = $('expiryInput').value;
    const reminders = readOffsets();
    if (!name) return setFormError('Enter a medicine name.');
    if (!ingredients.length) return setFormError('Enter at least one ingredient.');
    if ($('qtyInput').value.trim() === '' || !Number.isFinite(qty) || qty < 0) return setFormError('Enter a valid quantity of zero or more.');
    if (!expiryDate) return setFormError('Choose the expiry date.');
    if (openedDate && openedDate > todayISO()) return setFormError('Opened date cannot be in the future.');
    if (openedDate && openedDate > expiryDate) return setFormError('Opened date cannot be after the expiry date.');
    if (!reminders.length) return setFormError('Add at least one expiry reminder.');
    const old = medicines.find(m => m.id === $('medicineId').value);
    const now = new Date().toISOString();
    const record = {
      id: old?.id || uuid(), name, ingredients: ingredients.join('\n'), qty, openedDate, expiryDate,
      imageData: pendingImage || null, notes: $('notesInput').value.trim(), reminders,
      createdAt: old?.createdAt || now, updatedAt: now, deletedAt: null
    };
    const idx = medicines.findIndex(m => m.id === record.id);
    if (idx >= 0) medicines[idx] = record; else medicines.push(record);
    persistLocal(); render(); closeDialog('medicineDialog'); checkReminders();
    showToast(old ? 'Medicine updated.' : 'Medicine added.'); autoSyncIfConnected();
  }
  function deleteMedicine(id) {
    const m = medicines.find(x => x.id === id && !x.deletedAt); if (!m) return;
    if (!confirm(`Delete “${m.name}” from this inventory? This change will sync to Google Drive.`)) return;
    const now = new Date().toISOString(); m.deletedAt = now; m.updatedAt = now;
    persistLocal(); render(); showToast('Medicine deleted.'); autoSyncIfConnected();
  }
  async function compressImage(file) {
    if (!file || !file.type.startsWith('image/')) return null;
    if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
    const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the image.')); r.readAsDataURL(file); });
    const img = await new Promise((resolve, reject) => { const x = new Image(); x.onload = () => resolve(x); x.onerror = () => reject(new Error('This image could not be opened.')); x.src = dataUrl; });
    const max = 850; const ratio = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width * ratio)); canvas.height = Math.max(1, Math.round(img.height * ratio));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    let quality = 0.68; let result = canvas.toDataURL('image/jpeg', quality);
    while (result.length > 180000 && quality > 0.4) { quality -= 0.08; result = canvas.toDataURL('image/jpeg', quality); }
    return result;
  }
  async function enableNotifications() {
    if (!('Notification' in window)) { showToast('This browser does not support notifications.'); return; }
    try {
      const permission = await Notification.requestPermission();
      $('notificationFeedback').textContent = `Notification permission: ${permission}.`;
      $('reminderSettingsText').textContent = `Notification permission: ${permission}.`;
      if (permission === 'granted') { await checkReminders(); showToast('Notifications enabled on this device.'); }
      else showToast('Notifications are not enabled. Change the site permission in Chrome settings.');
    } catch (e) { showToast('Could not request notification permission.'); }
  }
  async function notify(title, body, tag) {
    try {
      if (swRegistration && swRegistration.showNotification) await swRegistration.showNotification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: './index.html' } });
      else new Notification(title, { body, tag });
    } catch (_) { /* Browser/OS can block notifications without throwing. */ }
  }
  async function checkReminders() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const today = todayISO(); let fired = 0;
    for (const m of activeMedicines()) {
      const offsets = Array.isArray(m.reminders) ? m.reminders : DEFAULT_OFFSETS;
      for (const offset of offsets) {
        const dueDay = shiftISO(m.expiryDate, offset);
        if (dueDay > today) continue;
        const key = `${m.id}|${offset}|${dueDay}`;
        if (sentAlerts.has(key)) continue;
        const dueDateText = dueDay < today
          ? `has a missed reminder scheduled for ${formatDate(dueDay)}. Its expiry date is ${formatDate(m.expiryDate)}.`
          : (offset === 0 ? `reaches its expiry date today (${formatDate(m.expiryDate)}).` : offset < 0 ? `expires in ${Math.abs(offset)} day${Math.abs(offset) === 1 ? '' : 's'} (${formatDate(m.expiryDate)}).` : `passed its expiry date ${offset} day${offset === 1 ? '' : 's'} ago (${formatDate(m.expiryDate)}).`);
        await notify(`Medicine expiry: ${m.name}`, `${m.name} ${dueDateText} Quantity: ${m.qty}.`, key);
        sentAlerts.add(key); fired++;
      }
    }
    if (fired) { localStorage.setItem(ALERTS_KEY, JSON.stringify([...sentAlerts])); }
  }

  // Google Drive sync. The app creates one visible JSON backup file in the signed-in user's Drive.
  function hasDriveToken() { return Boolean(driveToken && Date.now() < driveTokenExpiry - 30000); }
  function driveAuthHeader() {
    if (!hasDriveToken()) throw new Error('Google Drive session has expired. Reconnect Drive to continue syncing.');
    return { Authorization: `Bearer ${driveToken}` };
  }
  async function driveApi(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...driveAuthHeader(), ...(options.headers || {}) } });
    if (res.status === 401) { driveToken = null; throw new Error('Google Drive session expired. Tap Connect Drive again.'); }
    if (!res.ok) {
      let detail = ''; try { detail = (await res.json()).error?.message || ''; } catch (_) {}
      throw new Error(`Google Drive request failed (${res.status})${detail ? `: ${detail}` : ''}`);
    }
    if (res.status === 204) return null;
    const type = res.headers.get('content-type') || '';
    return type.includes('application/json') ? res.json() : res.text();
  }
  async function getDriveInventory() {
    const query = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
    const list = await driveApi(`https://www.googleapis.com/drive/v3/files?spaces=drive&q=${query}&pageSize=100&fields=files(id,name,modifiedTime)`);
    const file = (list.files || []).sort((a,b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''))[0];
    driveFileId = file?.id || null;
    if (!file) return null;
    return await driveApi(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`);
  }
  async function putDriveInventory(data) {
    const payload = JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), userEmail: driveEmail, medicines: data });
    if (driveFileId) {
      await driveApi(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(driveFileId)}?uploadType=media`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: payload
      });
    } else {
      const boundary = 'hmt_drive_boundary_4b5a1e';
      const metadata = JSON.stringify({ name: DRIVE_FILE_NAME, mimeType: 'application/json', description: 'Data file for Home Medicine Tracker. Do not edit manually.' });
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${payload}\r\n--${boundary}--`;
      const created = await driveApi('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
      });
      driveFileId = created.id;
    }
  }
  function mergeRecords(a, b) {
    const map = new Map();
    for (const item of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
      if (!item || !item.id) continue;
      const old = map.get(item.id);
      if (!old || String(item.updatedAt || item.createdAt || '') >= String(old.updatedAt || old.createdAt || '')) map.set(item.id, item);
    }
    return [...map.values()];
  }
  async function driveSync(showFeedback = true) {
    if (driveBusy) { if (showFeedback) showToast('Sync is already running.'); return; }
    if (!hasDriveToken()) { if (showFeedback) showToast('Connect Google Drive first.'); return; }
    driveBusy = true; $('syncNowBtn').disabled = true;
    try {
      const cloud = await getDriveInventory();
      medicines = mergeRecords(medicines, cloud?.medicines || []);
      persistLocal(); render();
      await putDriveInventory(medicines);
      const msg = `Synced to Google Drive${driveEmail ? ` as ${driveEmail}` : ''}.`;
      setDriveStatus('Google Drive connected', msg, true); $('syncFeedback').textContent = msg;
      if (showFeedback) showToast('Google Drive sync complete.');
    } catch (err) {
      $('syncFeedback').textContent = err.message;
      setDriveStatus('Drive sync needs attention', err.message, false);
      if (showFeedback) showToast(err.message);
    } finally { driveBusy = false; $('syncNowBtn').disabled = false; }
  }
  async function connectDrive() {
    const clientId = (settings.clientId || '').trim();
    if (!clientId) { showDialog('settingsDialog'); $('syncFeedback').textContent = 'Enter and save your Google OAuth Web Client ID first.'; return; }
    if (!window.google?.accounts?.oauth2) { showToast('Google sign-in is still loading. Try again in a moment.'); return; }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email',
      callback: async response => {
        if (response.error) { $('syncFeedback').textContent = `Google authorization failed: ${response.error}`; return; }
        driveToken = response.access_token; driveTokenExpiry = Date.now() + (Number(response.expires_in || 3600) * 1000);
        try {
          const me = await driveApi('https://www.googleapis.com/oauth2/v3/userinfo');
          driveEmail = me.email || '';
          await driveSync(false);
          if (hasDriveToken()) showToast(`Connected ${driveEmail ? `as ${driveEmail}` : 'to Google Drive'}.`);
          closeDialog('settingsDialog');
        } catch (err) { $('syncFeedback').textContent = err.message; showToast(err.message); }
      },
      error_callback: error => { $('syncFeedback').textContent = error?.message || 'Google sign-in popup could not open. Allow popups and try again.'; }
    });
    client.requestAccessToken({ prompt: 'consent' });
  }
  async function autoSyncIfConnected() { if (hasDriveToken()) await driveSync(false); }
  function exportBackup() {
    const data = { app: 'Home Medicine Tracker', schemaVersion: 1, exportedAt: new Date().toISOString(), medicines };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `home-medicine-backup-${todayISO()}.json`; a.click(); URL.revokeObjectURL(url);
    showToast('Backup exported. Store it somewhere safe.');
  }
  async function importBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.medicines;
      if (!Array.isArray(incoming)) throw new Error('This does not look like a Home Medicine Tracker backup.');
      medicines = mergeRecords(medicines, incoming.map(m => ({ ...m, updatedAt: m.updatedAt || new Date().toISOString() })));
      persistLocal(); render(); await autoSyncIfConnected(); showToast(`Imported ${incoming.length} medicine record(s).`);
    } catch (e) { showToast(`Import failed: ${e.message}`); }
    $('importInput').value = '';
  }

  // Events
  $('addMedicineBtn').addEventListener('click', openNewMedicine);
  $('emptyAddBtn').addEventListener('click', openNewMedicine);
  $('medicineForm').addEventListener('submit', saveMedicine);
  $('searchInput').addEventListener('input', render);
  $('medicineList').addEventListener('click', e => {
    const edit = e.target.closest('[data-edit]'); const del = e.target.closest('[data-delete]');
    if (edit) openEditMedicine(edit.dataset.edit); if (del) deleteMedicine(del.dataset.delete);
  });
  document.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => {
    currentFilter = btn.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === btn)); render();
  }));
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeDialog(btn.dataset.close)));
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  $('addOffsetBtn').addEventListener('click', () => {
    const raw = $('newOffsetInput').value.trim();
    if (!raw || !Number.isInteger(Number(raw))) return showToast('Enter a whole number of days, such as -7, 0, or 2.');
    const vals = readOffsets(); vals.push(Number(raw)); renderOffsets(vals); $('newOffsetInput').value = '';
  });
  $('newOffsetInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('addOffsetBtn').click(); } });
  $('reminderOffsets').addEventListener('click', e => { const btn = e.target.closest('[data-remove-offset]'); if (btn) renderOffsets(readOffsets().filter(n => n !== Number(btn.dataset.removeOffset))); });
  $('imageInput').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    try { pendingImage = await compressImage(file); $('imagePreview').src = pendingImage; $('imagePreviewWrap').classList.remove('hidden'); }
    catch (err) { showToast(err.message); e.target.value = ''; }
  });
  $('removeImageBtn').addEventListener('click', () => { pendingImage = null; $('imagePreview').src = ''; $('imagePreviewWrap').classList.add('hidden'); $('imageInput').value = ''; });
  $('settingsBtn').addEventListener('click', () => { $('clientIdInput').value = settings.clientId || ''; showDialog('settingsDialog'); });
  $('saveClientIdBtn').addEventListener('click', () => {
    const id = $('clientIdInput').value.trim();
    if (id && !id.endsWith('.apps.googleusercontent.com')) { $('syncFeedback').textContent = 'That ID does not look like a Google OAuth Web Client ID.'; return; }
    settings.clientId = id; persistSettings(); $('syncFeedback').textContent = id ? 'Client ID saved on this device. Connect Drive next.' : 'Client ID cleared.'; showToast('Settings saved on this device.');
  });
  $('connectDriveBtn').addEventListener('click', () => hasDriveToken() ? driveSync(true) : connectDrive());
  $('connectFromSettingsBtn').addEventListener('click', connectDrive);
  $('syncNowBtn').addEventListener('click', () => driveSync(true));
  $('enableNotificationsBtn').addEventListener('click', enableNotifications);
  $('reminderSettingsEnable').addEventListener('click', enableNotifications);
  $('remindersBtn').addEventListener('click', () => showDialog('remindersDialog'));
  $('exportBtn').addEventListener('click', exportBackup);
  $('importInput').addEventListener('change', e => importBackup(e.target.files?.[0]));
  $('clearLocalBtn').addEventListener('click', () => {
    if (!confirm('Clear the medicine inventory stored on this device? This does not delete the Google Drive copy. Export a backup first if needed.')) return;
    medicines = []; persistLocal(); render(); $('syncFeedback').textContent = 'Local inventory cleared; Drive was not changed.'; showToast('Local inventory cleared.');
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').then(reg => { swRegistration = reg; }).catch(() => {});
  }
  render();
  // App checks on launch and periodically while open. If it was closed around a reminder date, missed reminders are shown when reopened.
  checkReminders();
  setInterval(() => { checkReminders(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); } });
})();
