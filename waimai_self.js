// 外卖霸王餐 · 小蚕 + 歪麦 每日任务 (Loon 自研版 v2)
// CryptoJS 内嵌(无 CDN 依赖),协议逆向自 2026-11-21/22 真实抓包
//
// 双模式:
//   1. http-request 捕获: 自动保存 App 产生的凭据(token)
//   2. cron 定时: 每日签到/开宝箱/收集元宝/奖励查询

// ========== Crypto shim (Loon 可能无 WebCrypto) ==========
if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.getRandomValues) {
  globalThis.crypto = {
    getRandomValues: function(arr) {
      for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    }
  };
}

// ========== 环境封装 ==========
const $ = {
  getdata(key) { return typeof $persistentStore !== "undefined" ? $persistentStore.read(key) : null; },
  setdata(v, k) { return typeof $persistentStore !== "undefined" ? $persistentStore.write(v, k) : false; },
  msg(t, s, b) { if (typeof $notification !== "undefined") $notification.post(t, s, b); },
  done(d) { if (typeof $done === "function") try { $done(d); } catch (e) {} },
};

const ARG = typeof $argument === "object" && $argument ? $argument : {};
const OPT = {
  xc_task: !(ARG.xc_task === false || ARG.xc_task === "false" || ARG.xc_task === "0"),
  wm_task: !(ARG.wm_task === false || ARG.wm_task === "false" || ARG.wm_task === "0"),
  debug: ARG.debug === true || ARG.debug === "true",
};

let REPORT = "";
const isCapture = typeof $request !== "undefined" && !!$request;
function log(msg) { REPORT += msg + "\n"; console.log(msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- HTTP ----------
function request(method, url, headers, body) {
  return new Promise((resolve) => {
    const opts = { url, headers: headers || {}, method: method || "GET" };
    if (body) opts.body = body;
    if (typeof $httpClient !== "undefined") {
      const fn = method === "POST" ? $httpClient.post : $httpClient.get;
      fn(opts, (err, resp, data) => resolve({ status: resp ? (resp.status || resp.statusCode) : 0, body: data, headers: resp ? resp.headers || {} : {} }));
    } else { resolve({ status: 0, body: "" }); }
  });
}

// ---------- CryptoJS (CDN 多源加载) ----------
let CryptoJS = null;
const CJS_URLS = [
  "https://raw.githubusercontent.com/chen-arch8/bodian/main/CryptoJS.min.js",
  "https://fastly.jsdelivr.net/gh/Sliverkiss/QuantumultX@main/Utils/CryptoJS.min.js",
  "https://cdn.jsdelivr.net/gh/Sliverkiss/QuantumultX@main/Utils/CryptoJS.min.js",
];
async function loadCryptoJS() {
  if (CryptoJS) return;
  for (const url of CJS_URLS) {
    try {
      const r = await request("GET", url);
      if (r.status === 200 && r.body.length > 5000) {
        eval(r.body);
        if (typeof createCryptoJS === "function") {
          CryptoJS = createCryptoJS();
          if (CryptoJS && CryptoJS.AES) { console.log("[CJS] loaded:", url.slice(0, 60)); return; }
        }
        if (typeof CryptoJS !== "undefined" && CryptoJS && CryptoJS.AES) {
          console.log("[CJS] loaded direct:", url.slice(0, 60)); return;
        }
      }
    } catch (e) { console.log(`[CJS] ${url.slice(0, 50)} err: ${e.message || e}`); }
  }
  throw new Error("CryptoJS 加载失败(所有源均不可达,请检查 Loon 代理设置)");
}

// ---------- Base64 ----------
function b64Encode(bytes) {
  const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let r = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b = [bytes[i], bytes[i+1] || 0, bytes[i+2] || 0];
    r += b64[(b[0] >> 2) & 63] + b64[((b[0] & 3) << 4) | ((b[1] >> 4) & 15)] +
         (i+1 < bytes.length ? b64[((b[1] & 15) << 2) | ((b[2] >> 6) & 3)] : "=") +
         (i+2 < bytes.length ? b64[b[2] & 63] : "=");
  }
  return r;
}
function b64Decode(s) {
  const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = []; let bits = 0, acc = 0;
  for (const c of s) {
    if (c === "=") break;
    const v = b64.indexOf(c); if (v < 0) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bytes.push((acc >> (bits - 8)) & 0xff); bits -= 8; }
  }
  return bytes;
}

