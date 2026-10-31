// Settings screen: names, sync with the Google Sheet, backup, shortcuts, privacy.

import * as state from '../state.js';
import * as sync from '../sync.js';
import { buildBackup, parseBackup } from '../storage.js';
import { APP_VERSION } from '../version.js';
import { esc, toast } from './dom.js';
import { SHORTCUTS } from './shortcuts.js';

export function render(main) {
  const s = state.getSettings();
  const d = state.getDevice();
  const st = sync.getStatus();
  const configured = sync.isConfigured();

  main.innerHTML = `
    <div class="stack">
      <section class="card">
        <h2>People</h2>
        <form id="people-form" class="stack">
          ${personFields('t', s)}
          ${personFields('k', s)}
          <button class="btn" type="submit">Save names</button>
        </form>
      </section>

      <section class="card">
        <h2>This phone belongs to</h2>
        <div class="seg" role="radiogroup" aria-label="This phone belongs to">
          ${['t', 'k'].map((p) => `
            <input type="radio" id="me-${p}" name="me" value="${p}" ${d.me === p ? 'checked' : ''}>
            <label for="me-${p}">${esc(s.names[p])}</label>`).join('')}
        </div>
        <p class="muted small" style="margin:8px 0 0">Used as the default "paid from" and to show who entered what.</p>
      </section>

      <section class="card">
        <h2>Sync with Google Sheet</h2>
        <p class="muted small" style="margin-top:0">${configured
          ? `Connected. ${st.at ? `Last sync ${esc(new Date(st.at).toLocaleString('en-GB'))}.` : ''} ${state.pendingCount()} change(s) waiting.`
          : 'Not set up yet: data stays on this phone only. See SETUP.md for the 10-minute setup.'}</p>
        ${st.kind === 'error' ? `<p class="form-error">Last sync failed: ${esc(st.message)}</p>` : ''}
        <form id="sync-form">
          <div class="field">
            <label for="sync-url">Web app URL</label>
            <input id="sync-url" type="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(d.syncUrl)}">
          </div>
          <div class="field">
            <label for="sync-key">Sync key</label>
            <input id="sync-key" type="password" autocomplete="off" value="${esc(d.syncKey)}">
            <div class="hint">Stored only on this phone. Never put it in the repository.</div>
          </div>
          <div class="btn-row">
            <button class="btn primary" type="submit">Test and save</button>
            ${configured ? '<button class="btn" type="button" data-act="sync" title="Sync now (Ctrl+S)">Sync now</button>' : ''}
          </div>
        </form>
      </section>

      <section class="card">
        <h2>Backup</h2>
        <p class="muted small" style="margin-top:0">A file with all your budget data (without the sync key). Good to keep now and then.</p>
        <div class="btn-row">
          <button class="btn" data-act="export">Download backup</button>
          <label class="btn" for="import-file">Restore from file</label>
          <input id="import-file" type="file" accept="application/json,.json" hidden>
        </div>
      </section>

      <section class="card">
        <h2>Keyboard shortcuts</h2>
        <dl class="shortcut-list">${SHORTCUTS.map((sc) => `<dt>${sc.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</dt><dd>${esc(sc.label)}</dd>`).join('')}</dl>
      </section>

      <section class="card prose">
        <h2>Privacy</h2>
        <ul>
          <li><b>On this phone:</b> all budget data is kept in the browser's storage, so the app works offline.</li>
          <li><b>Sent where:</b> only to your own Google Sheet, through your own Apps Script, when sync is set up. Nothing goes to anyone else. No analytics, no tracking, no fonts or libraries loaded from other sites.</li>
          <li><b>Kept how long:</b> until you delete it. Deleted entries stay in the Sheet as "deleted" rows so the deletion reaches the other phone; you can remove those rows in the Sheet any time.</li>
          <li><b>Delete:</b> "Forget this phone" below removes everything from this phone. To delete everything, also delete the Google Sheet.</li>
        </ul>
        <button class="btn danger" data-act="reset">Forget this phone</button>
      </section>

      <p class="muted small">Household Budget · version ${esc(APP_VERSION)} · system fonts, no third-party code.</p>
    </div>`;

  main.querySelector('#people-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const names = { t: f.name_t.value.trim() || 'Tõnis', k: f.name_k.value.trim() || 'Kristiina' };
    const initials = {
      t: (f.ini_t.value.trim() || 'TT').slice(0, 3).toUpperCase(),
      k: (f.ini_k.value.trim() || 'KM').slice(0, 3).toUpperCase(),
    };
    state.saveSettings({ names, initials });
    toast('Names saved');
  });

  main.querySelectorAll('input[name="me"]').forEach((r) => {
    r.addEventListener('change', () => state.setDevice({ me: r.value }));
  });

  main.querySelector('#sync-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = main.querySelector('#sync-url').value.trim();
    const key = main.querySelector('#sync-key').value.trim();
    if (!url && !key) {
      state.setDevice({ syncUrl: '', syncKey: '' });
      toast('Sync turned off');
      return;
    }
    if (!/^https:\/\/script\.google\.com\//.test(url)) {
      toast('The URL should start with https://script.google.com/');
      return;
    }
    toast('Testing connection…');
    try {
      await sync.testConnection(url, key);
      state.setDevice({ syncUrl: url, syncKey: key });
      toast('Connected. Syncing…');
      await sync.syncNow();
    } catch (err) {
      toast(`Could not connect: ${err.message}`);
    }
  });

  main.querySelector('[data-act="sync"]')?.addEventListener('click', () => sync.syncNow());

  main.querySelector('[data-act="export"]').addEventListener('click', downloadBackup);

  main.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const n = state.importRecords(parseBackup(await file.text()));
      toast(`Restored: ${n} record(s) updated`);
    } catch (err) {
      toast(err.message);
    }
    e.target.value = '';
  });

  main.querySelector('[data-act="reset"]').addEventListener('click', () => {
    const msg = state.pendingCount() > 0
      ? `${state.pendingCount()} change(s) have not reached the Sheet yet and will be lost. Forget this phone anyway?`
      : 'Remove all budget data and the sync key from this phone? The Google Sheet is not touched.';
    if (confirm(msg)) {
      state.resetDevice();
      toast('This phone is now empty');
    }
  });
}

function personFields(p, s) {
  return `<div class="inline-field">
    <div class="field" style="flex:2 1 160px;margin:0"><label for="name_${p}">Name</label><input id="name_${p}" name="name_${p}" type="text" value="${esc(s.names[p])}"></div>
    <div class="field" style="flex:1 1 80px;margin:0"><label for="ini_${p}">Initials</label><input id="ini_${p}" name="ini_${p}" type="text" maxlength="3" value="${esc(s.initials[p])}"></div>
  </div>`;
}

export function downloadBackup() {
  const blob = new Blob([buildBackup(state.allRecords(), APP_VERSION)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `household-budget-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
