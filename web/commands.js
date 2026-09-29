// 語音文字 → 板子指令 的解析器（純函式，無副作用，可由 test.html 驗證）
// 回傳 { cmd, label, reason }；cmd 為 null 表示「不送出任何指令、LED 狀態不變」。

const COMMAND_LABELS = {
  BLUE_ON: '左邊開燈（藍燈亮）',
  GREEN_ON: '右邊開燈（綠燈亮）',
  BLUE_OFF: '左邊關燈（藍燈滅）',
  GREEN_OFF: '右邊關燈（綠燈滅）',
  ALL_ON: '全部開燈',
  ALL_OFF: '全部關燈',
  BLINK_BLUE: '藍燈閃爍三次',
  BLINK_GREEN: '綠燈閃爍三次',
  BLINK_ALL: '兩燈閃爍三次',
};

// 語音辨識可能回傳簡體或常見同音誤字，先統一成繁體正字
const CHAR_FIXES = [
  [/开/g, '開'], [/关/g, '關'], [/边/g, '邊'], [/灯/g, '燈'], [/闪/g, '閃'],
  [/烁/g, '爍'], [/蓝/g, '藍'], [/绿/g, '綠'], [/两/g, '兩'], [/别/g, '別'],
  [/(做|佐|坐|座)邊/g, '左邊'],     // 「左邊」常被聽成「做邊」
  [/(又|有|幼)邊/g, '右邊'],        // 「右邊」常被聽成「又邊」「有邊」
  [/左編/g, '左邊'], [/右編/g, '右邊'],
  [/開等|開登|開瞪/g, '開燈'], [/關等|關登/g, '關燈'],
];

const NEGATION = /(不要|不用|別|不必|先不|don'?t|do not|never)/;

function normalize(text) {
  let zh = String(text || '').toLowerCase().replace(/[\s,，。.!！?？、:：;；"'「」]/g, '');
  for (const [pattern, replacement] of CHAR_FIXES) zh = zh.replace(pattern, replacement);
  const en = String(text || '').toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
  return { zh, en };
}

function parseCommand(text) {
  const { zh, en } = normalize(text);
  if (!zh && !en) return { cmd: null, reason: '沒有辨識到內容' };

  if (NEGATION.test(zh) || NEGATION.test(en)) {
    return { cmd: null, reason: '含否定語氣，不執行' };
  }

  const left = /左|藍/.test(zh) || /\b(left|blue)\b/.test(en);
  const right = /右|綠/.test(zh) || /\b(right|green)\b/.test(en);
  const both = /全部|所有|兩個|兩邊|兩盞|都/.test(zh) || /\b(all|both|every)\b/.test(en) || (left && right);

  // 英文用完整單字比對：避免 flashlight 被當成 flash（實測發現的誤判）
  const blink = /閃/.test(zh) || /\b(blink|blinks|blinking|flash|flashes|flashing)\b/.test(en);
  const off = /關|熄|滅/.test(zh) || /\boff\b/.test(en);
  const on = /開|亮|點燈/.test(zh) || /\b(on|light up)\b/.test(en);

  let side = null;
  if (both) side = 'ALL';
  else if (left) side = 'BLUE';
  else if (right) side = 'GREEN';

  let action = null;
  if (blink) action = 'BLINK';
  else if (off && !on) action = 'OFF';
  else if (on && !off) action = 'ON';

  if (!action) {
    if (on && off) return { cmd: null, reason: '同時包含「開」與「關」，指令不明確' };
    return { cmd: null, reason: side ? '有提到燈的位置，但沒有動作（開 / 關 / 閃爍）' : '非控制指令' };
  }

  // 沒指定左右時：關燈、閃爍可視為全部；開燈必須指定左右，避免誤開
  if (!side) {
    if (action === 'ON') return { cmd: null, reason: '請說明要開左邊（藍）還是右邊（綠）' };
    side = 'ALL';
  }

  const cmd = action === 'BLINK' ? `BLINK_${side}` : `${side}_${action}`;
  return { cmd, label: COMMAND_LABELS[cmd], reason: '符合控制指令' };
}

// 只採用辨識信心最高的第一候選。曾經嘗試「第一候選看不懂就改用其他候選」，
// 實測時「turn on the light light」因此被改用 right light 而開錯燈，所以不再這樣做。
function parseAlternatives(alternatives) {
  return { ...parseCommand(alternatives[0] || ''), text: alternatives[0] || '' };
}

// 解析器測試案例：[輸入, 預期指令(null 代表不應改變 LED)]
const PARSER_CASES = [
  ['左邊開燈', 'BLUE_ON'],
  ['右邊開燈', 'GREEN_ON'],
  ['左邊開燈。', 'BLUE_ON'],
  ['左边开灯', 'BLUE_ON'],
  ['做邊開燈', 'BLUE_ON'],
  ['又邊開燈', 'GREEN_ON'],
  ['打開藍燈', 'BLUE_ON'],
  ['綠燈亮', 'GREEN_ON'],
  ['左邊關燈', 'BLUE_OFF'],
  ['右邊關燈', 'GREEN_OFF'],
  ['關燈', 'ALL_OFF'],
  ['全部關掉', 'ALL_OFF'],
  ['全部開燈', 'ALL_ON'],
  ['閃爍三次', 'BLINK_ALL'],
  ['左邊閃爍三次', 'BLINK_BLUE'],
  ['右邊的燈閃三下', 'BLINK_GREEN'],
  ['turn on the left light', 'BLUE_ON'],
  ['Turn on the right light', 'GREEN_ON'],
  ['turn off the blue LED', 'BLUE_OFF'],
  ['turn off all lights', 'ALL_OFF'],
  ['blink three times', 'BLINK_ALL'],
  ['turn off the light', 'ALL_OFF'],
  ['turn on the flashlight', null],    // 實測紀錄 #7：原本被誤判為閃爍
  ['turn on the light light', null],   // 實測紀錄 #8：沒有指定左右，不可開燈
  ['今天天氣很好', null],
  ['你好', null],
  ['開燈', null],
  ['我在左邊', null],
  ['不要開左邊的燈', null],
  ["don't turn on the light", null],
  ['hello world', null],
  ['左邊開燈右邊關燈', null],
  ['', null],
];

if (typeof module !== 'undefined') {
  module.exports = { parseCommand, parseAlternatives, normalize, PARSER_CASES, COMMAND_LABELS };
}
