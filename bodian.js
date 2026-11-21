/**
 * 波点音乐 每日任务(Loon 脚本)
 *
 * 双模式入口:
 *   1. http-request 抓包模式( $request 存在):拦截 bd-api.kuwo.cn 赚钱页请求,
 *      自动提取 uid / token / payload 三个凭据并持久化,失效后重开赚钱页即可自动更新
 *      (是否拦截由插件「抓取凭据」开关通过 enable=${capture} 在规则层控制)
 *   2. cron 定时模式(手动运行:在 Loon 脚本页右上角 ▶ 即可):执行每日任务
 *      每日签到 + 听歌奖励 + 惊喜宝箱 + 免费抽奖 + 吃饭领金币
 *
 * 持久化键: bodian_accounts  ->  JSON { "<uid>": {uid, token, payload, updatedAt} }
 */

const NAME = "波点音乐";
const STORE_KEY = "bodian_accounts";
const API = "https://bd-api.kuwo.cn/api/advert/earning";
const UA = "CFNetwork/1.0 Darwin/27.2.0 (iPhone iOS/27.2.1) BoDianMusic";
// doTask 请求体里的 kwflag:服务端实测不校验,运行时随机生成 32 位 hex,
// 不在脚本里嵌入任何抓包得到的设备指纹
const KWFLAG_PREFIX = (() => {
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
})();

// ---------------- Loon 环境封装 ----------------
const $ = {
  getdata(key) {
    return typeof $persistentStore !== "undefined" ? $persistentStore.read(key) : null;
  },
  setdata(val, key) {
    return typeof $persistentStore !== "undefined" ? $persistentStore.write(val, key) : false;
  },
  msg(title, subtitle, body) {
    if (typeof $notification !== "undefined") $notification.post(title, subtitle, body);
  },
  done(data) {
    // Loon 3.5.3 新语法引擎对 $done() 空参会在内部抛 TypeError('e.body'),
    // 所以任何场景都传对象;引擎在 done 后处理阶段抛出的异常直接吞掉
    if (typeof $done !== "function") return;
    try { $done(data === undefined ? {} : data); }
    catch (e) { console.log(`done: ${e}`); }
  },
};

const ARG = typeof $argument === "object" && $argument ? $argument : {};
const argOn = (name, dft) => {
  const v = ARG[name];
  if (v === undefined || v === null || v === "") return dft;
  return v === true || v === "true" || v === "1" || v === 1;
};
const OPT = {
  lottery: argOn("lottery", true),          // 免费抽奖
  dine: argOn("dine", true),                // 吃饭领金币
  boxTimes: Math.max(1, Math.min(5, parseInt(ARG.box_times, 10) || 3)),
  debug: argOn("debug", false),
  clear: argOn("clear", false),             // 清除已存凭据
};

const isCapture = typeof $request !== "undefined" && !!$request &&
  /bd-api\.kuwo\.cn\/api\/advert\/earning/i.test($request.url || "");

let REPORT = "";

