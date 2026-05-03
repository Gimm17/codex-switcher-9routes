// ─── Fallback model list (used if API fetch fails) ───
const FALLBACK_MODELS = [
  {id:"pecut-ai",owner:"combo"},
  {id:"ag/gemini-3.1-pro-high",owner:"ag"},
  {id:"ag/gemini-3.1-pro-low",owner:"ag"},
  {id:"ag/gemini-3-flash",owner:"ag"},
  {id:"ag/claude-sonnet-4-6",owner:"ag"},
  {id:"ag/claude-opus-4-6-thinking",owner:"ag"},
  {id:"ag/gpt-oss-120b-medium",owner:"ag"},
  {id:"gc/gemini-3-flash-preview",owner:"gc"},
  {id:"gc/gemini-3-pro-preview",owner:"gc"},
  {id:"cx/gpt-5.5",owner:"cx"},
  {id:"cx/gpt-5.5-review",owner:"cx"},
  {id:"cx/gpt-5.4",owner:"cx"},
  {id:"cx/gpt-5.4-review",owner:"cx"},
  {id:"cx/gpt-5.3-codex",owner:"cx"},
  {id:"cx/gpt-5.3-codex-review",owner:"cx"},
  {id:"cx/gpt-5.3-codex-xhigh",owner:"cx"},
  {id:"cx/gpt-5.3-codex-xhigh-review",owner:"cx"},
  {id:"cx/gpt-5.3-codex-high",owner:"cx"},
  {id:"cx/gpt-5.3-codex-high-review",owner:"cx"},
  {id:"cx/gpt-5.3-codex-low",owner:"cx"},
  {id:"cx/gpt-5.3-codex-low-review",owner:"cx"},
  {id:"cx/gpt-5.3-codex-none",owner:"cx"},
  {id:"cx/gpt-5.3-codex-none-review",owner:"cx"},
  {id:"cx/gpt-5.3-codex-spark",owner:"cx"},
  {id:"cx/gpt-5.3-codex-spark-review",owner:"cx"},
  {id:"cx/gpt-5.1-codex-mini",owner:"cx"},
  {id:"cx/gpt-5.1-codex-mini-review",owner:"cx"},
  {id:"cx/gpt-5.1-codex-mini-high",owner:"cx"},
  {id:"cx/gpt-5.1-codex-mini-high-review",owner:"cx"},
  {id:"cx/gpt-5.2-codex",owner:"cx"},
  {id:"cx/gpt-5.2-codex-review",owner:"cx"},
  {id:"cx/gpt-5.2",owner:"cx"},
  {id:"cx/gpt-5.2-review",owner:"cx"},
  {id:"cx/gpt-5.1-codex-max",owner:"cx"},
  {id:"cx/gpt-5.1-codex-max-review",owner:"cx"},
  {id:"cx/gpt-5.1-codex",owner:"cx"},
  {id:"cx/gpt-5.1-codex-review",owner:"cx"},
  {id:"cx/gpt-5.1",owner:"cx"},
  {id:"cx/gpt-5.1-review",owner:"cx"},
  {id:"cx/gpt-5-codex",owner:"cx"},
  {id:"cx/gpt-5-codex-review",owner:"cx"},
  {id:"cx/gpt-5-codex-mini",owner:"cx"},
  {id:"cx/gpt-5-codex-mini-review",owner:"cx"},
  {id:"cx/gpt-5.4-image",owner:"cx"},
  {id:"cx/gpt-5.3-image",owner:"cx"},
  {id:"cx/gpt-5.2-image",owner:"cx"},
  {id:"glm/glm-5.1",owner:"glm"},
  {id:"glm/glm-5",owner:"glm"},
  {id:"glm/glm-4.7",owner:"glm"},
  {id:"glm/glm-4.6v",owner:"glm"},
  {id:"minimax/MiniMax-M2.7",owner:"minimax"},
  {id:"minimax/MiniMax-M2.5",owner:"minimax"},
  {id:"minimax/MiniMax-M2.1",owner:"minimax"},
  {id:"minimax/minimax-image-01",owner:"minimax"},
];

