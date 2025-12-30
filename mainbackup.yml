const EMAIL = process.env.GREATHOST_EMAIL || 'zhangbin0301@qq.com';  // greathost邮箱必填
const PASSWORD = process.env.GREATHOST_PASSWORD || '987277984';  // greathost密码必填
const CHAT_ID = process.env.CHAT_ID || '558914831';     // tg_chat_id 消息推送配置可选,须同时填写telegram bot token
const BOT_TOKEN = process.env.BOT_TOKEN || '5824972634:AAGJG-FBAgPljwpnlnD8Lk5Pm2r1QbSk1AI'; // telegram bot token

const { chromium } = require("playwright");
const https = require('https');

// Telegram发送消息函数
async function sendTelegramMessage(message) {
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(url, options, (res) => {
      let response = '';
      res.on('data', (chunk) => {
        response += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ Telegram通知发送成功');
          resolve(response);
        } else {
          console.log('⚠️ Telegram通知发送可能失败:', response);
          resolve(response); // 不拒绝，避免影响主流程
        }
      });
    });

    req.on('error', (error) => {
      console.log('⚠️ Telegram通知发送错误:', error.message);
      resolve(); // 不拒绝，避免影响主流程
    });

    req.write(data);
    req.end();
  });
}

(async () => {
  const GREATHOST_URL = "https://greathost.es";
  const LOGIN_URL = `${GREATHOST_URL}/login`;
  const HOME_URL = `${GREATHOST_URL}/dashboard`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // === 登录 ===
    console.log("🔑 打开登录页：", LOGIN_URL);
    await page.goto(LOGIN_URL, { waitUntil: "networkidle" });

    await page.fill('input[name="email"]', EMAIL);
    console.log("填写邮箱成功");
    await page.fill('input[name="password"]', PASSWORD);
    console.log("填写密码成功");

    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle" }),
    ]);
    console.log("登录成功！");
    await page.waitForTimeout(5000);

    // === 跳转 dashboard ===
    console.log("📄 打开首页：", HOME_URL);
    await page.goto(HOME_URL, { waitUntil: "networkidle" });
    await page.waitForTimeout(5000);

    // === 查找并点击Manage按钮 ===
    console.log("🔍 查找服务器卡片中的Manage按钮...");
    const manageButton = await page.waitForSelector('div.server-card div.server-actions a.btn.btn-primary:has-text("Manage")');
    
    // 点击按钮并等待导航
    await Promise.all([
      manageButton.click(),
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 })
    ]);
    
    console.log("✅ 成功点击Manage按钮");

    // === 获取服务器状态和ID ===
    console.log("📊 检查服务器状态...");
    
    let serverId, serverStatus;
    
    // 从URL中提取ID
    const currentUrl = page.url();
    const urlMatch = currentUrl.match(/[?&]id=([^&]+)/);
    serverId = urlMatch ? urlMatch[1] : 'unknown';
    
    // 获取服务器状态
    serverStatus = await page.$eval('span#server-status-detail', el => el.textContent.toLowerCase()).catch(() => 'unknown');
    
    console.log(`服务器ID: ${serverId}`);
    console.log(`服务器状态: ${serverStatus}`);

    // === 如果服务器离线则启动 ===
    let serverStarted = false;
    if (serverStatus.includes('offline') || serverStatus.includes('stopping') || serverStatus.includes('stop')) {
      console.log("⚡ 服务器离线或停止中，尝试启动...");
      
      // 导航到控制台页面
      const consoleUrl = `https://greathost.es/server-console.html?id=${serverId}`;
      console.log("📄 导航到控制台页面:", consoleUrl);
      await page.goto(consoleUrl, { waitUntil: "networkidle" });
      
      // 点击启动按钮
      console.log("🖱️ 点击Start按钮...");
      const startButton = await page.waitForSelector('button:has-text("Start")');
      await startButton.click();
      
      // 等待服务器启动
      console.log("⏳ 等待服务器启动...");
      await page.waitForTimeout(5000);
      
      console.log("✅ 启动命令已发送");
      serverStarted = true;
    } else {
      console.log("✅ 服务器已在运行状态");
    }

    // === 跳转到合约页面续期 ===
    const contractUrl = `https://greathost.es/contracts/${serverId}`;
    console.log("📄 打开合约续期页：", contractUrl);
    await page.goto(contractUrl, { waitUntil: "networkidle" });

    // === 获取续期前的时间 ===
    console.log("📊 检查续期前的累计时间...");
    const beforeHours = await page.$eval('#accumulated-time', el => parseInt(el.textContent));
    console.log(`当前累计时间: ${beforeHours} 小时`);

    // === 点击续期按钮 ===
    console.log("⚡ 尝试点击续期按钮...");
    await page.click('button:has-text("续期"), button:has-text("Renew")');
    console.log("✅ 成功点击续期按钮");

    // === 等待页面刷新并检查时间变化 ===
    await page.waitForTimeout(3000);
    
    const afterHours = await page.$eval('#accumulated-time', el => parseInt(el.textContent));
    console.log(`续期后累计时间: ${afterHours} 小时`);

    if (afterHours > beforeHours) {
      console.log("🎉 续期成功！累计时间已增加");
      
      // 发送Telegram通知
      const message = `🎉 <b>GreatHost 服务器续期成功</b>\n\n` +
                     `🆔 <b>服务器ID:</b> <code>${serverId}</code>\n` +
                     `⏰ <b>续期前时间:</b> ${beforeHours} 小时\n` +
                     `⏰ <b>续期后时间:</b> ${afterHours} 小时\n` +
                     `🔄 <b>增加时间:</b> ${afterHours - beforeHours} 小时\n` +
                     `🚀 <b>服务器状态:</b> ${serverStarted ? '已启动' : '已在运行'}\n` +
                     `📅 <b>续期时间:</b> ${new Date().toLocaleString('zh-CN')}`;
      
      await sendTelegramMessage(message);
      
      await browser.close();
      process.exit(0);
    } else {
      console.error("⚠️ 续期可能失败，累计时间未增加");
      
      // 发送失败通知
      const message = `⚠️ <b>GreatHost 服务器续期失败</b>\n\n` +
                     `🆔 <b>服务器ID:</b> <code>${serverId}</code>\n` +
                     `⏰ <b>当前时间:</b> ${beforeHours} 小时\n` +
                     `📅 <b>检查时间:</b> ${new Date().toLocaleString('zh-CN')}\n` +
                     `💡 <b>提示:</b> 累计时间未增加，可能还没到续期时间`;
      
      await sendTelegramMessage(message);
      
      await page.screenshot({ path: "renew-fail.png" });
      await browser.close();
      process.exit(3);
    }

  } catch (err) {
    console.error("❌ 脚本出错：", err);
    
    // 发送错误通知
    const message = `🚨 <b>GreatHost 自动化脚本出错</b>\n\n` +
                   `❌ <b>错误信息:</b> <code>${err.message}</code>\n` +
                   `📅 <b>发生时间:</b> ${new Date().toLocaleString('zh-CN')}\n` +
                   `💡 <b>提示:</b> 请检查脚本运行状态`;
    
    await sendTelegramMessage(message);
    
    await page.screenshot({ path: "renew-error.png" });
    await browser.close();
    process.exit(2);
  }
})();
