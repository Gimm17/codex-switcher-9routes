const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { execFile, spawn } = require('child_process');

const CODEX_DIR = path.join(os.homedir(), '.codex');
const CONFIG_PATH = path.join(CODEX_DIR, 'config.toml');
const AUTH_PATH = path.join(CODEX_DIR, 'auth.json');
const MODEL_PROVIDER = '9router';
const DEFAULT_BASE_URL = 'https://api2.tokito.xyz/v1';

// smol-toml for proper TOML parse/stringify
let TOML;
try {
  TOML = require('smol-toml');
} catch (e) {
  console.error('smol-toml not found, TOML patching will be unavailable:', e.message);
}

let mainWindow = null;

function normalizeBaseUrl(baseUrl) {
  let value = (typeof baseUrl === 'string' && baseUrl.trim()) ? baseUrl.trim() : DEFAULT_BASE_URL;
  value = value.replace(/\/+$/, '');
  if (value.endsWith('/models')) {
    value = value.slice(0, -'/models'.length);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    throw new Error('Invalid Base URL: ' + value);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Invalid Base URL protocol: ' + parsed.protocol);
  }

  return value;
}

function readParsedConfig() {
  if (!TOML || !fs.existsSync(CONFIG_PATH)) return {};
  return TOML.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function readConfiguredBaseUrl() {
  try {
    const parsed = readParsedConfig();
    const providerKey = parsed.model_provider || MODEL_PROVIDER;
    return parsed.model_providers?.[providerKey]?.base_url || DEFAULT_BASE_URL;
  } catch (e) {
    return DEFAULT_BASE_URL;
  }
}

function readApiKey() {
  if (!fs.existsSync(AUTH_PATH)) return '';

  try {
    const auth = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    return auth.OPENAI_API_KEY || auth?.providers?.[MODEL_PROVIDER]?.api_key || '';
  } catch (e) {
    return '';
  }
}

function fetchModelsFromApi(apiKey, baseUrl) {
  return new Promise((resolve) => {
    let modelsUrl;
    try {
      modelsUrl = new URL(normalizeBaseUrl(baseUrl) + '/models');
    } catch (e) {
      resolve({ error: e.message });
      return;
    }

    const headers = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const req = https.request({
      hostname: modelsUrl.hostname,
      path: modelsUrl.pathname + modelsUrl.search,
      method: 'GET',
      headers,
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        const bodyPrefix = (body || '').trim().slice(0, 200);
        const host = modelsUrl.hostname;

        if (res.statusCode < 200 || res.statusCode >= 300) {
          resolve({
            error: `HTTP ${res.statusCode} from ${host}: ${bodyPrefix || res.statusMessage || 'empty response'}`,
          });
          return;
        }

        try {
          resolve({ success: true, data: JSON.parse(body), baseUrl: normalizeBaseUrl(baseUrl) });
        } catch (parseErr) {
          resolve({ error: `Invalid JSON from ${host}: ${bodyPrefix || parseErr.message}` });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ error: `Request timeout (10s) from ${modelsUrl.hostname}` });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

function resolveCodexExe() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ error: 'Run Codex currently supports the Windows OpenAI.Codex package only' });
      return;
    }

    const command = 'Get-AppxPackage OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty InstallLocation';
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true }, (error, stdout, stderr) => {
      const installLocation = stdout.trim();
      if (error || !installLocation) {
        const detail = (stderr || error?.message || '').trim();
        resolve({ error: detail || 'OpenAI.Codex package not found' });
        return;
      }

      const codexExe = path.join(installLocation, 'app', 'Codex.exe');
      if (!fs.existsSync(codexExe)) {
        resolve({ error: 'Codex.exe not found at ' + codexExe });
        return;
      }

      resolve({ success: true, path: codexExe });
    });
  });
}

// ─── Window Controls (registered ONCE, outside createWindow) ───
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win-close', () => mainWindow?.close());

// ─── Read current config ───
ipcMain.handle('read-config', () => {
  try {
    if (!fs.existsSync(CODEX_DIR)) fs.mkdirSync(CODEX_DIR, { recursive: true });
    const config = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : '';
    const auth = fs.existsSync(AUTH_PATH) ? fs.readFileSync(AUTH_PATH, 'utf8') : '{}';
    return { config, auth, configPath: CONFIG_PATH, authPath: AUTH_PATH };
  } catch (e) {
    return { error: e.message };
  }
});

