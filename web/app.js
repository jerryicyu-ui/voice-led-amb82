// 語音控制 AMB82-MINI LED — 前端主程式
// 流程：麥克風 → Web Speech API 辨識 → parseCommand() → USB 序列埠（Web Serial）→ 板子回傳 JSON → 更新畫面

const COMMAND_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 3000;

const $ = (id) => document.getElementById(id);

const settings = loadSettings();
const logRows = loadLog();

// ---------- 通訊層 ----------

class SerialTransport {
  constructor() {
    this.name = 'USB Serial';
    this.port = null;
    this.writer = null;
    this.pending = null;
    this.buffer = '';
  }

  get connected() {
    return this.port !== null;
  }

  async open(port) {
    if (!('serial' in navigator)) throw new Error('此瀏覽器不支援 Web Serial，請使用 Chrome 或 Edge');
    this.port = port || await navigator.serial.requestPort();
    try {
      await this.port.open({ baudRate: 115200 });
    } catch (err) {
      this.port = null;
      throw new Error(`無法開啟序列埠，請先關閉 VS Code 的序列埠監控視窗（${err.message}）`);
    }
    this.writer = this.port.writable.getWriter();
    navigator.serial.addEventListener('disconnect', (event) => {
      if (event.target === this.port) this.lost('USB 線已拔除');
    });
    this.readLoop();
  }

  async readLoop() {
    const decoder = new TextDecoder();
    try {
      const reader = this.port.readable.getReader();
      this.reader = reader;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, newline).trim();
          this.buffer = this.buffer.slice(newline + 1);
          // 韌體與系統 log 也會印到序列埠，只取 JSON 回覆
          if (line.startsWith('{') && this.pending) {
            try {
              this.pending.resolve(JSON.parse(line));
            } catch {
              this.pending.reject(new Error(`回覆格式錯誤：${line}`));
            }
            this.pending = null;
          }
        }
      }
    } catch (err) {
      this.lost(err.message);
    }
  }

  lost(reason) {
    if (!this.port) return;
    if (this.pending) this.pending.reject(new Error(`序列埠中斷：${reason}`));
    this.pending = null;
    this.port = null;
    this.writer = null;
    if (transport === this && online) {
      showNotice(`與開發板的通訊中斷：${reason}`, 'error');
      setOnline(false, reason);
    }
  }

  async send(cmd) {
    if (!this.connected) throw new Error('尚未連接 USB 序列埠（或已中斷），請插好 USB 線或按「連線開發板」');
    const reply = new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      setTimeout(() => {
        if (this.pending && this.pending.resolve === resolve) {
          this.pending = null;
          reject(new Error(`逾時 ${COMMAND_TIMEOUT_MS / 1000} 秒沒有回應（板子可能重開或當機）`));
        }
      }, COMMAND_TIMEOUT_MS);
    });
    await this.writer.write(new TextEncoder().encode(cmd + '\n'));
    return reply;
  }
}

let transport = null;
let queue = Promise.resolve();
let lastBoardState = null;
let online = false;

// 指令排隊送出，避免兩個請求同時等待同一個回覆
function sendToBoard(cmd) {
  const job = queue.then(() => {
    if (!transport) throw new Error('尚未連線，請先按「連線開發板」');
    return transport.send(cmd);
  });
  queue = job.catch(() => {});
  return job;
}

// port 省略時跳出瀏覽器的序列埠選擇視窗
async function connect(port = null) {
  if (transport && transport.connected) {
    try { await transport.reader.cancel(); await transport.port.close(); } catch { /* 已中斷 */ }
  }

  try {
    transport = new SerialTransport();
    await transport.open(port);
    await refreshStatus();
    if (online) showNotice(`已連線：${transport.name}`, 'ok');
  } catch (err) {
    if (err.name === 'NotFoundError') {
      transport = null;    // 使用者在選擇視窗按了取消
      setOnline(false);
      return;
    }
    setOnline(false, err.message);
    showNotice(`連線失敗：${err.message}`, 'error');
  }
}

let polling = false;
async function refreshStatus() {
  if (!transport || polling) return;
  polling = true;
  try {
    const state = await sendToBoard('STATUS');
    applyBoardState(state);
    if (!online) hideNotice();
    setOnline(true);
  } catch (err) {
    if (online) showNotice(`與開發板的通訊中斷：${err.message}`, 'error');
    setOnline(false, err.message);
  } finally {
    polling = false;
  }
}

// ---------- 指令執行（語音、按鈕、文字共用） ----------