function log(line) {
  REPORT += line + "\n";
  console.log(line);
}
function debugLog(label, data) {
  if (OPT.debug) console.log(`[debug] ${label}: ${typeof data === "string" ? data.slice(0, 800) : JSON.stringify(data)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- HTTP ----------------
function request(method, options) {
  return new Promise((resolve) => {
    const cb = (error, response, data) => {
      const status = (response && (response.status || response.statusCode)) || 0;
      resolve({ error, status, body: data });
    };
    if (method === "POST") $httpClient.post(options, cb);
    else $httpClient.get(options, cb);
  });
}

function baseHeaders(payload) {
  const h = {
    "content-type": "application/json",
    origin: "https://h5app.kuwo.cn",
    referer: "https://h5app.kuwo.cn/",
    "user-agent": UA,
  };
  if (payload) h.payload = payload;
  return h;
}

function parseJSON(text) {
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch (e) { return null; }
}

class BodianClient {
  constructor(acc) {
    this.uid = acc.uid;
    this.token = acc.token;
    this.payload = acc.payload || "";
  }
  _qs(extra) {
    const ms = Date.now();
    let qs = `uid=${this.uid}&token=${this.token}&timestamp=${ms}`;
    if (extra) qs += "&" + extra;
    return qs;
  }
  async get(path, extra) {
    const url = `${API}/${path}?${this._qs(extra)}`;
    const res = await request("GET", { url, headers: baseHeaders(this.payload) });
    if (OPT.debug) console.log(`[debug] GET ${path} -> ${String(res.body).slice(0, 600)}`);
    return res;
  }
  async doTask(bodyExtra) {
    const ms = Date.now();
    const body = Object.assign({
      kwflag: KWFLAG_PREFIX + ms,
      uid: parseInt(this.uid, 10),
      platform: "ip",
      _t: ms,
      isTest: false,
      rewardType: 0,
    }, bodyExtra);
    const url = `${API}/h5/doTask?${this._qs()}`;
    const res = await request("POST", { url, headers: baseHeaders(this.payload), body: JSON.stringify(body) });
    if (OPT.debug) console.log(`[debug] POST ${JSON.stringify(bodyExtra)} -> ${String(res.body).slice(0, 600)}`);
    return res;
  }
}

// ---------------- 抓包模式 ----------------
// 注意: http-request 脚本里 $done() 空参 = 放弃请求(连接断开,App 页面会空白)!
// 必须用 $done({}) 让请求原样透传。
function capture() {
  try {
    if ($request.method === "OPTIONS") return $.done({});
    const url = $request.url || "";
    const uid = (url.match(/[?&]uid=(\d+)/) || [])[1];
    const token = (url.match(/[?&]token=([0-9a-fA-F]{16,32})(?:&|$)/) || [])[1];
    if (!uid || !token) return $.done({});
    const hdrs = $request.headers || {};
    const payload = hdrs["payload"] || hdrs["Payload"] || hdrs["PAYLOAD"] || "";
    let accounts = {};
    try { accounts = JSON.parse($.getdata(STORE_KEY) || "{}") || {}; } catch (e) {}
    const old = accounts[uid];
    if (old && old.token === token && old.payload === payload) {
      return $.done({}); // 凭据没变,静默放行,不弹通知
    }
    const existed = !!old;
    accounts[uid] = { uid, token, payload, updatedAt: new Date().toISOString() };
    $.setdata(JSON.stringify(accounts), STORE_KEY);
    const n = Object.keys(accounts).length;
    const tip = payload
      ? ""
      : "\n⚠️ 本次请求未携带 payload 头,请在赚钱页内继续点一点再试";
    $.msg(NAME,
      `✅ ${existed ? "更新" : "获取"}凭据成功(共 ${n} 个账号)`,
      `账号 ${uid} 已保存${tip}\n失效时重新打开赚钱页即可自动更新`);
    debugLog("capture", accounts[uid]);
  } catch (e) {
    console.log(`capture error: ${e}`);
  }
  $.done({});
}

// ---------------- 任务 ----------------
async function doSign(cli) {
  const res = parseJSON((await cli.get("h5/task/info", "taskType=sign")).body);
  if (!res || res.code !== 200) { log(`  ✗ 获取签到信息失败: ${(res && res.msg) || "网络错误"}`); return; }
  const d = res.data || {};
  if (d.todaySign) { log(`  ✓ 今日已签到,连续 ${d.conDay != null ? d.conDay : "?"} 天`); return; }
  const list = d.list || [];
  let target = list.find((x) => x.stage === d.todayOfCycle && x.status === 2) ||
               list.find((x) => x.status === 2);
  if (!target) { log("  ! 未找到可签到的卡片"); return; }
  const res2 = parseJSON((await cli.doTask({
    isExt: false, taskType: "sign", token: "", mergedAward: false, id: target.id,
  })).body);
  if (res2 && res2.code === 200) {
    const d2 = res2.data || {};
    const hit = (d2.list || []).find((x) => x.status === 4);
    log(`  ✓ 签到成功 +${hit ? hit.gold : 0} 金币,连续签到 ${d2.conDay != null ? d2.conDay : "?"} 天`);
  } else {
    log(`  ✗ 签到失败: ${(res2 && res2.msg) || "网络错误"}`);
  }
}

async function doListen(cli) {
  /* 听歌赚金币: task/info?taskType=listen 里 status 3=已达标可领, 2=未达标, 1=已领;
     领取就是 doTask {taskType:"listen", id:<档位id>},听歌时长本身要靠 App 真实听歌累计 */
  const res = parseJSON((await cli.get("h5/task/info", "taskType=listen")).body);
  if (!res || res.code !== 200) {
    log(`  ✗ 获取听歌任务失败: ${(res && res.msg) || "网络错误"}`);
    return;
  }
  const d = res.data || {};
  const claimable = (d.list || []).filter((x) => x.status === 3);
  if (!claimable.length) {
    log(`  - 暂无可领听歌奖励(今日已听 ${d.listenTime != null ? d.listenTime : "?"} 分钟)`);
    return;
  }
  for (const it of claimable) {
    const r = parseJSON((await cli.doTask({
      taskType: "listen", id: it.id, token: "", isExt: false,
    })).body);
    if (r && r.code === 200) {
      log(`  ✓ 听歌${it.stage}分钟奖励 +${((r.data || {}).gold) || 0} 金币`);
    } else {
      log(`  ✗ 听歌${it.stage}分钟奖励领取失败: ${(r && r.msg) || "网络错误"}`);
    }
    await sleep(1500);
  }
}

async function doFloatBox(cli, maxTimes) {
  let got = 0, opened = 0;
  for (let i = 0; i < maxTimes; i++) {
    if (i > 0) await sleep(3000);
    const res = parseJSON((await cli.doTask({ taskType: "floatBox", id: 0 })).body);
    if (!res || res.code !== 200) {
      log(`  - 宝箱暂不可开: ${(res && res.msg) || "网络错误"}(冷却中,下次运行再试)`);
      break;
    }
    const d = res.data || {};
    got += d.gold || 0; opened += 1;
    log(`  ✓ 开宝箱 +${d.gold || 0} 金币(${d.title || "惊喜宝箱"})`);
    if (!d.hasMoreExtTaskPopup) break;
  }
  if (!opened) log("  - 本次未开出宝箱");
}

async function doLottery(cli) {
  const res = parseJSON((await cli.get("h5/task/info", "taskType=dailyLottery")).body);
  if (!res || res.code !== 200) { log(`  ✗ 获取抽奖信息失败: ${(res && res.msg) || "网络错误"}`); return; }
  const remain = parseInt((res.data || {}).ulotterynums, 10) || 0;
  if (!remain) { log("  - 今日免费抽奖次数已用完"); return; }
  for (let i = 0; i < Math.min(remain, 10); i++) {
    const res2 = parseJSON((await cli.doTask({
      taskType: "dailyLottery", id: 0, type: "free", token: "", isExt: false,
    })).body);
    if (!res2 || res2.code !== 200) {
      const msg = (res2 && res2.msg) || "网络错误";
      log(/广告/.test(msg) ? "  - 免费抽奖次数已用完(剩余需看广告,跳过)" : `  - 抽奖结束: ${msg}`);
      break;
    }
    const d = res2.data || {};
    if (!d.name) { log(`  - 抽奖无结果(可能需看广告): code=${d.code}`); break; }
    log(`  ✓ 抽奖获得 ${d.name}`);
    if ((parseInt(d.ulotterynums, 10) || 0) <= 0) break;
    await sleep(1500);
  }
}

async function doDine(cli) {
  const res = parseJSON((await cli.get("h5/task/info", "taskType=dineEarnMoney")).body);
  if (!res || res.code !== 200) { log(`  ✗ 获取吃饭任务失败: ${(res && res.msg) || "网络错误"}`); return; }
  const data = res.data || {};
  // status: 3=当前饭点可领, 2=未到饭点, 5=错过需看广告补领, 4=已领
  const meals = (data.list || []).filter((m) => m.subTaskType === "dineCheckIn" && m.status === 3);
  if (!meals.length) log(`  - 当前无可用饭点(当前时段: ${data.currentMealName || "?"})`);
  for (const m of meals) {
    const r = parseJSON((await cli.doTask({
      taskType: "dineEarnMoney", subTaskType: "dineCheckIn", id: m.id,
    })).body);
    if (r && r.code === 200) {
      const d = r.data || {};
      log(`  ✓ ${d.mealName || m.mealName}打卡 +${d.gold || 0} 金币`);
    } else {
      log(`  ✗ ${m.mealName}打卡失败: ${(r && r.msg) || "网络错误"}`);
    }
    await sleep(1500);
  }
  const curDay = data.currentCycleDay;
  const con = (data.conRewardTaskItems || []).find((c) => c.status === 2 && c.id === curDay);
  if (con) {
    const r = parseJSON((await cli.doTask({
      taskType: "dineEarnMoney", subTaskType: "conDine", id: con.id,
    })).body);
    if (r && r.code === 200) log(`  ✓ 连续吃饭奖励 +${((r.data || {}).gold) || 0} 金币`);
    else log(`  - 连吃奖励不可领: ${(r && r.msg) || "网络错误"}`);
  }
}

// ---------------- 主流程 ----------------
function loadAccounts() {
  let accounts = {};
  try { accounts = JSON.parse($.getdata(STORE_KEY) || "{}") || {}; } catch (e) {}
  return Object.keys(accounts)
    .map((k) => accounts[k])
    .filter((a) => a && a.uid && a.token)
    .sort((a, b) => String(a.uid).localeCompare(String(b.uid)));
}

async function runAccount(acc, index) {
  log(`===== 账号${index} uid=${acc.uid} =====`);
  const cli = new BodianClient(acc);
  try {
    const home = parseJSON((await cli.get("h5/home", "refresh=0")).body);
    if (home && home.code === 200) {
      log(`  用户: ${((home.data || {}).userInfo || {}).nickname || "?"}`);
    }
        await doSign(cli);
        await sleep(1500);
        await doListen(cli);
        await sleep(1500);
        await doFloatBox(cli, OPT.boxTimes);
    if (OPT.lottery) { await sleep(1500); await doLottery(cli); }
    if (OPT.dine) { await sleep(1500); await doDine(cli); }
    const home2 = parseJSON((await cli.get("h5/home", "refresh=0")).body);
    const balance = home2 && home2.code === 200
      ? ((home2.data || {}).userInfo || {}).balance : null;
    if (balance != null) log(`  当前金币余额: ${balance}`);
  } catch (e) {
    log(`  ✗ 异常: ${e}`);
  }
}

async function main() {
  const accounts = loadAccounts();
  if (OPT.clear) {
    $.setdata("{}", STORE_KEY);
    $.msg(NAME, "🧹 已清除所有已存凭据", "重新打开波点音乐赚钱页可再次获取");
    return false;
  }
  if (!accounts.length) {
    $.msg(NAME, "❌ 未获取到凭据",
      "请先在波点音乐App内打开「赚钱(金币)」页面\n需开启 MITM 与本插件的抓包规则,收到「✅ 获取凭据成功」后再运行");
    return false;
  }
  log(`波点音乐每日任务 | ${accounts.length} 个账号 | ` +
      `抽奖:${OPT.lottery ? "开" : "关"} 吃饭:${OPT.dine ? "开" : "关"} 宝箱尝试:${OPT.boxTimes}次`);
  for (let i = 0; i < accounts.length; i++) {
    if (i > 0) await sleep(1500);
    await runAccount(accounts[i], i + 1);
  }
  log("全部账号处理完毕。");
  return true;
}

(async () => {
  if (isCapture) {
    capture(); // 内部已调 $.done({})
    return;
  }
  const ran = await main();
  if (ran) {
    // cron 模式: 通知汇总
    $.msg(NAME, `任务完成 ${new Date().getMonth() + 1}-${new Date().getDate()}`, REPORT);
  }
  $.done({});
})().catch((e) => {
  console.log(`fatal: ${e}`);
  $.msg(NAME, "❌ 脚本异常", String(e));
  $.done({});
});