const BADGE_COLORS = {
  cx: '#9CAFAA', ag: '#D6A99D', gc: '#8BB0C4',
  glm: '#D6DAC8', minimax: '#C4A0B5', combo: '#b8b4a0'
};

// ─── State ───
let models = [...FALLBACK_MODELS];
let selectedModel = null;
let activeFilter = 'all';
let currentModel = '';
let wireApi = 'responses';
let modelsFromAPI = false;
let currentReasoningEffort = 'medium';
let currentPersonality = 'pragmatic';

// ─── Init ───
async function init() {
  const data = await window.api.readConfig();
  if (data.error) {
    showToast('Gagal baca config: ' + data.error, 'error');
    return;
  }

  document.getElementById('config-path-display').textContent = data.configPath;

  // Parse current model from config
  const modelMatch = data.config.match(/^model\s*=\s*"(.+?)"/m);
  currentModel = modelMatch ? modelMatch[1] : '';
  document.getElementById('current-model-display').textContent = currentModel || 'tidak diset';

  // Parse wire_api
  const wireMatch = data.config.match(/wire_api\s*=\s*"(.+?)"/);
  wireApi = wireMatch ? wireMatch[1] : 'responses';
  document.getElementById('wire-api-select').value = wireApi;

  // Parse reasoning effort
  const reMatch = data.config.match(/model_reasoning_effort\s*=\s*"(.+?)"/);
  currentReasoningEffort = reMatch ? reMatch[1] : 'medium';
  document.getElementById('reasoning-effort-select').value = currentReasoningEffort;

  // Parse personality
  const persMatch = data.config.match(/personality\s*=\s*"(.+?)"/);
  currentPersonality = persMatch ? persMatch[1] : 'pragmatic';
  document.getElementById('personality-select').value = currentPersonality;

  // Parse base_url
  const baseMatch = data.config.match(/base_url\s*=\s*"(.+?)"/);
  if (baseMatch) {
    document.getElementById('base-url-input').value = baseMatch[1];
  }

  // Parse API key from auth.json (support OPENAI_API_KEY flat format)
  try {
    const auth = JSON.parse(data.auth);
    const key = auth.OPENAI_API_KEY || auth?.providers?.['9router']?.api_key || '';
    document.getElementById('api-key-input').value = key;
  } catch (e) {
    // Ignore parse errors
  }

  // Load raw config editors
  document.getElementById('raw-config').value = data.config;
  document.getElementById('raw-auth').value = data.auth;

  // Status
  document.getElementById('status-dot').classList.add('ok');
  document.getElementById('status-text').textContent = 'Config ditemukan';

  buildFilters();
  renderModels();

  // Load models from API in background
  loadModelsFromAPI();
}

// ─── Dynamic model loading from API ───
async function loadModelsFromAPI() {
  const btn = document.getElementById('refresh-models-btn');
  btn.classList.add('spinning');

  try {
    const res = await window.api.fetchModelsList();
    if (res.success && res.models && res.models.length > 0) {
      models = res.models;
      modelsFromAPI = true;
      buildFilters();
      renderModels();
      showToast(`${models.length} model dimuat dari API`, 'success');
    } else {
      // Keep fallback
      if (!modelsFromAPI) {
        showToast('Gagal fetch API, pakai list offline', 'error');
      }
    }
  } catch (e) {
    if (!modelsFromAPI) {
      showToast('API tidak tersedia, pakai list offline', 'error');
    }
  } finally {
    btn.classList.remove('spinning');
  }
}

// ─── Filters ───
function buildFilters() {
  const ownerSet = new Set(models.map(m => m.owner));
  const owners = ['all', ...Array.from(ownerSet).sort()];
  const pills = document.getElementById('filter-pills');
  pills.innerHTML = '';
  owners.forEach(o => {
    const p = document.createElement('button');
    p.className = 'pill' + (o === activeFilter ? ' active' : '');
    p.textContent = o === 'all' ? 'Semua' : o;
    p.onclick = () => {
      activeFilter = o;
      document.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      renderModels();
    };
    pills.appendChild(p);
  });
}

