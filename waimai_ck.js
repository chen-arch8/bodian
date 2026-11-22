/**
 * 外卖霸王餐 · 凭据捕获 + 呆呆面板同步
 * 小蚕霸王餐 + 歪麦吧霸王餐
 *
 * 拦截 App 请求 → 提取凭据 → 自动同步到呆呆面板环境变量
 */
const NAME = "外卖霸王餐·凭据捕获";
const KEY_XC = "xcbwc_data";
const KEY_WM = "wmbwc_data";

const $ = {
  getdata(k) { return typeof $persistentStore !== "undefined" ? $persistentStore.read(k) : null; },
  setdata(v, k) { return typeof $persistentStore !== "undefined" ? $persistentStore.write(v, k) : false; },
  msg(t, s, b) { if (typeof $notification !== "undefined") $notification.post(t, s, b); },
  done(d) { if (typeof $done === "function") try { $done(d); } catch (e) {} },
  log(m) { console.log(m); },
};

const ARG = typeof $argument === "object" && $argument ? $argument : {};
const PANEL_URL = (ARG.daidai_url || "").replace(/\/+$/, "");
const APP_KEY = ARG.daidai_key || "";
const APP_SECRET = ARG.daidai_secret || "";

function getHeader(headers, name) {
  const target = name.toLowerCase();
  for (const k in (headers || {})) {
    if (k.toLowerCase() === target) return headers[k];
  }
  return "";
}

// ---------- 呆呆面板同步 ----------
function panelSync(envName, envValue, remark, callback) {
  if (!PANEL_URL || !APP_KEY || !APP_SECRET) {
    callback({ ok: false, reason: "面板未配置" });
    return;
  }
  const called = { v: false };
  const safe = (res) => { if (!called.v) { called.v = true; if (callback) callback(res); } };
  const timer = setTimeout(() => safe({ ok: false, reason: "超时" }), 5000);

  const doReq = (method, path, body, hdrs, next) => {
    const opts = {
      url: PANEL_URL + path,
      method: method,
      headers: Object.assign({ "Content-Type": "application/json", "Accept": "application/json" }, hdrs || {}),
    };
    if (body) opts.body = typeof body === "string" ? body : JSON.stringify(body);
    if (typeof $httpClient !== "undefined") {
      const fn = method === "POST" ? $httpClient.post : method === "PUT" ? $httpClient.put : $httpClient.get;
      fn(opts, (err, resp, data) => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        next(err, resp ? (resp.status || resp.statusCode) : 0, json);
      });
    } else { next(new Error("无 $httpClient")); }
  };

  // 1. 获取面板 token
  doReq("POST", "/api/open-api/token", { app_key: APP_KEY, app_secret: APP_SECRET }, null, (err, st, res) => {
    if (err || !res) { clearTimeout(timer); return safe({ ok: false, reason: "token 请求失败" }); }
    const d = res.data || res;
    const tk = d.access_token || d.token;
    if (!tk) { clearTimeout(timer); return safe({ ok: false, reason: "无 access_token" }); }
    const auth = { "Authorization": "Bearer " + tk };

    // 2. 查询同名变量
    doReq("GET", "/api/envs?names=" + encodeURIComponent(envName) + "&all=1", null, auth, (gErr, gSt, gJson) => {
      if (gErr || !gJson) { clearTimeout(timer); return safe({ ok: false, reason: "查询变量失败" }); }
      const rows = ((gJson.data || [])).filter(it => it && it.name === envName);
      let target = null;
      if (rows.length > 1) {
        // 多条同名: 按 remark 匹配
        for (const r of rows) {
          if ((r.remarks || "").includes(remark)) { target = r; break; }
        }
        if (!target) { clearTimeout(timer); return safe({ ok: false, reason: `存在 ${rows.length} 条同名变量且无法匹配,防误伤拒绝覆盖` }); }
      } else if (rows.length === 1) { target = rows[0]; }

      // 3. 创建或更新
      if (target) {
        if (target.value === envValue && target.enabled !== false) {
          clearTimeout(timer); return safe({ ok: true, action: "unchanged", envId: target.id });
        }
        doReq("PUT", "/api/envs/" + target.id, { value: envValue, enabled: true }, auth, (uErr) => {
          clearTimeout(timer);
          safe(uErr ? { ok: false, reason: "更新失败" } : { ok: true, action: "updated", envId: target.id });
        });
      } else {
        doReq("POST", "/api/envs", { name: envName, value: envValue, group: "外卖霸王餐", remarks: remark }, auth, (cErr, cSt, cJson) => {
          clearTimeout(timer);
          safe(cErr ? { ok: false, reason: "创建失败" } : { ok: true, action: "created", envId: (cJson && cJson.data && cJson.data.id) || "" });
        });
      }
    });
  });
}