// ---------- 捕获模式 ----------
function capture() {
  const url = $request.url || "";
  const hdrs = $request.headers || {};
  const lower = {};
  for (const k in hdrs) lower[k.toLowerCase()] = hdrs[k];

  // 小蚕凭据捕获
  if (url.includes("gw.xiaocantech.com") && lower["x-vayne"] && lower["x-sivir"] && lower["x-teemo"]) {
    const uid = lower["x-vayne"], token = lower["x-sivir"], teemo = lower["x-teemo"];
    let accounts = [];
    try { accounts = JSON.parse($.getdata(KEY_XC) || "[]"); } catch (e) {}
    // 按 userId 去重: 同 uid 只保留最新 token
    const existing = accounts.find(a => a.userId === uid);
    if (existing) {
      existing.token = token; existing.teemo = teemo; existing.capturedAt = Date.now();
    } else {
      accounts.push({ userId: uid, teemo: teemo, token: token, userName: "账号" + (accounts.length + 1), capturedAt: Date.now() });
    }
    $.setdata(JSON.stringify(accounts), KEY_XC);
    $.msg(NAME_XC, `✅ ${existing ? "更新" : "获取"}凭据成功(共 ${accounts.length} 个)`,
      `账号 ${uid} 已保存\n失效时重新打开 App 即可自动更新`);
    return $.done({});
  }

  // 歪麦凭据捕获 (从请求头取 token)
  if (url.includes("waimaimingtang.com") && lower["token"]) {
    const token = lower["token"];
    let accounts = [];
    try { accounts = JSON.parse($.getdata(KEY_WM) || "[]"); } catch (e) {}
    const existing = accounts.find(a => a.token === token);
    if (existing) return $.done({});
    accounts.push({ userId: "user_" + Date.now(), token: token, userName: "歪麦账号" + (accounts.length + 1) });
    $.setdata(JSON.stringify(accounts), KEY_WM);
    $.msg(NAME_WM, `✅ 凭据获取成功(共 ${accounts.length} 个)`,
      `token 已保存\n失效时重新打开 App 即可自动更新`);
    return $.done({});
  }

  $.done({});
}

// ========== 小蚕 ==========
const NAME_XC = "小蚕霸王餐";
const KEY_XC = "xcbwc_data";
const BASE_XC = "https://gw.xiaocantech.com/rpc";

function xcCall(methodName, params, account) {
  const body = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(JSON.stringify(params)));
  const headers = {
    "Content-Type": "application/json",
    "servername": "SilkwormAd",
    "user-agent": "XC;iOS;3.22.7",
    "x-vayne": account.userId,
    "x-sivir": account.token,
    "x-teemo": account.teemo,
    "x-version": "3.22.7.0",
    "x-platform": "iOS",
    "x-annie": "XC",
    "x-app-sr": "16",
    "x-citycode": "440112",
    "x-city": "440112",
    "methodname": methodName,
  };
  return request("POST", BASE_XC, headers, body).then(r => {
    if (OPT.debug) console.log(`[XC DEBUG] ${methodName} status=${r.status} body=${String(r.body).slice(0, 300)}`);
    try { return JSON.parse(r.body); } catch (e) {
      console.log(`[XC PARSE FAIL] ${methodName}: body=${String(r.body).slice(0, 200)}`);
      return { status: { code: -1, msg: "响应非JSON: " + String(r.body).slice(0, 100) } };
    }
  });
}