async function execute(source, text, parsed, alternatives = []) {
  $('recognized').textContent = text || '（空白）';
  $('alternatives').textContent = alternatives.length > 1 ? `其他候選（僅供參考，不會執行）：${alternatives.slice(1).join('、')}` : '';

  if (!parsed.cmd) {
    $('parsed').innerHTML = `<span class="tag warn">未執行</span> ${escapeHtml(parsed.reason)}，LED 狀態不變`;
    addLog(source, text, '—', `未執行：${parsed.reason}`, 'skip');
    speak('這不是控制指令，燈號維持不變');
    return;
  }

  $('parsed').innerHTML = `<span class="tag">${parsed.cmd}</span> ${escapeHtml(parsed.label)} — 傳送中…`;
  try {
    const reply = await sendToBoard(parsed.cmd);
    applyBoardState(reply);
    setOnline(true);
    if (reply.ok) {
      $('parsed').innerHTML = `<span class="tag ok">${parsed.cmd}</span> ${escapeHtml(parsed.label)} — 板子已確認執行`;
      addLog(source, text, parsed.cmd, '成功', 'ok');
      speak(`好的，${parsed.label.replace(/（.*）/, '')}`);
    } else {
      $('parsed').innerHTML = `<span class="tag warn">${parsed.cmd}</span> 板子拒絕：${escapeHtml(reply.msg)}`;
      addLog(source, text, parsed.cmd, `板子拒絕：${reply.msg}`, 'skip');
    }
  } catch (err) {
    setOnline(false, err.message);
    $('parsed').innerHTML = `<span class="tag error">${parsed.cmd}</span> 通訊失敗，指令未送達`;
    showNotice(`通訊失敗：${err.message}`, 'error');
    addLog(source, text, parsed.cmd, `通訊失敗：${err.message}`, 'error');
    speak('通訊失敗，請檢查開發板連線');
  }
}

// ---------- 語音辨識 ----------

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;

function setupRecognition() {
  if (!SpeechRecognition) {
    $('mic').disabled = true;
    $('micHint').textContent = '此瀏覽器不支援 Web Speech API，請改用 Chrome 或 Edge（仍可用下方按鈕 / 文字測試）';
    return;
  }
  if (!window.isSecureContext) {
    $('micHint').textContent = '麥克風需要安全來源：請用 http://localhost 開啟此頁（執行 scripts\\serve.ps1）';
  }

  recognition = new SpeechRecognition();
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const alternatives = Array.from(result).map((alt) => alt.transcript.trim());
    if (!result.isFinal) {
      $('recognized').textContent = alternatives[0] + ' …';
      return;
    }
    execute('語音', alternatives[0], parseAlternatives(alternatives), alternatives);
  };

  recognition.onerror = (event) => {
    const messages = {
      'no-speech': '沒有聽到聲音，請再說一次',
      'not-allowed': '麥克風權限被拒絕，請在網址列左側允許麥克風',
      'network': '語音辨識服務連線失敗（Chrome 的辨識需要網路）',
      'audio-capture': '找不到麥克風裝置',
    };
    if (event.error === 'aborted') return;
    const message = messages[event.error] || `語音辨識錯誤：${event.error}`;
    showNotice(message, 'warn');
    if (event.error === 'no-speech') addLog('語音', '', '—', '未執行：沒有聽到聲音', 'skip');
    if (event.error === 'not-allowed' || event.error === 'audio-capture') stopListening();
  };

  recognition.onend = () => {
    if (listening && $('continuous').checked) {
      try { recognition.start(); return; } catch { /* 已在執行 */ }
    }
    setListening(false);
  };
}

function startListening() {
  if (!recognition) return;
  window.speechSynthesis?.cancel();
  recognition.lang = $('lang').value;
  try {
    recognition.start();
    setListening(true);
    $('recognized').textContent = '聆聽中…';
  } catch { /* 已在聆聽 */ }
}

function stopListening() {
  listening = false;
  recognition?.stop();
  setListening(false);
}

function setListening(value) {
  listening = value;
  $('mic').classList.toggle('active', value);
  $('micLabel').textContent = value ? '聆聽中…（再按一次停止）' : '按下說話';
}

// ---------- 語音回覆 ----------