// ---------- 通知去重 ----------
function notifyOnce(tag, title, sub, body) {
  const key = "wm_notify_" + tag;
  const last = Number($.getdata(key) || 0);
  if (Date.now() - last < 10000) return;
  $.setdata(String(Date.now()), key);
  $.msg(title, sub, body);
}

// ---------- 主逻辑 ----------
(function main() {
  const url = ($request || {}).url || "";
  const hdrs = ($request || {}).headers || {};
  const lower = {};
  for (const k in hdrs) lower[k.toLowerCase()] = hdrs[k];

  if (!url) return $.done({});

  // === 小蚕凭据 ===
  if (url.includes("gw.xiaocantech.com") && lower["x-vayne"] && lower["x-sivir"] && lower["x-teemo"]) {
    const uid = lower["x-vayne"];
    const token = lower["x-sivir"];
    const teemo = lower["x-teemo"];

    let accounts = [];
    try { accounts = JSON.parse($.getdata(KEY_XC) || "[]"); } catch (e) {}

    const existing = accounts.find(a => a.userId === uid);
    let changed = false;
    if (existing) {
      if (existing.token !== token || existing.teemo !== teemo) {
        existing.token = token; existing.teemo = teemo; existing.capturedAt = Date.now();
        changed = true;
      }
    } else {
      accounts.push({ userId: uid, teemo: teemo, token: token, userName: "小蚕账号" + (accounts.length + 1), capturedAt: Date.now() });
      changed = true;
    }

    if (changed) {
      const valStr = JSON.stringify(accounts);
      $.setdata(valStr, KEY_XC);
      const remark = uid;
      panelSync(KEY_XC, valStr, remark, (res) => {
        let sub = existing ? "✅ 小蚕凭据已更新" : "✅ 小蚕凭据已获取";
        let lines = [`• userId: ${uid}`, `• 账号数: ${accounts.length}`];
        if (res.ok) {
          sub = `🎉 ${sub} · 已同步至呆呆面板`;
          lines.push(`• 面板: ${res.action === "created" ? "已新建" : res.action === "updated" ? "已更新" : "无变化"}`);
        } else if (res.reason !== "面板未配置") {
          lines.push(`• 面板同步: ${res.reason}`);
        }
        notifyOnce("xc", NAME, sub, lines.join("\n"));
      });
    } else {
      notifyOnce("xc", NAME, "✅ 小蚕凭据有效 (未变化)", `• userId: ${uid}`);
    }
    return $.done({});
  }

  // === 歪麦凭据 ===
  if (url.includes("waimaimingtang.com") && lower["token"]) {
    const token = lower["token"];

    let accounts = [];
    try { accounts = JSON.parse($.getdata(KEY_WM) || "[]"); } catch (e) {}

    const existing = accounts.find(a => a.token === token);
    if (existing) {
      notifyOnce("wm", NAME, "✅ 歪麦凭据有效 (未变化)", `• token: ${token.slice(0, 12)}...`);
      return $.done({});
    }

    accounts.push({ userId: "user_" + Date.now(), token: token, userName: "歪麦账号" + (accounts.length + 1), capturedAt: Date.now() });
    const valStr = JSON.stringify(accounts);
    $.setdata(valStr, KEY_WM);
    const remark = token.slice(0, 12);
    panelSync(KEY_WM, valStr, remark, (res) => {
      let sub = "✅ 歪麦凭据已获取";
      let lines = [`• token: ${token.slice(0, 16)}...`, `• 账号数: ${accounts.length}`];
      if (res.ok) {
        sub = `🎉 ${sub} · 已同步至呆呆面板`;
        lines.push(`• 面板: ${res.action === "created" ? "已新建" : res.action === "updated" ? "已更新" : "无变化"}`);
      } else if (res.reason !== "面板未配置") {
        lines.push(`• 面板同步: ${res.reason}`);
      }
      notifyOnce("wm", NAME, sub, lines.join("\n"));
    });
    return $.done({});
  }

  $.done({});
})();