// ─── Render model grid ───
function renderModels() {
  const q = document.getElementById('model-search').value.toLowerCase();
  const filtered = models.filter(m =>
    (activeFilter === 'all' || m.owner === activeFilter) &&
    m.id.toLowerCase().includes(q)
  );
  const grid = document.getElementById('models-grid');
  grid.innerHTML = '';

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="grid-loading">Tidak ada model ditemukan</div>';
    return;
  }

  filtered.forEach(m => {
    const card = document.createElement('div');
    let classes = 'model-card';
    if (selectedModel === m.id) classes += ' selected';
    if (currentModel === m.id) classes += ' is-current';
    card.className = classes;

    const color = BADGE_COLORS[m.owner] || '#888';
    card.innerHTML = `
      <div class="model-name">${escapeHtml(m.id)}</div>
      <span class="model-badge" style="background:${color}22;color:${color};">${escapeHtml(m.owner)}</span>
    `;
    card.onclick = () => selectModel(m.id);
    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Select & Preview ───
function selectModel(id) {
  selectedModel = id;
  renderModels();
  showPreview(id);
}

function showPreview(id) {
  const body = document.getElementById('preview-body');
  const newRE = document.getElementById('reasoning-effort-select').value;
  const newPers = document.getElementById('personality-select').value;
  const modelSame = id === currentModel;
  const reSame = newRE === currentReasoningEffort;
  const persSame = newPers === currentPersonality;
  const allSame = modelSame && reSame && persSame;

  let html = '';

  // Safe badge
  html += `<div class="safe-badge">🛡️ Hanya field yang dipilih berubah</div>`;

  // Model
  html += `<div class="change-item">
    <div class="change-label">model</div>
    ${modelSame
      ? `<div class="change-same">"${escapeHtml(id)}" (sama)</div>`
      : `<div><span class="change-old">"${escapeHtml(currentModel || '(kosong)')}"</span><span class="change-arrow">→</span><span class="change-new">"${escapeHtml(id)}"</span></div>`
    }
  </div>`;

  // Reasoning effort
  html += `<div class="change-item">
    <div class="change-label">reasoning effort</div>
    ${reSame
      ? `<div class="change-same">"${escapeHtml(newRE)}" (sama)</div>`
      : `<div><span class="change-old">"${escapeHtml(currentReasoningEffort)}"</span><span class="change-arrow">→</span><span class="change-new">"${escapeHtml(newRE)}"</span></div>`
    }
  </div>`;

  // Personality
  html += `<div class="change-item">
    <div class="change-label">personality</div>
    ${persSame
      ? `<div class="change-same">"${escapeHtml(newPers)}" (sama)</div>`
      : `<div><span class="change-old">"${escapeHtml(currentPersonality)}"</span><span class="change-arrow">→</span><span class="change-new">"${escapeHtml(newPers)}"</span></div>`
    }
  </div>`;

  // Preserved sections
  html += `<div style="font-size:11px;color:var(--text3);margin:12px 0 8px;line-height:1.5;">
    Sections yang <strong style="color:var(--green);">TIDAK</strong> diubah:<br>
    ✓ [projects.*]<br>
    ✓ [marketplaces.*]<br>
    ✓ [plugins.*]<br>
    ✓ [windows]
  </div>`;

  html += `<button class="apply-btn" onclick="applyModel()" id="apply-btn" ${allSame ? 'disabled' : ''}>
    ${allSame ? 'Tidak ada perubahan' : 'Apply ke config.toml'}
  </button>`;
  html += `<div style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center;">Backup .bak dibuat otomatis</div>`;

  body.innerHTML = html;
}

// ─── Apply model (selective patch!) ───
async function applyModel() {
  if (!selectedModel) return;

  const btn = document.getElementById('apply-btn');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  const newRE = document.getElementById('reasoning-effort-select').value;
  const newPers = document.getElementById('personality-select').value;

  const result = await window.api.patchConfig({
    model: selectedModel,
    model_provider: '9router',
    model_reasoning_effort: newRE,
    personality: newPers,
  });

  if (result.success) {
    currentModel = selectedModel;
    currentReasoningEffort = newRE;
    currentPersonality = newPers;
    document.getElementById('current-model-display').textContent = selectedModel;

    // Reload raw config view
    const data = await window.api.readConfig();
    if (!data.error) {
      document.getElementById('raw-config').value = data.config;
    }

    showToast('Config updated: ' + selectedModel, 'success');
    showPreview(selectedModel);
    renderModels();
  } else {
    showToast('Gagal: ' + result.error, 'error');
    btn.disabled = false;
    btn.textContent = 'Apply ke config.toml';
  }
}

// ─── Auth ───
async function saveAuth() {
  const btn = document.getElementById('save-auth-btn');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  const key = document.getElementById('api-key-input').value.trim();

  // Use the flat OPENAI_API_KEY format that Codex actually reads
  const authObj = {
    auth_mode: 'apikey',
    OPENAI_API_KEY: key,
  };

  const result = await window.api.writeAuth(JSON.stringify(authObj, null, 2));

  btn.disabled = false;
  btn.textContent = 'Simpan auth.json';

  if (result.success) {
    // Also update base_url and wire_api in config.toml
    const baseUrl = document.getElementById('base-url-input').value.trim();
    const wire = document.getElementById('wire-api-select').value;
    wireApi = wire;

    await window.api.patchConfig({
      wire_api: wire,
      base_url: baseUrl,
      model_provider: '9router',
    });

    showToast('auth.json & config disimpan!', 'success');
  } else {
    showToast('Gagal simpan auth: ' + result.error, 'error');
  }
}

// ─── Test connection ───
async function testConnection() {
  const key = document.getElementById('api-key-input').value.trim();
  const el = document.getElementById('test-result');
  const btn = document.getElementById('test-conn-btn');

  btn.disabled = true;
  btn.textContent = 'Testing...';
  el.style.color = 'var(--text3)';
  el.textContent = 'Menghubungi API...';

  const res = await window.api.fetchModels(key);

  btn.disabled = false;
  btn.textContent = 'Ping API';

  if (res.success) {
    el.style.color = 'var(--green)';
    el.textContent = `Berhasil! ${res.data.data?.length || 0} model tersedia.`;
  } else {
    el.style.color = 'var(--red)';
    el.textContent = 'Gagal: ' + res.error;
  }
}

// ─── Raw config ───
async function loadRawConfig() {
  const data = await window.api.readConfig();
  if (!data.error) {
    document.getElementById('raw-config').value = data.config;
    document.getElementById('raw-auth').value = data.auth;
    showToast('Config di-reload', 'success');
  } else {
    showToast('Gagal reload: ' + data.error, 'error');
  }
}

async function saveRawConfig() {
  const val = document.getElementById('raw-config').value;
  const result = await window.api.writeConfig(val);
  if (result.success) {
    showToast('config.toml disimpan!', 'success');
    // Update current model display
    const modelMatch = val.match(/^model\s*=\s*"(.+?)"/m);
    if (modelMatch) {
      currentModel = modelMatch[1];
      document.getElementById('current-model-display').textContent = currentModel;
      renderModels();
    }
  } else {
    showToast('Gagal: ' + result.error, 'error');
  }
}

async function saveRawAuth() {
  const val = document.getElementById('raw-auth').value;
  const result = await window.api.writeAuth(val);
  if (result.success) showToast('auth.json disimpan!', 'success');
  else showToast('Gagal: ' + result.error, 'error');
}

// ─── Page switching ───
function switchPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  el.classList.add('active');
}

// ─── Toast ───
let toastTimer;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  document.getElementById('toast-msg').textContent = msg;
  toast.className = 'toast ' + type;
  icon.textContent = type === 'success' ? '✓' : '✕';
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

// ─── Keyboard shortcuts ───
document.addEventListener('keydown', (e) => {
  // Ctrl+S — save based on active page
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    const activePage = document.querySelector('.page.active');
    if (activePage?.id === 'page-config') {
      saveRawConfig();
    } else if (activePage?.id === 'page-auth') {
      saveAuth();
    }
  }
});

// ─── Start ───
init();