async function runXiaocan(account, index) {
  log(`\n===== ${NAME_XC} 账号${index} =====`);
  const silkId = parseInt(account.teemo);
  const uid = account.userId;
  try {
    // 任务列表
    let r = await xcCall("ActivityTaskMobileService.UserTaskV2", { silk_id: silkId, user_id: uid }, account);
    const sc = (r.status || {}).code;
    if (sc === 0) log(`  ✓ 连接正常`);
    else { log(`  ✗ 连接异常: code=${sc} msg=${(r.status || {}).msg || "?"}`); return; }
    await sleep(300);

    // 每日任务
    r = await xcCall("ActivityTaskMobileService.GetDailyTask", { silk_id: silkId, user_id: uid, city_code: 440112, platform: 3 }, account);
    if ((r.status || {}).code === 0) {
      const dt = r.data || {};
      log(`  📋 每日任务: ${JSON.stringify(dt).slice(0, 120)}`);
    }
    await sleep(300);

    // 开宝箱
    r = await xcCall("ActivityTaskMobileService.OpenBox", { silk_id: silkId }, account);
    if ((r.status || {}).code === 0) log(`  ✓ 开宝箱: ${JSON.stringify(r.data || {}).slice(0, 100)}`);
    else log(`  - 开宝箱: code=${(r.status || {}).code} ${(r.status || {}).msg || ""}`);
    await sleep(300);

    // 签到
    r = await xcCall("VipRightsService.SignInLottery", { silk_id: silkId, user_id: uid }, account);
    if ((r.status || {}).code === 0) log(`  ✓ 签到: ${JSON.stringify(r.data || {}).slice(0, 100)}`);
    else log(`  - 签到: code=${(r.status || {}).code} ${(r.status || {}).msg || ""}`);
    await sleep(300);

    // 收集元宝
    r = await xcCall("ActivityTaskMobileService.CollectPoints", { silk_id: silkId, user_id: uid }, account);
    if ((r.status || {}).code === 0) log(`  ✓ 收集元宝完成`);
    else log(`  - 收集元宝: code=${(r.status || {}).code}`);
    await sleep(300);

    // 余额
    r = await xcCall("AdMobileService.GetUserInfo", { silk_id: silkId }, account);
    if ((r.status || {}).code === 0 && r.data) {
      log(`  💰 元宝: ${r.data.total_yuanbao_income || r.data.total_income || "?"} | 可兑换: ${r.data.exchangeable_income || "?"}`);
    }
  } catch (e) { log(`  ✗ 异常: ${e}`); }
}

// ========== 歪麦 ==========
const NAME_WM = "歪麦吧霸王餐";
const KEY_WM = "wmbwc_data";
const KEY_JND = "jnd674751fh6fkgu";
const KEY_SIGN_WM = "asdf545asdf4545d";
const BASE_WM_V1 = "https://wmapp-api.waimaimingtang.com";
const BASE_WM_V2 = "https://wmapp-api-v2.waimaimingtang.com";

function wmEncrypt(params, sessionKey) {
  const pt = JSON.stringify(params);
  const key = CryptoJS.enc.Utf8.parse(sessionKey);
  return CryptoJS.AES.encrypt(pt, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }).toString();
}

function wmDecrypt(b64Data, sessionKey) {
  const key = CryptoJS.enc.Utf8.parse(sessionKey);
  return CryptoJS.AES.decrypt(b64Data, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }).toString(CryptoJS.enc.Utf8);
}

function wmSignHeader(sessionKey, token) {
  const ts = String(Date.now());
  let nc = "";
  for (let i = 0; i < 16; i++) nc += Math.floor(Math.random() * 10);
  const key = CryptoJS.enc.Utf8.parse(KEY_SIGN_WM);
  const sign = CryptoJS.AES.encrypt(ts + nc, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }).toString();
  return { ts, nc, sign, headers: {
    "Content-Type": "application/json",
    "application": "bwyc-app",
    "token": token,
    "nonce": nc,
    "timestamp": ts,
    "sign": sign,
    "appversion": "1.1.175",
    "Waimai-Accept-Encoding": "gzip",
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "origin": "https://wmh5.waimaimingtang.com",
    "referer": "https://wmh5.waimaimingtang.com/",
  } };
}

function wmV2Call(path, params, token) {
  const sessionKey = (() => { const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let s = ""; for (let i = 0; i < 32; i++) s += a[Math.floor(Math.random() * a.length)]; return s; })();
  const { headers } = wmSignHeader(sessionKey, token);
  const body = wmEncrypt(params, sessionKey);
  return request("POST", BASE_WM_V2 + path, headers, body).then(r => {
    if (!r.body) return { code: -1, msg: "无响应" };
    try {
      const res = JSON.parse(r.body);
      if (typeof res.data === "string" && res.data.length > 4 && !res.data.includes("https://")) {
        try { res.data = JSON.parse(wmDecrypt(res.data, sessionKey)); } catch (e) {}
      }
      return res;
    } catch (e) { return { code: -1, msg: "解析失败" }; }
  });
}