function speak(text) {
  if (!$('speakBack').checked || !window.speechSynthesis) return;
  const english = $('lang').value.startsWith('en');
  const utterance = new SpeechSynthesisUtterance(english ? toEnglishReply(text) : text);
  utterance.lang = english ? 'en-US' : 'zh-TW';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function toEnglishReply(text) {
  if (text.includes('通訊失敗')) return 'Communication failed. Please check the board.';
  if (text.includes('不是控制指令')) return 'That is not a control command. LEDs unchanged.';
  return 'OK, done.';
}

// ---------- 畫面 ----------

function applyBoardState(state) {
  if (!state || typeof state.blue === 'undefined') return;
  lastBoardState = { ...state, receivedAt: new Date() };
  renderLeds();
}

function renderLeds() {
  const known = online && lastBoardState;
  for (const [id, key] of [['ledBlue', 'blue'], ['ledGreen', 'green']]) {
    const el = $(id);
    el.classList.toggle('on', Boolean(known && lastBoardState[key] === 1));
    el.classList.toggle('unknown', !known);
    el.classList.toggle('blinking', Boolean(known && lastBoardState.blinking));
    el.querySelector('.state').textContent = !known ? '未知' : (lastBoardState[key] === 1 ? '亮' : '滅');
  }
  $('ledSource').textContent = known
    ? `依據板子 ${lastBoardState.board || ''} 回報（${formatTime(lastBoardState.receivedAt)}，已執行 ${lastBoardState.count} 個指令）`
    : '無法取得板子回報，LED 實際狀態未知';
}

function setOnline(value, reason = '') {
  online = value;
  const pill = $('connection');
  pill.className = 'pill ' + (value ? 'ok' : (transport ? 'error' : ''));
  pill.textContent = value ? `已連線 · ${transport.name}` : (transport ? `通訊中斷` : '未連線');
  pill.title = reason;
  if (value) hideNotice('error');
  renderLeds();
}

let noticeKind = '';
function showNotice(message, kind) {
  noticeKind = kind;
  $('notice').className = `notice ${kind}`;
  $('notice').textContent = message;
  $('notice').hidden = false;
}

function hideNotice(kind) {
  if (!kind || noticeKind === kind) $('notice').hidden = true;
}

function addLog(source, text, cmd, result, kind) {
  const state = online && lastBoardState ? `藍${lastBoardState.blue ? '亮' : '滅'} / 綠${lastBoardState.green ? '亮' : '滅'}` : '未知';
  logRows.unshift({ time: new Date().toLocaleTimeString('zh-TW', { hour12: false }), source, text, cmd, result, kind, state });
  if (logRows.length > 200) logRows.length = 200;
  try { localStorage.setItem('voiceLedLog', JSON.stringify(logRows)); } catch { /* 無痕模式 */ }
  renderLog();
}

function renderLog() {
  $('logBody').innerHTML = logRows.map((row, i) => `
    <tr class="${row.kind}">
      <td>${logRows.length - i}</td><td>${row.time}</td><td>${escapeHtml(row.source)}</td>
      <td>${escapeHtml(row.text || '')}</td><td><code>${escapeHtml(row.cmd)}</code></td>
      <td>${escapeHtml(row.result)}</td><td>${escapeHtml(row.state)}</td>
    </tr>`).join('');
  const ok = logRows.filter((r) => r.kind === 'ok').length;
  $('logSummary').textContent = `共 ${logRows.length} 筆：成功 ${ok}、未執行 ${logRows.filter((r) => r.kind === 'skip').length}、通訊失敗 ${logRows.filter((r) => r.kind === 'error').length}`;
}

function exportCsv() {
  const header = ['#', '時間', '來源', '辨識結果', '指令', '執行結果', '板子回報狀態'];
  const lines = logRows.slice().reverse().map((r, i) =>
    [i + 1, r.time, r.source, r.text, r.cmd, r.result, r.state].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `voice-led-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

function formatTime(date) {
  return date.toLocaleTimeString('zh-TW', { hour12: false });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------- 設定保存 ----------

function loadSettings() {
  try {
    return { lang: 'zh-TW', speakBack: true, ...JSON.parse(localStorage.getItem('voiceLedSettings') || '{}') };
  } catch {
    return { lang: 'zh-TW', speakBack: true };
  }
}

function saveSettings() {
  settings.lang = $('lang').value;
  settings.speakBack = $('speakBack').checked;
  try { localStorage.setItem('voiceLedSettings', JSON.stringify(settings)); } catch { /* 無痕模式 */ }
}

function loadLog() {
  try { return JSON.parse(localStorage.getItem('voiceLedLog') || '[]'); } catch { return []; }
}

// ---------- 初始化 ----------

function init() {
  $('lang').value = settings.lang;
  $('speakBack').checked = settings.speakBack;

  $('connectBtn').addEventListener('click', () => connect());
  $('lang').addEventListener('change', saveSettings);
  $('speakBack').addEventListener('change', saveSettings);
  $('mic').addEventListener('click', () => (listening ? stopListening() : startListening()));

  document.querySelectorAll('[data-cmd]').forEach((button) => button.addEventListener('click', () => {
    const cmd = button.dataset.cmd;
    execute('按鈕', button.textContent.trim(), { cmd, label: COMMAND_LABELS[cmd] });
  }));

  $('textForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $('textInput').value;
    execute('文字', text, parseCommand(text));
    $('textInput').value = '';
  });

  $('exportBtn').addEventListener('click', exportCsv);
  $('clearBtn').addEventListener('click', () => {
    logRows.length = 0;
    try { localStorage.removeItem('voiceLedLog'); } catch { /* 無痕模式 */ }
    renderLog();
  });

  // 空白鍵 = 按下說話（輸入框內除外）
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      listening ? stopListening() : startListening();
    }
  });

  setupRecognition();
  renderLog();
  renderLeds();

  setInterval(() => { if (transport) refreshStatus(); }, POLL_INTERVAL_MS);

  if ('serial' in navigator) {
    // 之前授權過的埠不必再跳選擇視窗：重新整理頁面、或 USB 重新插上時自動連線
    navigator.serial.getPorts().then((ports) => { if (ports.length === 1) connect(ports[0]); });
    navigator.serial.addEventListener('connect', (event) => {
      if (!transport || !transport.connected) {
        showNotice('偵測到 USB 重新插上，等待開發板開機後自動連線…', 'warn');
        setTimeout(() => connect(event.target), 1500);
      }
    });
  } else {
    showNotice('此瀏覽器不支援 Web Serial，請改用 Chrome 或 Edge', 'error');
  }
}

init();
