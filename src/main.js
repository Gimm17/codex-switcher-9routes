const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec } = require('child_process');

const CODEX_DIR = path.join(os.homedir(), '.codex');
const CONFIG_PATH = path.join(CODEX_DIR, 'config.toml');
const AUTH_PATH = path.join(CODEX_DIR, 'auth.json');

// smol-toml for proper TOML parse/stringify
let TOML;
try {
  TOML = require('smol-toml');
} catch (e) {
  console.error('smol-toml not found, TOML patching will be unavailable:', e.message);
}

let mainWindow = null;

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
          base_url: 'https://api.tokito.xyz/v1',
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
ipcMain.handle('fetch-models', async (_, apiKey) => {
  try {
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.tokito.xyz',
        path: '/v1/models',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        timeout: 10000,
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ success: true, data: parsed });
          } catch (parseErr) {
            resolve({ error: 'JSON parse error: ' + parseErr.message });
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ error: 'Request timeout (10s)' });
      });
      req.on('error', (e) => resolve({ error: e.message }));
      req.end();
    });
  } catch (e) {
    return { error: e.message };
  }
});

// ─── Fetch model list for grid (no auth needed for public endpoint) ───
ipcMain.handle('fetch-models-list', async () => {
  try {
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.tokito.xyz',
        path: '/v1/models',
        method: 'GET',
        timeout: 10000,
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.data && Array.isArray(parsed.data)) {
              const models = parsed.data.map((m) => ({
                id: m.id,
                owner: m.owned_by || 'unknown',
              }));
              resolve({ success: true, models });
            } else {
              resolve({ error: 'Unexpected response format' });
            }
          } catch (parseErr) {
            resolve({ error: 'JSON parse error: ' + parseErr.message });
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ error: 'Request timeout (10s)' });
      });
      req.on('error', (e) => resolve({ error: e.message }));
      req.end();
    });
  } catch (e) {
    return { error: e.message };
  }
});

// ─── Launch Codex CLI ───
ipcMain.handle('launch-codex', () => {
  try {
    // Open a new terminal window running codex
    exec('start cmd /k codex', { cwd: os.homedir() });
    return { success: true };
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