// ─── PATCH config.toml — selective field update (SAFE) ───
ipcMain.handle('patch-config', (_, updates) => {
  try {
    if (!TOML) return { error: 'smol-toml library not available' };
    if (!fs.existsSync(CODEX_DIR)) fs.mkdirSync(CODEX_DIR, { recursive: true });

    let parsed = {};
    if (fs.existsSync(CONFIG_PATH)) {
      const existing = fs.readFileSync(CONFIG_PATH, 'utf8');
      try {
        parsed = TOML.parse(existing);
      } catch (parseErr) {
        return { error: 'TOML parse error: ' + parseErr.message };
      }
    }

    // Patch only the fields we need
    if (updates.model) {
      parsed.model = updates.model;
      // Also update subagent model to match
      if (!parsed.agents) parsed.agents = {};
      if (!parsed.agents.subagent) parsed.agents.subagent = {};
      parsed.agents.subagent.model = updates.model;
    }

    if (updates.model_provider) {
      parsed.model_provider = updates.model_provider;
    }

    if (updates.model_reasoning_effort) {
      parsed.model_reasoning_effort = updates.model_reasoning_effort;
    }

    if (updates.personality) {
      parsed.personality = updates.personality;
    }

    if (updates.wire_api) {
      const providerKey = parsed.model_provider || '9router';
      if (!parsed.model_providers) parsed.model_providers = {};
      if (!parsed.model_providers[providerKey]) {
        parsed.model_providers[providerKey] = {
          name: '9Router',
          base_url: DEFAULT_BASE_URL,
        };
      }
      parsed.model_providers[providerKey].wire_api = updates.wire_api;
    }

    if (updates.base_url) {
      const providerKey = parsed.model_provider || '9router';
      if (!parsed.model_providers) parsed.model_providers = {};
      if (!parsed.model_providers[providerKey]) {
        parsed.model_providers[providerKey] = {
          name: '9Router',
        };
      }
      parsed.model_providers[providerKey].base_url = updates.base_url;
    }

    // Backup before write
    if (fs.existsSync(CONFIG_PATH)) {
      fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    }

    fs.writeFileSync(CONFIG_PATH, TOML.stringify(parsed), 'utf8');
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// ─── Write FULL config.toml (raw editor) ───
ipcMain.handle('write-config', (_, tomlContent) => {
  try {
    if (!fs.existsSync(CODEX_DIR)) fs.mkdirSync(CODEX_DIR, { recursive: true });
    if (fs.existsSync(CONFIG_PATH)) {
      fs.copyFileSync(CONFIG_PATH, CONFIG_PATH + '.bak');
    }
    fs.writeFileSync(CONFIG_PATH, tomlContent, 'utf8');
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// ─── Write auth.json ───
ipcMain.handle('write-auth', (_, authContent) => {
  try {
    if (!fs.existsSync(CODEX_DIR)) fs.mkdirSync(CODEX_DIR, { recursive: true });
    if (fs.existsSync(AUTH_PATH)) {
      fs.copyFileSync(AUTH_PATH, AUTH_PATH + '.bak');
    }
    fs.writeFileSync(AUTH_PATH, authContent, 'utf8');
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// ─── Fetch models from 9Router API (with timeout) ───
ipcMain.handle('fetch-models', async (_, payload) => {
  try {
    const apiKey = typeof payload === 'string' ? payload : payload?.apiKey;
    const baseUrl = typeof payload === 'object' ? payload?.baseUrl : readConfiguredBaseUrl();
    return await fetchModelsFromApi(apiKey, baseUrl);
  } catch (e) {
    return { error: e.message };
  }
});

// Fetch model list for grid using saved auth/config.
ipcMain.handle('fetch-models-list', async () => {
  try {
    const result = await fetchModelsFromApi(readApiKey(), readConfiguredBaseUrl());
    if (!result.success) return result;

    if (result.data?.data && Array.isArray(result.data.data)) {
      const models = result.data.data.map((m) => ({
        id: m.id,
        owner: m.owned_by || 'unknown',
      }));
      return { success: true, models, baseUrl: result.baseUrl };
    }

    return { error: 'Unexpected response format from models API' };
  } catch (e) {
    return { error: e.message };
  }
});

// Launch the installed Codex desktop app.
ipcMain.handle('launch-codex', async () => {
  try {
    const resolved = await resolveCodexExe();
    if (!resolved.success) return { error: resolved.error };

    return await new Promise((resolve) => {
      let settled = false;
      const child = spawn(resolved.path, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });

      child.once('error', (e) => {
        if (settled) return;
        settled = true;
        resolve({ error: e.message });
      });

      setTimeout(() => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve({ success: true, path: resolved.path });
      }, 250);
    });
  } catch (e) {
    return { error: e.message };
  }
});

// ─── Window ───
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#FBF3D5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
