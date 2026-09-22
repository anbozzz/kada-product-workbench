import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const sandboxMessage = '真实浏览器旅程不能在 Codex seatbelt 沙箱内启动。请直接以 require_escalated 运行 npm run verify；不要先在沙箱内试跑，否则 Chromium 会被 macOS 强制中止。';

export function assertBrowserAutomationAllowed(environment = process.env) {
  if (environment.CODEX_SANDBOX === 'seatbelt') throw new Error(sandboxMessage);
}

export async function launchHeadlessBrowser() {
  assertBrowserAutomationAllowed();
  const executablePath = chromium.executablePath();
  try {
    await access(executablePath, constants.X_OK);
  } catch {
    throw new Error(`缺少与 playwright-core 匹配的无界面 Chromium。请先运行 npx playwright install chromium-headless-shell。\n预期位置：${executablePath}`);
  }
  return chromium.launch({ headless: true });
}
