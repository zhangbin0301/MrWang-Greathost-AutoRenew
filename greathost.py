import os, re, time, json, requests
from datetime import datetime, timezone
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from seleniumwire import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# ================= 配置区 =================
EMAIL = os.getenv("GREATHOST_EMAIL", "")
PASSWORD = os.getenv("GREATHOST_PASSWORD", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
PROXY_URL = os.getenv("PROXY_URL", "")

# 目标服务器名称：若为空 "" 且只有一个服务器则自动锁定；若有多个则报错
TARGET_NAME_CONFIG = os.getenv("TARGET_NAME", "loveMC") 

STATUS_MAP = {
    "running": ["🟢", "Running"],
    "starting": ["🟡", "Starting"],
    "stopped": ["🔴", "Stopped"],
    "offline": ["⚪", "Offline"],
    "suspended": ["🚫", "Suspended"]
}

# ================= 工具函数 =================
def now_shanghai():
    return datetime.now(ZoneInfo("Asia/Shanghai")).strftime('%Y/%m/%d %H:%M:%S')

def calculate_hours(date_str):
    """修复 0h 问题：支持带毫秒的 ISO 格式及标准化处理"""
    try:
        if not date_str: return 0
        # 统一格式：移除 .202Z 等毫秒干扰，标准化分隔符
        clean_date = re.sub(r'\.\d+Z$', 'Z', str(date_str)).replace('/', '-')
        if 'T' not in clean_date and ' ' in clean_date:
            clean_date = clean_date.replace(' ', 'T') + 'Z'
        
        expiry = datetime.fromisoformat(clean_date.replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        diff = (expiry - now).total_seconds() / 3600
        return max(0, int(diff))
    except:
        return 0

def fetch_api(driver, url, method="GET"):
    script = f"return fetch('{url}', {{method:'{method}'}}).then(r=>r.json()).catch(e=>({{success:false,message:e.toString()}}))"
    res = driver.execute_script(script)
    return res

def send_notice(kind, fields):
    titles = {
        "renew_success": "🎉 <b>GreatHost 续期成功</b>",
        "maxed_out": "🈵 <b>GreatHost 已达上限</b>",
        "cooldown": "⏳ <b>GreatHost 还在冷却中</b>",
        "renew_failed": "⚠️ <b>GreatHost 续期未生效</b>",
        "error": "🚨 <b>GreatHost 脚本报错</b>"
    }
    title = titles.get(kind, "‼️ <b>GreatHost 通知</b>")
    # 统一使用结构化列表构建消息体
    body = "\n".join([f"{e} {l}: {v}" for e, l, v in fields])
    msg = f"{title}\n\n{body}\n📅 时间: {now_shanghai()}"
    
    if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID:
        try:
            requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage", 
                          data={"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "HTML"}, timeout=5)
        except: pass

# ================= 主流程 =================
def run_task():
    driver = None
    current_server_name = "未知" # 初始化变量名以防报错
    server_id = "未知"
    login_ip = "Unknown"
    
    try:
        opts = Options()
        opts.add_argument("--headless=new")
        # 代理预检逻辑
        driver = webdriver.Chrome(options=opts, seleniumwire_options={'proxy': {'http': PROXY_URL, 'https': PROXY_URL}} if PROXY_URL else None)
        wait = WebDriverWait(driver, 25)

        # 0. 登入 IP 打印
        try:
            driver.get("https://api.ipify.org?format=json")
            login_ip = json.loads(driver.find_element(By.TAG_NAME, "body").text).get('ip', 'Unknown')
            print(f"🌐 登入 IP: {login_ip}")
        except: pass

        # 1. 登录流程
        driver.get("https://greathost.es/login")
        wait.until(EC.presence_of_element_located((By.NAME,"email"))).send_keys(EMAIL)
        driver.find_element(By.NAME,"password").send_keys(PASSWORD)
        driver.find_element(By.CSS_SELECTOR,"button[type='submit']").click()
        wait.until(EC.url_contains("/dashboard"))

        # 2. 智能锁定服务器
        res = fetch_api(driver, "/api/servers")
        server_list = res.get('servers', [])
        if not server_list: raise Exception("账号下没有找到任何服务器")

        if TARGET_NAME_CONFIG:
            target_server = next((s for s in server_list if s.get('name') == TARGET_NAME_CONFIG), None)
            if not target_server: raise Exception(f"未找到名称为 '{TARGET_NAME_CONFIG}' 的服务器")
        else:
            if len(server_list) == 1:
                target_server = server_list[0]
            else:
                raise Exception(f"账号下存在 {len(server_list)} 个服务器，必须指定 TARGET_NAME")

        server_id = target_server.get('id')
        current_server_name = target_server.get('name') # 锁定真实名称
        print(f"✅ 已锁定服务器: {current_server_name}")
        
        # 3. 获取实时状态
        info = fetch_api(driver, f"/api/servers/{server_id}/information")
        real_status = info.get('status', 'unknown').lower()
        icon, status_name = STATUS_MAP.get(real_status, ["❓", real_status])
        status_disp = f"{icon} {status_name}"

        # 4. 合同预检与冷却检测
        driver.get(f"https://greathost.es/contracts/{server_id}")
        time.sleep(2)
        
        # 获取 API 原始 JSON 数据
        contract = fetch_api(driver, f"/api/servers/{server_id}/contract")
        renewal_info = contract.get('renewalInfo', {})
        
        # 1. 核心 API 判定：解析 nextRenewalDate
        # nextRenewalDate 是服务器下一次过期的时间点
        before_h = calculate_hours(renewal_info.get('nextRenewalDate'))
        
        # 2. 逻辑判定：canRenew 字段通常代表后端是否允许操作
        can_renew = renewal_info.get('canRenew', True)
        
        # 3. 物理防线：获取 UI 按钮文本作为补充
        btn = wait.until(EC.presence_of_element_located((By.ID, "renew-free-server-btn")))
        btn_text = btn.text

        # 只要 API 说不能续期，或者 UI 按钮显示 Wait，就进入冷却逻辑
        if not can_renew or "Wait" in btn_text:
            wait_time = "冷却中"
            # 优先从按钮文字抓取具体的剩余倒计时（如 12h 15m）
            if "Wait" in btn_text:
                wait_match = re.search(r"Wait\s+([\d\w\s]+)", btn_text)
                wait_time = wait_match.group(1) if wait_match else btn_text
            
            print(f"⏳ 冷却判定触发: API(canRenew={can_renew}) | UI({btn_text})")
            
            send_notice("cooldown", [
                ("🖥️", "服务器名称", current_server_name),
                ("⏳", "剩余冷却", f"<code>{wait_time}</code>"),
                ("📊", "当前累计", f"{before_h}h") # 此时 before_h 已通过修复后的函数计算准确
            ])
            return # 终止后续 POST 请求

        # 5. 执行续期 POST
        renew_res = fetch_api(driver, f"/api/renewal/contracts/{server_id}/renew-free", method="POST")
        after_h = calculate_hours(renew_res.get('details', {}).get('nextRenewalDate')) or before_h

        # 6. 发送最终通知
        if renew_res.get('success') and after_h > before_h:
            send_notice("renew_success", [
                ("🖥️", "服务器名称", current_server_name),
                ("🆔", "ID", f"<code>{server_id}</code>"),
                ("⏰", "增加时间", f"{before_h} ➔ {after_h}h"),
                ("🚀", "运行状态", status_disp),
                ("🌐", "登入 IP", f"<code>{login_ip}</code>")
            ])
        elif "5 d" in str(renew_res.get('message', '')) or (before_h >= 108):
            send_notice("maxed_out", [
                ("🖥️", "服务器名称", current_server_name),
                ("🆔", "ID", f"<code>{server_id}</code>"),
                ("⏰", "剩余时间", f"{after_h}h"),
                ("🚀", "运行状态", status_disp),
                ("💡", "提示", "已近120h上限，暂无需续期。"),
                ("🌐", "登入 IP", f"<code>{login_ip}</code>")
            ])
        else:
            send_notice("renew_failed", [
                ("🖥️", "服务器名称", current_server_name), 
                ("💡", "原因", f"<code>{renew_res.get('message','未知错误')}</code>")
            ])

    except Exception as e:
        send_notice("error", [
            ("🖥️", "服务器", current_server_name), 
            ("❌", "故障", f"<code>{str(e)[:100]}</code>")
        ])
    finally:
        if driver: driver.quit()

if __name__ == "__main__":
    run_task()
