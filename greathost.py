import time
import os
import json
import requests
from seleniumwire import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# ================= 配置区域 =================
EMAIL = os.getenv("GREATHOST_EMAIL") or ""
PASSWORD = os.getenv("GREATHOST_PASSWORD") or ""
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN") or ""
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID") or ""

# 代理配置 (直接使用你文件里的格式)
PROXY_URL = "socks5://admin123:admin321@138.68.253.225:30792"

# 目标 URL
GREATHOST_URL = "https://greathost.es"
LOGIN_URL = f"{GREATHOST_URL}/login"
HOME_URL = f"{GREATHOST_URL}/dashboard"
BILLING_URL = f"{GREATHOST_URL}/billing/free-servers"
# ===========================================

def send_telegram(message):
    """发送 Telegram HTML 格式通知"""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("⚠️ 未设置 Telegram 环境变量，跳过通知。")
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "HTML"
        }
        requests.post(url, data=payload, timeout=10)
        print("📨 Telegram 通知已发送")
    except Exception as e:
        print(f"⚠️ Telegram 通知失败: {e}")

def get_browser():
    """初始化 Selenium-Wire 浏览器"""
    print(f"🔧 [Init] 启动 Chrome 引擎 (代理模式)...")
    
    sw_options = {
        'proxy': {
            'http': PROXY_URL,
            'https': PROXY_URL,
            'no_proxy': 'localhost,127.0.0.1'
        }
    }

    chrome_options = Options()
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--window-size=1920,1080")
    chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
    
    driver = webdriver.Chrome(options=chrome_options, seleniumwire_options=sw_options)
    return driver

def run_task():
    driver = None
    server_started = False
    try:
        driver = get_browser()
        wait = WebDriverWait(driver, 20)

        # 1. 代理检测
        print("🌍 [Step 1] 检测代理出口 IP...")
        driver.get("https://api.ipify.org?format=json")
        ip_info = json.loads(driver.find_element(By.TAG_NAME, "body").text)
        print(f"✅ 当前出口 IP: {ip_info['ip']}")

        # 2. 登录流程
        print("🔑 [Step 2] 正在登录 GreatHost...")
        driver.get(LOGIN_URL)
        wait.until(EC.presence_of_element_located((By.NAME, "email"))).send_keys(EMAIL)
        driver.find_element(By.NAME, "password").send_keys(PASSWORD)
        driver.find_element(By.CSS_SELECTOR, "button[type='submit']").click()
        
        # 等待跳转到控制台
        wait.until(EC.url_contains("/dashboard"))
        print("✅ 登录成功！")

        # 3. 首页自动开机检查
        print("📊 [Step 3] 检查服务器在线状态...")
        driver.get(HOME_URL)
        time.sleep(3)
        offlines = driver.find_elements(By.CSS_SELECTOR, "span.badge-danger, .status-offline")
        if offlines:
            print("⚠️ 发现离线服务器，尝试开机...")
            start_btn = driver.find_element(By.XPATH, "//button[contains(text(), 'Start')]")
            if start_btn:
                start_btn.click()
                server_started = True
                time.sleep(5)

        # 4. 进入续期页面
        print("🔍 [Step 4] 进入 Billing 页面...")
        driver.get(BILLING_URL)
        
        # 点击 View Details (第一个)
        view_details = wait.until(EC.element_to_be_clickable((By.PARTIAL_LINK_TEXT, "View Details")))
        view_details.click()
        
        # 获取服务器 ID
        server_id = driver.current_url.split('/')[-1]
        
        # 获取续期前时长
        time_el = wait.until(EC.presence_of_element_located((By.ID, "accumulated-time")))
        before_hours = "".join(filter(str.isdigit, time_el.text)) or "0"

        # 5. 检查续期按钮状态
        renew_btn = driver.find_element(By.ID, "renew-free-server-btn")
        btn_html = renew_btn.get_attribute('innerHTML')

        if "Wait" in btn_html:
            print("⏳ 还在冷却期，跳过点击。")
            msg = (f"⏳ <b>GreatHost 续期冷却</b>\n"
                   f"ID: <code>{server_id}</code>\n"
                   f"当前时长: {before_hours}h\n"
                   f"状态: 冷却中，请稍后再试。")
            send_telegram(msg)
            return

        # 6. 执行续期
        print("⚡ [Step 5] 执行续期点击...")
        driver.execute_script("window.scrollBy(0, 300);")
        time.sleep(2)
        renew_btn.click()

        # 7. 结果校验
        print("⏳ 等待 20 秒同步数据...")
        time.sleep(20)
        driver.refresh()
        
        after_hours_el = wait.until(EC.presence_of_element_located((By.ID, "accumulated-time")))
        after_hours = "".join(filter(str.isdigit, after_hours_el.text)) or "0"

        # 发送成功报告
        status_text = "✅ 续期成功" if int(after_hours) > int(before_hours) else "ℹ️ 时长未变"
        report = (f"🚀 <b>GreatHost 任务报告</b>\n"
                  f"状态: {status_text}\n"
                  f"ID: <code>{server_id}</code>\n"
                  f"时长: {before_hours}h -> {after_hours}h\n"
                  f"自动开机: {'已触发' if server_started else '正常'}")
        send_telegram(report)

    except Exception as e:
        print(f"❌ 脚本崩溃: {e}")
        send_telegram(f"🚨 <b>GreatHost 脚本异常</b>\n错误: <code>{str(e)}</code>")
    finally:
        if driver:
            driver.quit()
            print("🧹 浏览器已关闭")

if __name__ == "__main__":
    run_task()
