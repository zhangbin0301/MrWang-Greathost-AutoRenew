const EMAIL = process.env.GREATHOST_EMAIL || '';
const PASSWORD = process.env.GREATHOST_PASSWORD || '';
const CHAT_ID = process.env.CHAT_ID || '';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PROXY_URL = "socks5://admin123:admin321@138.68.253.225:30792";

const { firefox } = require("playwright");
const https = require('https');

// --- 1. 恢复你原始的 Telegram 通知函数（带完整的 HTML 格式支持） ---
async function sendTelegramMessage(message) {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.log("⚠️ 未设置 Telegram 环境变量，跳过通知。");
        return;
    }
    return new Promise((resolve) => {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' });
        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        };
        const req = https.request(url, options, (res) => {
            let resData = '';
            res.on('data', (chunk) => resData += chunk);
            res.on('end', () => resolve(resData));
        });
        req.on('error', (e) => {
            console.error(`Telegram 发送失败: ${e.message}`);
            resolve();
        });
        req.write(data);
        req.end();
    });
}

(async () => {
    // === 严格保留你原始定义的所有 URL 和变量 ===
    const GREATHOST_URL = "https://greathost.es";    
    const LOGIN_URL = `${GREATHOST_URL}/login`;
    const HOME_URL = `${GREATHOST_URL}/dashboard`;
    const BILLING_URL = `${GREATHOST_URL}/billing/free-servers`;
    
    let proxyStatusTag = "🌐 直连模式";
    let serverStarted = false;

    // --- 2. 代理配置（这里是修复 SOCKS5 认证的关键，不再使用报错的 setCredentials） ---
    let proxyConfig = null;
    try {
        const url = new URL(PROXY_URL);
        proxyConfig = {
            server: `socks5://${url.host}`,
            username: url.username,
            password: url.password
        };
        proxyStatusTag = `🔒 代理模式 (${url.host})`;
    } catch (e) {
        console.error("❌ 代理 URL 解析失败，将尝试直连");
    }

    let browser;
    try {
        console.log("------------------------------------------");
        console.log(`🚀 任务启动 | 引擎: Firefox | ${proxyStatusTag}`);
        console.log("------------------------------------------");
        
        // --- 3. 浏览器启动逻辑（仅针对 Firefox 优化，彻底解决认证崩溃） ---
        browser = await firefox.launch({ headless: true });

        // 将代理配置直接塞进 Context，这是 Playwright 处理 SOCKS5 最稳的姿势
        const context = await browser.newContext({
            proxy: proxyConfig ? proxyConfig : undefined,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
            viewport: { width: 1280, height: 720 },
            locale: 'es-ES',
            timezoneId: 'Europe/Madrid'
        });

        const page = await context.newPage();

        // 抹除自动化特征
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        // --- 4. 代理 IP 检测（带熔断保护，防止代理失效走直连被封号） ---
        if (proxyConfig) {
            console.log("🌍 [Step 1] 正在验证代理出口 IP...");
            try {
                await page.goto("https://api.ipify.org?format=json", { timeout: 30000, waitUntil: 'networkidle' });
                const ipBody = await page.innerText('body');
                const ipInfo = JSON.parse(ipBody);
                console.log(`✅ 当前出口 IP: ${ipInfo.ip}`);
            } catch (e) {
                console.error(`❌ 代理检测失败: ${e.message}`);
                await sendTelegramMessage(`🚨 <b>GreatHost 代理异常</b>\n原因: 无法通过代理连接网络`);
                throw new Error("Proxy Check Failed"); 
            }
        }

        // --- 5. 登录流程（恢复你原始的详细步骤） ---
        console.log("🔑 [Step 2] 正在访问登录页面...");
        await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
        await page.fill('input[name="email"]', EMAIL);
        await page.fill('input[name="password"]', PASSWORD);
        console.log("📡 提交登录表单...");
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: "networkidle" }),
        ]);
        
        if (page.url().includes('login')) {
            throw new Error("登录失败：账号或密码错误，或触发了验证码");
        }
        console.log("✅ 登录成功！");

        // --- 6. 首页开机检查（恢复你原始的离线自动开机逻辑） ---
        console.log("📊 [Step 3] 检查服务器实时状态...");
        await page.goto(HOME_URL, { waitUntil: "networkidle" });
        const offlineIndicator = page.locator('span.badge-danger, .status-offline').first();
        if (await offlineIndicator.isVisible()) {
            console.log("⚠️ 检测到服务器处于离线状态，尝试发送启动指令...");
            const startBtn = page.locator('button:has-text("Start"), .btn-start').first();
            if (await startBtn.isVisible()) {
                await startBtn.click();
                serverStarted = true;
                console.log("⚡ 启动指令已发送，等待 3 秒同步...");
                await page.waitForTimeout(3000);
            }
        } else {
            console.log("🟢 服务器当前在线，无需操作。");
        }

        // --- 7. 续期主流程（恢复你原始的报表生成和点击逻辑） ---
        console.log("🔍 [Step 4] 进入免费服务器管理页面...");
        await page.goto(BILLING_URL, { waitUntil: "networkidle" });

        console.log("🖱️ 点击 View Details 进入详情页...");
        await page.getByRole('link', { name: 'View Details' }).first().click();
        await page.waitForNavigation({ waitUntil: "networkidle" });
        
        const serverId = page.url().split('/').pop() || '未知ID';
        const timeSelector = '#accumulated-time';

        // 获取续期前时长
        const beforeHoursText = await page.textContent(timeSelector);
        const beforeHours = parseInt(beforeHoursText.replace(/[^0-9]/g, '')) || 0;

        const renewBtn = page.locator('#renew-free-server-btn');
        const btnContent = await renewBtn.innerHTML();

        // 恢复你原始的 HTML 报告函数
        const generateReport = (icon, title, hours, detail) => {
            return `${icon} <b>GreatHost ${title}</b>\n\n` +
                   `🆔 <b>服务器ID:</b> <code>${serverId}</code>\n` +
                   `⏰ <b>当前累计时长:</b> ${hours} 小时\n` +
                   `🚀 <b>开机自启动:</b> ${serverStarted ? '✅ 已触发' : '无需操作'}\n` +
                   `🌐 <b>连接模式:</b> ${proxyStatusTag}\n` + 
                   `💡 <b>详情:</b> ${detail}`;
        };

        // 检查冷却状态
        if (btnContent.includes('Wait')) {
            const waitMatch = btnContent.match(/\d+/);
            const waitTime = waitMatch ? waitMatch[0] : "??";
            console.log(`⏳ 续期冷却中，还需等待 ${waitTime} 分钟。`);
            await sendTelegramMessage(generateReport('⏳', '续期任务跳过', beforeHours, `目前处于冷却期，还需等待 ${waitTime} 分钟。`));
            return;
        }

        // 执行续期点击
        console.log("⚡ [Step 5] 满足续期条件，正在执行点击...");
        await page.mouse.wheel(0, 350); // 模拟人类滚动
        await page.waitForTimeout(2000);
        await renewBtn.click({ force: true });

        // 校验结果
        console.log("⏳ 等待 20 秒处理服务器端延时...");
        await page.waitForTimeout(20000);
        await page.reload();
        
        const afterHoursText = await page.textContent(timeSelector);
        const afterHours = parseInt(afterHoursText.replace(/[^0-9]/g, '')) || 0;

        if (afterHours > beforeHours) {
            console.log(`🎉 续期成功！时长增加至 ${afterHours}h`);
            await sendTelegramMessage(generateReport('🎉', '续期成功通知', afterHours, `时长已从 ${beforeHours}h 成功提升！`));
        } else {
            console.log("✅ 时长未变化，可能已处于最大值。");
            await sendTelegramMessage(generateReport('✅', '续期检查完成', afterHours, '当前时长已充足，无需进一步操作。'));
        }

    } catch (err) {
        console.error("❌ 脚本运行崩溃:", err);
        if (err.message !== "Proxy Check Failed") {
            await sendTelegramMessage(`🚨 <b>GreatHost 脚本执行失败</b>\n错误信息: <code>${err.message}</code>`);
        }
    } finally {
        if (browser) {
            console.log("🧹 正在关闭浏览器，释放资源...");
            await browser.close();
        }
        console.log("🏁 任务结束。");
    }
})();