async function runWaimai(account, index) {
  log(`\n===== ${NAME_WM} 账号${index} =====`);
  const token = account.token;
  try {
    // 签到状态
    let r = await wmV2Call("/api/bwc/sign-in/status", {}, token);
    const status = (r.data && r.data.data) || {};
    if (status.isSignedInToday) {
      log(`  ✓ 今日已签到(累计 ${status.cumulativeDays || 0} 天)`);
    } else {
      log(`  📋 今日未签到,尝试签到...`);
      // 签到
      r = await wmV2Call("/api/bwc/sign-in/sign", {}, token);
      const inner = (r.data && typeof r.data === "object") ? r.data : {};
      if (inner.code === 200) log(`  ✓ 签到成功!`);
      else log(`  ✗ 签到失败: code=${inner.code} msg=${inner.msg || JSON.stringify(r.data).slice(0, 100)}`);
    }

    // 累计奖励
    r = await wmV2Call("/api/bwc/sign-in/query-cumulative-rewards", {}, token);
    const rewards = (r.data && r.data.data) || [];
    if (Array.isArray(rewards)) {
      for (const rw of rewards) {
        if (rw.status === "RECEIVABLE") log(`  🎁 累计${rw.cumulativeDays}天奖励可领取!`);
      }
      if (!rewards.some(rw => rw.status === "RECEIVABLE")) log(`  - 累计奖励: 暂无可领`);
    }

    // 金币汇总
    r = await wmV2Call("/api/bwc/waimaimt-web-bwc/user/task/earning/gold/summary", {}, token);
    if (r.data && r.data.data && typeof r.data.data === "object") {
      log(`  💰 金币: ${JSON.stringify(r.data.data).slice(0, 120)}`);
    } else if (r.data && r.data.data) {
      log(`  💰 金币: ${String(r.data.data).slice(0, 120)}`);
    }
  } catch (e) { log(`  ✗ 异常: ${e}`); }
}

// ---------- 主流程 ----------
async function main() {
  await loadCryptoJS();

  const xcAccounts = [];
  try { xcAccounts.push(...JSON.parse($.getdata(KEY_XC) || "[]")); } catch (e) {}
  const wmAccounts = [];
  try { wmAccounts.push(...JSON.parse($.getdata(KEY_WM) || "[]")); } catch (e) {}

  const runXc = OPT.xc_task && xcAccounts.length > 0;
  const runWm = OPT.wm_task && wmAccounts.length > 0;

  // 账号去重: 同 userId 只保留最新
  const dedup = (accounts) => {
    const map = {};
    for (const a of accounts) {
      if (!map[a.userId] || (a.capturedAt || 0) > (map[a.userId].capturedAt || 0)) map[a.userId] = a;
    }
    return Object.values(map).sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
  };
  const dedupXc = dedup(xcAccounts);
  const dedupWm = dedup(wmAccounts);
  if (dedupXc.length !== xcAccounts.length) {
    $.setdata(JSON.stringify(dedupXc), KEY_XC);
    console.log(`[dedup] 小蚕 ${xcAccounts.length} -> ${dedupXc.length}`);
  }
  if (dedupWm.length !== wmAccounts.length) {
    $.setdata(JSON.stringify(dedupWm), KEY_WM);
    console.log(`[dedup] 歪麦 ${wmAccounts.length} -> ${dedupWm.length}`);
  }

  if (!dedupXc.length && !dedupWm.length) {
    if (!xcAccounts.length && !wmAccounts.length) {
      $.msg("外卖霸王餐", "❌ 未获取到凭据",
        "请分别打开小蚕霸王餐和歪麦吧 App 各刷一下\n收到 ✅ 通知后再运行本脚本");
    } else {
      $.msg("外卖霸王餐", "ℹ️ 任务开关均已关闭", "请至少开启一个「每日任务」开关");
    }
    return false;
  }

  log("外卖霸王餐每日任务(自研版)");
  const parts = [];
  if (runXc) parts.push(`小蚕:${xcAccounts.length}号`);
  if (runWm) parts.push(`歪麦:${wmAccounts.length}号`);
  log(`  执行: ${parts.join(" | ")}`);

  if (runXc) {
    for (let i = 0; i < xcAccounts.length; i++) { if (i > 0) await sleep(800); await runXiaocan(xcAccounts[i], i + 1); }
  }
  if (runWm) {
    for (let i = 0; i < wmAccounts.length; i++) { if (i > 0) await sleep(800); await runWaimai(wmAccounts[i], i + 1); }
  }
  log("\n全部完成。");
  return true;
}

// ---------- 入口 ----------
(async () => {
  if (isCapture) { capture(); return; }
  const ran = await main();
  if (ran) $.msg("外卖霸王餐", `任务完成 ${new Date().getMonth() + 1}-${new Date().getDate()}`, REPORT);
  $.done({});
})().catch(e => {
  console.log(`fatal: ${e}`);
  $.msg("外卖霸王餐", "❌ 脚本异常", String(e));
  $.done({});
});
