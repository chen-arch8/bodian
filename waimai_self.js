/**
 * 外卖霸王餐 · 小蚕 + 歪麦 每日签到/任务 (Loon 自研协议版)
 * 加密引擎: CryptoJS(CDN 加载,与 Sliverkiss 同源)
 * 协议: 逆向自 2026-11-21/22 真实抓包
 */
const NAME_XC = "小蚕霸王餐";
const NAME_WM = "歪麦吧霸王餐";
const KEY_XC = "xcbwc_data";
const KEY_WM = "wmbwc_data";
const KEY_JND = "jnd674751fh6fkgu";
const KEY_SIGN_WM = "asdf545asdf4545d";
const BASE_XC = "https://gw.xiaocantech.com/rpc";
const BASE_WM_V1 = "https://wmapp-api.waimaimingtang.com";
const BASE_WM_V2 = "https://wmapp-api-v2.waimaimingtang.com";
const CJS_URL = "https://cdn.jsdelivr.net/gh/Sliverkiss/QuantumultX@main/Utils/CryptoJS.min.js";

let CryptoJS = null;

// ---------- 环境封装 ----------
const $ = {
  getdata(key) { return typeof $persistentStore !== "undefined" ? $persistentStore.read(key) : null; },
  setdata(v, k) { return typeof $persistentStore !== "undefined" ? $persistentStore.write(v, k) : false; },
  msg(title, sub, body) { if (typeof $notification !== "undefined") $notification.post(title, sub, body); },
  done(d) { if (typeof $done === "function") try { $done(d); } catch (e) {} },
};

const ARG = typeof $argument === "object" && $argument ? $argument : {};
const OPT = { debug: ARG.debug === true || ARG.debug === "true" };
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

// ---------- 加载 CryptoJS ----------
async function loadCryptoJS() {
  if (CryptoJS) return;
  const r = await request("GET", CJS_URL);
  if (r.status === 200 && r.body.length > 1000) {
    try { eval(r.body); CryptoJS = globalThis.CryptoJS || window.CryptoJS; } catch (e) {}
  }
  if (!CryptoJS) throw new Error("CryptoJS 加载失败");
}

// ---------- 小蚕协议 ----------
function xcCall(methodName, params, account) {
  const body = (typeof CryptoJS !== "undefined" && CryptoJS.enc)
    ? CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(JSON.stringify(params)))
    : btoa(unescape(encodeURIComponent(JSON.stringify(params))));
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
    try { return JSON.parse(r.body); } catch (e) { return { status: { code: -1 } }; }
  });
}

// ---------- 歪麦协议 ----------
function wmEncrypt(params, sessionKey) {
  const pt = JSON.stringify(params, undefined);
  const key = CryptoJS.enc.Utf8.parse(sessionKey);
  return CryptoJS.AES.encrypt(pt, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }).toString();
}

function wmDecrypt(b64Data, sessionKey) {
  const key = CryptoJS.enc.Utf8.parse(sessionKey);
  const dec = CryptoJS.AES.decrypt(b64Data, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 });
  return dec.toString(CryptoJS.enc.Utf8);
}

function wmSign(sessionKey) {
  const ts = String(Date.now());
  let nc = "";
  for (let i = 0; i < 16; i++) nc += Math.floor(Math.random() * 10);
  const key = CryptoJS.enc.Utf8.parse(KEY_SIGN_WM);
  const sign = CryptoJS.AES.encrypt(ts + nc, key, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }).toString();
  return { ts, nc, sign };
}

