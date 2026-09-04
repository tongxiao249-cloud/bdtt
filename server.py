#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CreatorDecision · AI 达人决策引擎 —— 薄后端
职责：1) 托管静态页面  2) 提供 /api/send-email 接口（SMTP 转发，无状态）

设计原则：后端不保存任何凭据。SMTP 配置由用户浏览器在发送时随请求带上，
后端只负责"转手"发送，纯无状态，符合单端口部署沙箱的约束。
"""
import os
import re
import json
import time
import smtplib
import urllib.request
import urllib.error
import concurrent.futures
from email.header import Header
from email.mime.text import MIMEText
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "3000"))

# 尝试加载 .env 文件（不提交到 Git）
_ENV_PATH = os.path.join(ROOT, ".env")
if os.path.isfile(_ENV_PATH):
    with open(_ENV_PATH, "r", encoding="utf-8") as _f:
        for _line in _f:
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

OPENBOOST_API_KEY = os.environ.get("OPENBOOST_API_KEY", "")

# ---------- OpenBoost 实时查询（MCP SSE 代理，零依赖） ----------
# 认证方式：secret-key 请求头；传输：GET /sse 握手拿 sessionId，再 POST tools/call 同步查询。
MCP_BASE = "https://mcp.microdata-inc.com"
MCP_TIKTOK_SSE = MCP_BASE + "/mcp-servers/proboost-tiktok-mcp/sse"
_UA = "Mozilla/5.0 (CreatorDecision)"


def _ob_session(key):
    """建立 MCP 会话，返回消息端点 URL（含 sessionId）。失败返回 (None, 错误信息)。"""
    req = urllib.request.Request(MCP_TIKTOK_SSE, headers={
        "secret-key": key, "Accept": "text/event-stream", "User-Agent": _UA})
    try:
        resp = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        return None, "OpenBoost 认证失败（HTTP {0}），请检查密钥".format(e.code)
    except Exception as e:
        return None, "无法连接 OpenBoost：{0}".format(repr(e))

    endpoint = None
    try:
        for _ in range(60):
            line = resp.readline().decode("utf-8", "ignore").strip()
            if line.startswith("data:") and "sessionId" in line:
                endpoint = MCP_BASE + line.split("data:", 1)[1].strip()
                break
    finally:
        try:
            resp.close()
        except Exception:
            pass

    if not endpoint:
        return None, "未能获取 OpenBoost 会话端点"
    return endpoint, None


def _ob_call(key, msg_url, method, params, timeout=30):
    """向消息端点发 JSON-RPC，同步返回结果 dict。"""
    rid = "r" + str(int(time.time() * 1000))
    body = json.dumps({"jsonrpc": "2.0", "id": rid, "method": method,
                       "params": params}).encode("utf-8")
    req = urllib.request.Request(msg_url, data=body, headers={
        "secret-key": key, "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream", "User-Agent": _UA})
    resp = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(resp.read().decode("utf-8", "ignore"))


def _extract_payload(text):
    """从 tools/call 返回的 text 中提取真实数据 JSON 对象。"""
    mark = "# 响应数据（JSON）"
    tail = text.split(mark, 1)[1].strip() if mark in text else text.strip()
    # tail 通常是一个 JSON 字符串字面量（如 "\"{\\\"success\\\":true,...}\""）
    try:
        inner = json.loads(tail)          # 解出内层 JSON 字符串
        return json.loads(inner)          # 解出对象
    except Exception:
        pass
    try:
        return json.loads(tail)           # 兜底：本身就是对象文本
    except Exception:
        return None


def _num(v):
    """安全转 float，空/None 返回 None。"""
    if v is None or v == "":
        return None
    try:
        f = float(v)
        return f
    except Exception:
        return None


def _map_portrait(data):
    """把 fansGenderPortrait / fansAgePortrait 字符串解析成 {male, female, age} 结构。
    原始 value 是小数比例（0~1），这里 ×100 并保留一位小数。
    data 为空 / 字段缺失 / 解析失败都视为无画像，返回 None。"""
    if not data:
        return None
    out = {}

    g = data.get("fansGenderPortrait")
    if g:
        arr = g
        try:
            if isinstance(g, str):
                arr = json.loads(g)
            for x in (arr or []):
                k = (x.get("key") or "").strip().lower()
                v = _num(x.get("value"))
                if v is None:
                    continue
                pct = round(v * 100, 1)
                if k in ("male", "f", "男"):
                    out["male"] = pct
                elif k in ("female", "m", "女"):  # 极少数源里 M/F 可能颠倒
                    out["female"] = pct
        except Exception:
            pass

    a = data.get("fansAgePortrait")
    if a:
        arr = a
        try:
            if isinstance(a, str):
                arr = json.loads(a)
            age_arr = []
            for x in (arr or []):
                lbl = (x.get("key") or "").strip()
                v = _num(x.get("value"))
                if not lbl or v is None:
                    continue
                age_arr.append({"label": lbl, "pct": round(v * 100, 1)})
            if age_arr:
                out["age"] = age_arr
        except Exception:
            pass

    return out if out else None


def _fetch_portrait(key, msg_url, expert_id, region="美国"):
    """粉丝画像二次调用：失败不影响主查询。返回 dict 或 None。"""
    if not expert_id:
        return None
    try:
        r = _ob_call(key, msg_url, "tools/call", {
            "name": "tt_expert_fans_portrait",
            "arguments": {"expertId": str(expert_id),
                          "countryRegion": region or "美国"},
        }, timeout=15)
        text = r["result"]["content"][0]["text"]
        payload = _extract_payload(text)
        if not payload:
            return None
        return _map_portrait(payload.get("data") or {})
    except Exception:
        return None


def _map_creator(item):
    """把 OpenBoost 达人字段映射成 app 的 creator 结构。"""
    account = (item.get("authorAccount") or "").strip()
    fans = item.get("authorFans")
    gmv = _num(item.get("medGmv"))
    units = item.get("unitsSold")
    gpm = _num(item.get("ecLiveGpm"))
    if gpm is None:
        gpm = _num(item.get("ecVideoGpm"))
    # fanslastXdqaq 是小数比例（如 -0.0937 = -9.37%），转成百分比绝对值；up 由正负决定
    fans_delta = _num(item.get("fanslast7dqaq"))
    if fans_delta is None:
        fans_delta = _num(item.get("fanslast30dqaq"))
    fans_delta = fans_delta or 0

    return {
        "id": account or str(item.get("authorId") or ""),
        "openboostId": str(item.get("authorId") or ""),
        "name": (item.get("authorNickname") or account or "达人"),
        "handle": "@" + account if account else "",
        "email": item.get("authorEmail") or None,
        "icon": item.get("authorIcon") or None,
        "url": item.get("authorUrl") or None,
        "fans": int(fans) if fans is not None else 0,
        "gmv": int(round(gmv)) if gmv is not None else 0,
        "units": int(units) if units is not None else 0,
        "gpm": round(gpm, 1) if gpm is not None else 0,
        "category": (item.get("authorType") or "General"),
        "male": None, "female": None, "age": None,
        "avgViews": int(item.get("videoAvgViews") or 0),
        "products": int(item.get("productCnt") or 0),
        "videos": int(item.get("videosNum") or 0),
        "commissionRate": _num(item.get("medCommissionRate")),
        "creatorScore": _num(item.get("creatorScore")),
        "interactionRate": _num(item.get("interactionRate")),
        "trend": {"value": round(abs(fans_delta) * 100, 1), "up": fans_delta >= 0},
        "source": "openboost",
    }


def query_openboost(key, handle):
    """实时查询单个达人。返回 (creator_dict, 错误信息)。"""
    if not key:
        return None, "未配置 OpenBoost 密钥"
    endpoint, err = _ob_session(key)
    if err:
        return None, err
    try:
        r = _ob_call(key, endpoint, "tools/call", {
            "name": "tt_expert_info_list",
            "arguments": {"expertName": handle, "countryRegion": "美国",
                          "size": 5, "current": 1},
        })
    except urllib.error.HTTPError as e:
        return None, "OpenBoost 查询失败（HTTP {0}），请检查密钥或套餐".format(e.code)
    except Exception as e:
        return None, "OpenBoost 查询失败：{0}".format(repr(e))

    try:
        text = r["result"]["content"][0]["text"]
    except Exception:
        return None, "OpenBoost 返回格式异常"

    payload = _extract_payload(text)
    if not payload:
        return None, "OpenBoost 返回解析失败"
    data = payload.get("data") or {}
    lst = data.get("list") or []
    if not lst:
        return None, "未找到达人 @{0}（可能账号名有误或非美国站）".format(handle)

    # 精确匹配账号名（忽略大小写），否则取第一条
    target = next((x for x in lst if (x.get("authorAccount") or "").lower() == handle.lower()), lst[0])
    creator = _map_creator(target)

    # 顺便拉粉丝画像（性别 + 年龄分布）。失败不影响主返回。
    portrait = _fetch_portrait(key, endpoint, creator.get("openboostId"),
                               target.get("region") or "美国")
    if portrait:
        for k in ("male", "female", "age"):
            if portrait.get(k) is not None:
                creator[k] = portrait[k]

    return creator, None


def batch_query_openboost(key, handles, max_workers=4):
    """并行查多个达人；单个失败不互相影响。结果按入参顺序返回。
    返回 [{handle, ok, data|None, error|None}, ...]"""
    if not key:
        return [(h, False, "未配置 OpenBoost 密钥") for h in handles]
    out = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = {ex.submit(query_openboost, key, h): h for h in handles}
        for fut in concurrent.futures.as_completed(futs):
            h = futs[fut]
            try:
                data, err = fut.result()
                out.append((h, err is None, err, data))
            except Exception as e:
                out.append((h, False, "查询异常：{0}".format(repr(e)), None))
    order = {h: i for i, h in enumerate(handles)}
    out.sort(key=lambda x: order.get(x[0], 10**9))
    return [{"handle": h, "ok": ok, "data": data if ok else None,
             "error": (err if not ok else None)} for (h, ok, err, data) in out]


MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}

# 通过 OpenBoost MCP 连接器获取的真实达人数据缓存（演示用）
# 后续接入 OpenBoost REST API 时，将由后端实时查询并返回。
OPENBOOST_CACHE = {
    "rafadealss": {
        "id": "rafadealss", "name": "Rafa", "handle": "@rafadealss",
        "email": "rafacollabs03@gmail.com", "fans": 11100,
        "gmv": 43991, "units": 540, "gpm": 129,
        "category": "General", "source": "openboost",
        "products": 14, "avgViews": 1470, "videos": 86,
        "trend": {"value": 9.4, "up": False}
    },
    "josiahfinds": {
        "id": "josiahfinds", "name": "Josiah", "handle": "@josiahfinds",
        "email": "josiahfinds@gmail.com", "fans": 6463,
        "gmv": 2643, "units": 391, "gpm": 88.4,
        "category": "Home & Electronics", "source": "openboost",
        "male": 21.6, "female": 68.0,
        "age": [
            {"label": "18-24", "pct": 22}, {"label": "25-34", "pct": 15},
            {"label": "35-44", "pct": 17}, {"label": "45+", "pct": 46}
        ],
        "products": 84, "avgViews": 345, "videos": 106,
        "trend": {"value": 113.1, "up": False}
    },
    "dodbao6666": {
        "id": "dodbao6666", "name": "dodbao666", "handle": "@dodbao6666",
        "email": None, "fans": 21900,
        "gmv": 62347, "units": 5622, "gpm": 10.8,
        "category": "Phones & Electronics", "source": "openboost",
        "male": 71.2, "female": 15.0,
        "age": [
            {"label": "18-24", "pct": 12.9}, {"label": "25-34", "pct": 22.9},
            {"label": "35-44", "pct": 23.4}, {"label": "45-54", "pct": 23.4},
            {"label": "55+", "pct": 17.5}
        ],
        "products": 79, "avgViews": 4338, "videos": 594,
        "trend": {"value": 200, "up": True}
    },
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 静默访问日志

    # ---------- 基础响应 ----------
    def _json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-OpenBoost-Key")
        self.end_headers()

    # ---------- 静态文件 ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # OpenBoost 达人数据查询（预留接口，当前返回 MCP 缓存数据）
        if path == "/api/openboost/search":
            self.handle_openboost_search(parse_qs(parsed.query))
            return

        if path in ("/", ""):
            path = "/index.html"
        full = os.path.normpath(os.path.join(ROOT, path.lstrip("/")))
        # 防止目录穿越
        if not full.startswith(ROOT):
            self._json({"error": "forbidden"}, 403)
            return
        if not os.path.isfile(full):
            self._json({"error": "not found"}, 404)
            return
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_openboost_search(self, qs):
        handle = (qs.get("handle") or [""])[0].strip().lstrip("@").lower()
        if not handle:
            self._json({"ok": False, "error": "缺少 handle 参数"}, 400)
            return

        # 密钥来源优先级：请求头 X-OpenBoost-Key > query key > .env
        key = self.headers.get("X-OpenBoost-Key", "").strip()
        if not key:
            key = (qs.get("key") or [""])[0].strip()
        if not key:
            key = OPENBOOST_API_KEY

        if key:
            data, err = query_openboost(key, handle)
            if err:
                self._json({"ok": False, "error": err}, 400)
                return
            self._json({"ok": True, "live": True, "source": "openboost", "data": data})
            return

        # 无密钥：回退到内置缓存（演示用）
        data = OPENBOOST_CACHE.get(handle)
        if not data:
            self._json({
                "ok": False,
                "error": "未配置 OpenBoost 密钥，且该达人不在内置缓存中。请在「设置」页填入 OpenBoost 密钥后重试。"
            }, 400)
            return
        self._json({"ok": True, "cache": True, "source": "openboost", "data": data})

    # ---------- API ----------
    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/send-email":
            self.handle_send_email()
        elif path == "/api/openboost/batch-search":
            self.handle_openboost_batch()
        else:
            self._json({"error": "not found"}, 404)

    def handle_openboost_batch(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._json({"ok": False, "error": "请求格式错误"}, 400)
            return

        handles = payload.get("handles") or []
        if not isinstance(handles, list):
            self._json({"ok": False, "error": "handles 必须是数组"}, 400)
            return

        # 清洗：去首尾 @、小写、去重、过滤空
        clean = []
        seen = set()
        for h in handles:
            s = str(h or "").strip().lstrip("@").lower()
            if s and s not in seen:
                seen.add(s)
                clean.append(s)
        clean = clean[:50]  # 防止单次请求过大
        if not clean:
            self._json({"ok": False, "error": "未传入有效 handle"}, 400)
            return

        # 密钥优先级同 search 接口
        key = self.headers.get("X-OpenBoost-Key", "").strip()
        if not key:
            key = (payload.get("key") or "").strip()
        if not key:
            key = OPENBOOST_API_KEY
        if not key:
            self._json({"ok": False, "error": "未配置 OpenBoost 密钥"}, 400)
            return

        results = batch_query_openboost(key, clean, max_workers=4)
        success = sum(1 for r in results if r["ok"])
        self._json({
            "ok": True, "total": len(results), "success": success,
            "failed": len(results) - success, "results": results,
        })

    def handle_send_email(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._json({"ok": False, "error": "请求格式错误"}, 400)
            return

        smtp = payload.get("smtp") or {}
        to = (payload.get("to") or "").strip()
        subject = payload.get("subject")
        text = payload.get("body") or ""
        from_addr = (smtp.get("user") or "").strip()
        host = (smtp.get("host") or "").strip()
        port = int(smtp.get("port") or 465)
        use_ssl = bool(smtp.get("ssl"))
        password = smtp.get("password") or ""

        if not (host and from_addr and password and to and subject):
            self._json({"ok": False, "error": "邮件配置不完整，请先在「设置」页填写发件邮箱与授权码"}, 400)
            return

        try:
            msg = MIMEText(text, "plain", "utf-8")
            msg["Subject"] = Header(subject, "utf-8")
            msg["From"] = from_addr
            msg["To"] = to
            msg["Reply-To"] = from_addr

            if use_ssl:
                server = smtplib.SMTP_SSL(host, port, timeout=25)
            else:
                server = smtplib.SMTP(host, port, timeout=25)
                server.ehlo()
                server.starttls()
                server.ehlo()
            server.login(from_addr, password)
            server.sendmail(from_addr, [to], msg.as_string())
            try:
                server.quit()
            except Exception:
                pass
            self._json({"ok": True})
        except smtplib.SMTPAuthenticationError:
            self._json({"ok": False, "error": "SMTP 认证失败：邮箱或授权码错误"}, 401)
        except Exception as e:
            self._json({"ok": False, "error": "发送失败：{}".format(e)}, 500)


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("CreatorDecision server running on :{}".format(PORT))
    server.serve_forever()


if __name__ == "__main__":
    main()
