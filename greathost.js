const EMAIL = process.env.GREATHOST_EMAIL || '';
const PASSWORD = process.env.GREATHOST_PASSWORD || '';
const CHAT_ID = process.env.CHAT_ID || '';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PROXY_URL = (process.env.PROXY_URL || "").trim();

// 核心改动：换成 firefox 引擎
const { firefox } = require("playwright");
const https = require('https');

async function sendTelegramMessage(message) {
    return new Promise((resolve) => {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' });
        const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
        const req = https.request(url, options, (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
        });
        req.on('error', () => resolve());
        req.write(data);
        req.end();
    });
}

(async () => {
    // === 严格保留你原始定义的 URL 变量 ===
    const GREATHOST_URL = "https://greathost.es";    
    const LOGIN_URL = `${GREATHOST_URL}/login`;
    const HOME_URL = `${GREATHOST_URL}/dashboard`;
    const BILLING_URL = `${GREATHOST_URL}/billing/free-servers`;
    
    let proxyStatusTag = "🌐 直连模式";
    let serverStarted = false;

    // --- 代理逻辑解析 ---
    let proxyData = null;
    if (PROXY_URL) {
        try {
            const cleanUrl = PROXY_URL.startsWith('socks') ? PROXY_URL : `socks5://${PROXY_URL}`;
            proxyData = new URL(cleanUrl);
            proxyStatusTag = `🔒 代理模式 (${proxyData.host})`;
        } catch (e) {
            console.error("❌ PROXY_URL 解析失败:", e.message);
        }
    }

    let browser;
    try {
        console.log(`🚀 任务启动 | 引擎: Firefox | ${proxyStatusTag}`);
        
        // 1. 启动浏览器（不带参数）
        browser = await firefox.launch({ headless: true });

        // 2. 在创建上下文时，【一次性】注入代理服务器和认证信息
        // 这是 Playwright Node.js 官方文档定义的标准 SOCKS5 认证方式
        const contextOptions = {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
            viewport: { width: 1280, height: 720 },
            locale: 'es-ES'
        };

        if (proxyData) {
            contextOptions.proxy = {
                server: `socks5://${proxyData.host}`,
                username: proxyData.username || '',
                password: proxyData.password || ''
            };
        }

        const context = await browser.newContext(contextOptions);

        // 3. 创建页面
        const page = await context.newPage();

        // --- 完整保留你原来的指纹抹除 ---
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        // --- 1. 代理检测（熔断逻辑） ---
        if (proxyData) {
            console.log("🌍 [Check] 正在检测代理出口 IP...");
            try {
                await page.goto("https://api.ipify.org?format=json", { timeout: 30000 });
                const ipInfo = JSON.parse(await page.innerText('body'));
                console.log(`✅ 当前出口 IP: ${ipInfo.ip}`);
            } catch (e) {
                await sendTelegramMessage(`🚨 <b>GreatHost 代理异常</b>\n原因: ${e.message}`);
                throw new Error("Proxy Check Failed"); 
            }
        }

        // --- 2. 登录流程（严格按照你源代码的步骤） ---
        console.log("🔑 正在登录...");
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
        await page.fill('input[name="email"]', EMAIL);
        await page.fill('input[name="password"]', PASSWORD);
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: "networkidle" }),
        ]);
        
        if (page.url().includes('login')) {
            throw new Error("登录失败，请检查账号密码");
        }
        console.log("✅ 登录成功！");

        // --- 3. 自动开机逻辑（完整保留） ---
        console.log("📊 检查服务器状态...");
        await page.goto(HOME_URL, { waitUntil: "networkidle" });
        const offlineIndicator = page.locator('span.badge-danger, .status-offline').first();
        if (await offlineIndicator.isVisible()) {
            console.log("⚠️ 检测到服务器离线，尝试启动...");
            const startBtn = page.locator('button:has-text("Start"), .btn-start').first();
            if (await startBtn.isVisible()) {
                await startBtn.click();
                serverStarted = true;
                await page.waitForTimeout(3000);
            }
        }

        // --- 4. 续期流程（还原原始点击路径和报表逻辑） ---
        console.log("🔍 进入 Billing 页面...");
        await page.goto(BILLING_URL, { waitUntil: "networkidle" });

        // 原版点击 View Details
        await page.getByRole('link', { name: 'View Details' }).first().click();
        await page.waitForNavigation({ waitUntil: "networkidle" });
        
        const serverId = page.url().split('/').pop() || 'unknown';
        const timeSelector = '#accumulated-time';

        // 捕获续期前时长
        const beforeHoursText = await page.textContent(timeSelector);
        const beforeHours = parseInt(beforeHoursText.replace(/[^0-9]/g, '')) || 0;

        const renewBtn = page.locator('#renew-free-server-btn');
        const btnContent = await renewBtn.innerHTML();

        // 完整保留你原来的报告生成函数
        const getReport = (icon, title, hours, detail) => {
            return `${icon} <b>GreatHost ${title}</b>\n\n` +
                   `🆔 <b>服务器ID:</b> <code>${serverId}</code>\n` +
                   `⏰ <b>当前时长:</b> ${hours}h\n` +
                   `🚀 <b>开机状态:</b> ${serverStarted ? '✅ 已触发开机' : '运行中'}\n` +
                   `🌐 <b>连接模式:</b> ${proxyStatusTag}\n` + 
                   `💡 <b>详情:</b> ${detail}`;
        };

        if (btnContent.includes('Wait')) {
            const waitMatch = btnContent.match(/\d+/);
            const waitTime = waitMatch ? waitMatch[0] : "??";
            await sendTelegramMessage(getReport('⏳', '续期冷却中', beforeHours, `还需等待 ${waitTime} 分钟`));
            return;
        }

        // --- 5. 执行续期（原始模拟逻辑） ---
        console.log("⚡ 执行续期操作...");
        await page.mouse.wheel(0, 200); 
        await page.waitForTimeout(2000);
        await renewBtn.click({ force: true });

        // --- 6. 最终校验（原始同步逻辑） ---
        console.log("⏳ 等待 20 秒处理数据...");
        await page.waitForTimeout(20000);
        await page.reload();
        
        const afterHoursText = await page.textContent(timeSelector);
        const afterHours = parseInt(afterHoursText.replace(/[^0-9]/g, '')) || 0;

        if (afterHours > beforeHours) {
            await sendTelegramMessage(getReport('🎉', '续期成功', afterHours, `时长从 ${beforeHours}h 增加`));
        } else {
            await sendTelegramMessage(getReport('✅', '已检查', afterHours, '目前时长充足，无需重复续期'));
        }

    } catch (err) {
        console.error("❌ 错误详情:", err);
        if (!err.message.includes("Proxy Check Failed")) {
            await sendTelegramMessage(`🚨 <b>GreatHost 脚本崩溃</b>\n错误: <code>${err.message}</code>`);
        }
    } finally {
        if (browser) {
            console.log("🧹 关闭浏览器...");
            await browser.close();
        }
    }
})();