function wmV2Call(path, params, token) {
  const sessionKey = (() => { const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let s = ""; for (let i = 0; i < 32; i++) s += a[Math.floor(Math.random() * a.length)]; return s; })();
  const { ts, nc, sign } = wmSign(sessionKey);
  const body = wmEncrypt(params, sessionKey);
  const headers = {
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
  };
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

// ---------- 捕获模式 ----------
function capture() {
  const url = $request.url || "";
  const hdrs = $request.headers || {};
  const lower = {};
  for (const k in hdrs) lower[k.toLowerCase()] = hdrs[k];

  if (url.includes("gw.xiaocantech.com") && lower["x-vayne"] && lower["x-sivir"] && lower["x-teemo"]) {
    const uid = lower["x-vayne"], token = lower["x-sivir"], teemo = lower["x-teemo"];
    let accounts = [];
    try { accounts = JSON.parse($.getdata(KEY_XC) || "[]"); } catch (e) {}
    const existing = accounts.find(a => a.userId === uid);
    if (existing && existing.token === token) return $.done({});
    if (existing) { existing.token = token; existing.teemo = teemo; }
    else accounts.push({ userId: uid, teemo: teemo, token: token, userName: "账号" + (accounts.length + 1) });
    $.setdata(JSON.stringify(accounts), KEY_XC);
    $.msg(NAME_XC, `✅ ${existing ? "更新" : "获取"}凭据成功(共 ${accounts.length} 个)`, `账号 ${uid} 已保存\n失效时重新打开 App 即可自动更新`);
    return $.done({});
  }

  if (url.includes("waimaimingtang.com") && lower["token"]) {
    const token = lower["token"];
    let accounts = [];
    try { accounts = JSON.parse($.getdata(KEY_WM) || "[]"); } catch (e) {}
    const existing = accounts.find(a => a.token === token);
    if (existing) return $.done({});
    accounts.push({ userId: "user_" + Date.now(), token: token, userName: "歪麦账号" + (accounts.length + 1) });
    $.setdata(JSON.stringify(accounts), KEY_WM);
    $.msg(NAME_WM, `✅ 凭据获取成功(共 ${accounts.length} 个)`, `token 已保存\n失效时重新打开 App 即可自动更新`);
    return $.done({});
  }

  $.done({});
}

// ---------- 小蚕任务 ----------
async function runXiaocan(account, index) {
  log(`\n===== ${NAME_XC} 账号${index} =====`);
  const silkId = parseInt(account.teemo);
  const uid = account.userId;
  try {
    let r = await xcCall("ActivityTaskMobileService.OpenBox", { silk_id: silkId }, account);
    log(`  开宝箱: code=${(r.data || {}).code}`);
    await sleep(300);

    r = await xcCall("VipRightsService.SignInLottery", { silk_id: silkId, user_id: uid }, account);
    log(`  签到: ${JSON.stringify((r.data || {}).data || {}).slice(0, 80)}`);
    await sleep(300);

    r = await xcCall("ActivityTaskMobileService.CollectPoints", { silk_id: silkId, user_id: uid }, account);
    log(`  收集元宝: code=${(r.data || {}).code}`);
    await sleep(300);

    r = await xcCall("AdMobileService.GetUserInfo", { silk_id: silkId }, account);
    if (r.data && res.data.total_income !== undefined) log(`  💰 余额: ${r.data.total_income}`);
  } catch (e) { log(`  ✗ 异常: ${e}`); }
}

// ---------- 歪麦任务 ----------
async function runWaimai(account, index) {
  log(`\n===== ${NAME_WM} 账号${index} =====`);
  const token = account.token;
  try {
    let r = await wmV2Call("/api/bwc/sign-in/status", {}, token);
    const status = (r.data && r.data.data) || {};
    if (status.isSignedInToday) {
      log(`  ✓ 今日已签到(累计 ${status.cumulativeDays || 0} 天)`);
    } else {
      r = await wmV2Call("/api/bwc/sign-in/sign", {}, token);
      if (r.data && r.data.code === 200) log(`  ✓ 签到成功`);
      else log(`  ✗ 签到: ${(r.data && r.data.msg) || JSON.stringify(r.data).slice(0, 80)}`);
    }

    r = await wmV2Call("/api/bwc/sign-in/query-cumulative-rewards", {}, token);
    for (const rw of ((r.data && r.data.data) || [])) {
      if (rw.status === "RECEIVABLE") log(`  🎁 累计${rw.cumulativeDays}天奖励可领!`);
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

  if (!xcAccounts.length && !wmAccounts.length) {
    $.msg("外卖霸王餐", "❌ 未获取到凭据",
      "请分别打开小蚕霸王餐和歪麦吧 App 各刷一下\n收到 ✅ 通知后再运行本脚本");
    return false;
  }

  log("外卖霸王餐每日任务(自研版)");
  for (let i = 0; i < xcAccounts.length; i++) { if (i > 0) await sleep(800); await runXiaocan(xcAccounts[i], i + 1); }
  for (let i = 0; i < wmAccounts.length; i++) { if (i > 0) await sleep(800); await runWaimai(wmAccounts[i], i + 1); }
  log("\n全部完成。");
  return true;
}

function btoa(s) { return typeof btoa !== "undefined" ? btoa(s) : Buffer.from(s).toString("base64"); }

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
