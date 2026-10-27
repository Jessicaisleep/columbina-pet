/** Local-only settings shell; external same-origin assets keep CSP free of unsafe-inline. */
export const settingsPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>桌宠 AI 设置</title><link rel="stylesheet" href="/standalone-ai/settings.css">
<script src="/standalone-ai/settings.js" defer></script></head><body>
<main><header><span class="fish" aria-hidden="true">🐾</span><p class="local">独立桌宠 / 本机设置</p>
<h1>桌宠 AI 设置</h1><p class="intro">配置你的大模型 API 接口，写宠物人设，查看对话历史。<br>所有设置仅保存在本机，支持即时测试连接。</p></header>
<nav class="tabs" role="tablist"><button id="tab-settings" type="button" role="tab" aria-controls="panel-settings" aria-selected="true" class="tab is-active">模型与人设</button><button id="tab-history" type="button" role="tab" aria-controls="panel-history" aria-selected="false" class="tab">对话历史</button><button id="tab-runs" type="button" role="tab" aria-controls="panel-runs" aria-selected="false" class="tab">助手记录</button></nav>
<div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
<form id="settings" aria-describedby="privacy">
<fieldset><legend>模型连接</legend>
<label for="protocol">接口协议</label><select id="protocol" name="protocol"><option value="openai-compatible">OpenAI 兼容</option><option value="anthropic">Anthropic</option></select>
<label for="baseUrl">接口地址（Base URL）</label><input id="baseUrl" name="baseUrl" type="url" placeholder="https://example.com/v1" maxlength="2048" spellcheck="false" aria-describedby="endpoint-note"><p class="hint" id="endpoint-note">填写服务商提供的基础接口地址（支持 HTTP 与 HTTPS，通常以 /v1 结尾）。不要把密钥放进地址。</p>
<label for="model">模型名称</label><input id="model" name="model" type="text" maxlength="200" placeholder="填写服务商的模型 ID，例如 deepseek-chat" spellcheck="false">
<div class="key-heading"><label for="apiKey">API 密钥</label><span id="key-state" class="hint">尚未读取</span></div>
<input id="apiKey" name="apiKey" type="password" autocomplete="new-password" maxlength="8192" placeholder="留空保留已保存的密钥" aria-describedby="key-note">
<p id="key-note" class="hint">密钥只写入本机配置，不会回显。留空不会删除旧密钥。</p>
<label class="check clear"><input id="clearApiKey" type="checkbox">清除已保存的密钥，并关闭 AI</label>
<label class="check enabled"><input id="enabled" type="checkbox">启用 AI 对话</label>
<div class="test-row"><button id="test-btn" type="button">测试连接</button><span id="test-result" class="test-result" role="status" aria-live="polite"></span></div>
</fieldset>
<fieldset><legend>宠物人设卡</legend>
<p class="hint" id="persona-lead">选一只宠物，写它的人设（性格、说话方式、称呼、底线）。这段会作为 system prompt 的第一段，后面自动接上“你的名字是…”、当前时间与记忆摘要。</p>
<div class="pair"><div><label for="persona-pet">宠物</label><select id="persona-pet" aria-describedby="persona-lead"></select></div>
<div><label for="persona-count">当前字数</label><input id="persona-count" type="text" readonly tabindex="-1" value="0 字"></div></div>
<label for="persona">人设（留空 = 沿用所属条目的默认人设）</label>
<textarea id="persona" rows="12" spellcheck="false" placeholder="例：你是蓝毛小女仆，一位嗓音柔软、说话慢半拍的女仆。喜欢用短句，偶尔冒出一点坏心思，但从不真的刻薄。称呼对方为「主人」。" aria-describedby="persona-hint"></textarea>
<p id="persona-hint" class="hint">留空保存 = 删除这只宠物自己的覆盖，回落到所属条目的默认人设。<strong>不设字数上限</strong>——想写多长都行，代价是每次说话都多花相应 token，这个权衡由你自己把握。</p>
<div class="test-row"><button id="persona-save" type="button">保存人设</button><span id="persona-result" class="test-result" role="status" aria-live="polite"></span></div>
<details class="preview"><summary>查看最终生效的 system prompt</summary><pre id="persona-preview" class="pre"></pre></details>
</fieldset>
<fieldset><legend>宠物位置</legend>
<p class="hint" id="pin-lead">选一只宠物，把它<b>钉在当前屏幕位置</b>。固定后：拖拽不跟手、松手不抛掷、不会自己走开、也不会被别的宠物撞飞——<b>动画、点击回应、碎碎念、对话全部照常</b>（只锁位置，不锁功能）。</p>
<div class="pair"><div><label for="pin-pet">宠物</label><select id="pin-pet" aria-describedby="pin-lead"></select></div>
<div><label for="pin-state">当前状态</label><input id="pin-state" type="text" readonly tabindex="-1" value="读取中…"></div></div>
<label class="check"><input id="pin-enabled" type="checkbox">固定位置（钉在保存时的中心点）</label>
<p class="hint" id="pin-hint">勾选后保存，宠物会钉在它<b>此刻</b>所在的位置（中心点按屏幕比例记，换分辨率也不会跑飞）。想换位置就先取消固定、拖到新地方、再勾选保存。也可以直接在桌宠上右键 →「固定位置」——那条路更快，效果与这里完全一致。</p>
<div class="test-row"><button id="pin-save" type="button">保存位置设置</button><span id="pin-result" class="test-result" role="status" aria-live="polite"></span></div>
</fieldset>
<fieldset><legend>定时自动碎碎念</legend>
<label class="check"><input id="automaticWhispers" type="checkbox" aria-describedby="cost">开启自动碎碎念</label>
<p id="cost" class="notice">开启后，桌宠会按设定间隔定时调用模型并在桌面上说话冒泡（产生 API 费用）。默认关闭；右键菜单中的手动对话与手动碎碎念不受此开关限制。</p>
<div class="pair"><div><label for="whisperIntervalSec">碎碎念间隔（秒）</label><input id="whisperIntervalSec" type="number" min="60" max="86400" step="1" value="300" required></div>
<div><label for="maxTokens">单次输出上限（tokens）</label><input id="maxTokens" type="number" min="128" max="4096" step="1" value="1024" required></div></div>
<p class="hint">间隔至少 60 秒，默认 300 秒。输出上限越小，单次回复越简短。</p>
</fieldset>
<fieldset><legend>读屏（看你在做什么）</legend>
<p class="hint" id="screen-lead">打开后，桌宠说话前会读一次你当前窗口里的可见文字——比如你在看视频、读网页、写代码，它的碎碎念和回答就能接上你在做的事。只读文字，<b>不截图、不读剪贴板、不记录键盘输入</b>。</p>
<label class="check"><input id="screenContextEnabled" type="checkbox" aria-describedby="screen-lead screen-warn">让桌宠读取当前屏幕内容</label>
<p class="notice" id="screen-warn">隐私提醒：读到的文字会随请求发给你配置的 AI 服务商。介意就别打开。读不到时功能自动跳过，不影响桌宠正常说话。</p>
<label for="screenExcludePatterns">不读取这些窗口（每行一个关键词，标题含它就跳过）</label>
<textarea id="screenExcludePatterns" rows="3" spellcheck="false" placeholder="1Password&#10;Bitwarden&#10;招商银行&#10;微信" aria-describedby="exclude-hint"></textarea>
<p id="exclude-hint" class="hint">大小写不敏感，最多 40 条。把密码管理器、银行、私人聊天填进来。留空 = 不排除任何窗口。</p>
<div class="test-row"><button id="screen-save" type="button">保存读屏设置</button><span id="screen-result" class="test-result" role="status" aria-live="polite"></span></div>
</fieldset>
<fieldset><legend>AI 助手（让桌宠帮你干活）</legend>
<p class="hint" id="assistant-lead">打开后，你在对话里让它做的事它就会<b>真的动手</b>——不再是只会聊天的桌宠，而是带桌宠人格的助手。<b>思考与操作过程你看不到</b>，只看到它做完之后用自己人设说的那一两句话。</p>
<label class="check"><input id="assistantEnabled" type="checkbox" aria-describedby="assistant-lead assistant-cando">启用 AI 助手</label>
<div class="cando" id="assistant-cando">
<p class="cando-title">它具体能做什么</p>
<ul>
<li><b>看文件、读代码</b>：列出工作区目录、读取文本文件（每次最多 8 KB）、按文件名或内容搜索。</li>
<li><b>写文件、改文件</b>：新建/覆盖/追加文本文件，自动创建需要的子目录。</li>
<li><b>查资料</b>：联网搜索（返回标题与链接），或抓取某个网页的正文（最多 6000 字）。</li>
<li><b>连着做多步</b>：比如「把这几个文件里的待办汇总成一个清单」，它会自己读、自己写，最多 8 步。</li>
</ul>
<p class="cando-no">它<b>不能</b>：执行命令行程序、操作其他软件、看你的密码或剪贴板、绕过下面的权限限制。<br>它做事的过程你看不到（只有一个转圈提示），做完才用人设口吻回你一句话——这是刻意的：助手是来干活的，不是来念操作日志的。</p>
</div>
<label for="assistantPermission">权限（决定它能改哪里）</label>
<select id="assistantPermission" aria-describedby="perm-hint">
<option value="readonly">只读 — 能看文件和联网查资料，不能写任何文件（推荐先用这个）</option>
<option value="workspace">工作区内修改 — 能改它自己工作区里的文件，越界要你单独批准</option>
<option value="full">完全权限 — 任意路径读写（危险，谨慎使用）</option>
</select>
<p id="perm-hint" class="hint">越权动作不会静默失败：会在这里弹出「它想改某个文件」等你点允许，批准只放行这一次、这一个路径。改档位会让此前所有批准立即失效。</p>
<label class="check"><input id="assistantNetworkEnabled" type="checkbox">允许助手联网（搜索与抓网页）</label>
<p class="hint" id="workspace-note">工作区目录：<span id="workspace-list">读取中…</span></p>
<div class="test-row"><button id="assistant-save" type="button">保存助手设置</button><span id="assistant-result" class="test-result" role="status" aria-live="polite"></span></div>
<div id="approvals" class="approvals" hidden><h3>待批准的越权动作</h3><ul id="approval-list"></ul></div>
</fieldset>
<footer><p id="privacy">所有配置与密钥仅保存在当前机器。<br>关闭 AI 后，桌宠仍可正常显示、移动与互动。</p><button id="save" type="submit" disabled>保存到本机</button></footer>
<p id="status" role="status" aria-live="polite">正在读取本机设置…</p>
</form></div>
<div id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden>
<section class="history">
<div class="history-head"><div class="pair"><div><label for="history-pet">宠物</label><select id="history-pet"></select></div>
<div><label for="history-limit">每页条数</label><select id="history-limit"><option value="100">100</option><option value="200" selected>200</option><option value="500">500</option><option value="1000">1000</option></select></div></div>
<div class="test-row"><button id="history-load" type="button">重新读取</button><span id="history-result" class="test-result" role="status" aria-live="polite"></span></div></div>
<div class="memory-card"><h2>压缩后摘要</h2><p id="memory-meta" class="hint">—</p><pre id="memory-summary" class="pre">（还没有生成过摘要）</pre></div>
<h2>压缩前原文</h2><p class="hint" id="history-note">灰色的条目是已经被压缩进上面那段摘要的部分；正常色的条目还在上下文窗口里。</p>
<ol id="history-list" class="msgs"></ol>
<div class="test-row"><button id="history-more" type="button" disabled>加载更早的消息</button></div>
</section></div>
<div id="panel-runs" role="tabpanel" aria-labelledby="tab-runs" hidden>
<section class="history">
<div class="history-head"><div class="pair"><div><label for="runs-limit">显示条数</label><select id="runs-limit"><option value="50">50</option><option value="100" selected>100</option><option value="300">300</option><option value="1000">1000</option></select></div>
<div><label for="runs-filter">只看</label><select id="runs-filter"><option value="all" selected>全部</option><option value="ok">成功的</option><option value="blocked">被权限拦下的</option><option value="failed">失败的</option></select></div></div>
<div class="test-row"><button id="runs-load" type="button">重新读取</button><button id="runs-clear" type="button" class="danger">清空记录</button><span id="runs-result" class="test-result" role="status" aria-live="polite"></span></div></div>
<p class="hint" id="runs-note">这里记的是<b>助手每一次动手的留痕</b>：你让它做什么、它调用了哪些工具、动了哪个路径、成没成、最后回了什么。记录存在本机 <code>data/dsh-pet/assistant-history.jsonl</code>，只保留最近若干条，<b>不记文件正文内容</b>。</p>
<ol id="runs-list" class="msgs runs"></ol>
<div class="test-row"><span id="runs-count" class="hint"></span></div>
</section></div>
<noscript>需要启用 JavaScript 才能保存设置。请从桌宠菜单打开本页。</noscript></main></body></html>`;

export const settingsStyle = `
:root{color-scheme:light;--ink:#203b4b;--muted:#526a78;--blue:#12618b;--line:#cbdce5;--paper:#fff;--water:#edf5fa}
*{box-sizing:border-box}body{margin:0;background:var(--water);color:var(--ink);font:16px/1.6 "Microsoft YaHei UI","PingFang SC",sans-serif}
main{max-width:720px;margin:48px auto;padding:0 24px 32px}header{padding:0 12px 28px}.fish{display:block;font:700 29px/1.3 Georgia,serif;color:var(--blue);letter-spacing:2px;margin-bottom:24px}.local{font-size:13px;color:var(--muted);margin:0 0 10px}h1{font-size:32px;line-height:1.3;letter-spacing:-1px;margin:0 0 16px;font-weight:700}.intro{margin:0;color:var(--muted)}
form,.tabs,.history{background:var(--paper);border:1px solid var(--line);border-radius:16px 16px 6px 6px;padding:28px 32px 20px}
.tabs{display:flex;gap:8px;padding:10px 12px;border-radius:10px;margin:0 0 18px;background:#f5fafd}
.tab{border:0;background:transparent;color:var(--muted);min-height:40px;padding:6px 16px;border-radius:7px;font:600 15px/1.4 inherit;cursor:pointer}
.tab.is-active{background:var(--blue);color:#fff}.tab:not(.is-active):hover{background:#e3eff7;color:var(--blue)}
fieldset{padding:0 0 28px;margin:0 0 24px;border:0;border-bottom:1px solid var(--line);min-width:0}legend{font-size:19px;font-weight:700;margin-bottom:18px;padding:0}label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}input:not([type=checkbox]),select,textarea{display:block;width:100%;min-height:44px;border:1px solid #a5bdcb;border-radius:6px;background:#fff;color:var(--ink);padding:9px 12px;font:inherit;font-size:15px}textarea{min-height:220px;resize:vertical;line-height:1.7}input::placeholder,textarea::placeholder{color:#6a7e8b}input[type=checkbox]{accent-color:var(--blue);width:18px;height:18px;flex-shrink:0;margin:0}.check{display:flex;align-items:center;gap:10px;min-height:32px;cursor:pointer}.enabled{margin-top:24px}.clear{font-weight:400;color:var(--muted);font-size:13px}.hint{font-size:12px;line-height:1.6;color:var(--muted);margin:7px 0 0}.key-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.key-heading label{margin:0 0 6px}.key-heading .hint{margin:0 0 6px}.notice{font-size:13px;color:#704b13;background:#fff7e7;border-left:3px solid #c18e36;margin:12px 0 16px;padding:12px 14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}footer{display:flex;align-items:center;justify-content:space-between;gap:18px}footer p{font-size:12px;color:var(--muted);margin:0}button{border:0;border-radius:7px;min-height:44px;padding:10px 20px;background:var(--blue);color:#fff;font:600 15px/1.5 inherit;white-space:nowrap;cursor:pointer}button:hover{background:#0b4e73}button:disabled{opacity:.55;cursor:wait}:focus-visible{outline:3px solid #3a94c4;outline-offset:3px}#status{font-size:13px;min-height:24px;margin:18px 0 0;color:var(--blue)}#status[data-error=true]{color:#a13b30}
.test-row{display:flex;align-items:center;gap:14px;margin:20px 0 6px;flex-wrap:wrap}#test-btn,#persona-save,#history-load,#history-more{background:#fff;color:var(--blue);border:1.5px solid var(--blue);min-height:38px;padding:6px 18px;font-size:14px;border-radius:6px;cursor:pointer;font-weight:600}#test-btn:hover,#persona-save:hover,#history-load:hover,#history-more:hover{background:#edf5fa}#test-btn:disabled,#persona-save:disabled,#history-load:disabled,#history-more:disabled{opacity:.6;cursor:wait}.test-result{font-size:13px;line-height:1.5;min-height:22px;flex:1 1 200px}.test-success{color:#1a7f37;font-weight:600}.test-error{color:#cf222e}.reply-preview{display:block;color:var(--muted);font-weight:normal;font-size:12px;margin-top:4px;word-break:break-all}
.preview{margin:18px 0 0}.preview summary{font-size:13px;color:var(--blue);cursor:pointer;font-weight:600}.pre{white-space:pre-wrap;word-break:break-word;font:13px/1.7 "Consolas","Microsoft YaHei UI",monospace;background:#f7fbfd;border:1px solid var(--line);border-radius:6px;padding:12px 14px;margin:10px 0 0;max-height:340px;overflow:auto}
.history h2{font-size:16px;font-weight:700;margin:22px 0 6px}.memory-card{border:1px solid var(--line);border-radius:10px;padding:14px 18px 6px;background:#f7fbfd;margin:0 0 8px}.memory-card h2{margin-top:4px}.msgs{list-style:none;margin:10px 0 0;padding:0}.msgs li{border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:0 0 10px;background:#fff}.msgs li.is-summarized{background:#f6f8f9;border-style:dashed}.msgs li.is-summarized .msg-text{color:#7b8b96}.msg-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--muted);margin:0 0 5px}.msg-role{font-weight:700;color:var(--blue)}.msgs li.is-summarized .msg-role{color:#8ca0ad}.msg-text{white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.65}
@media(max-width:560px){main{margin:24px auto;padding:0 14px 24px}header{padding:0 8px 24px}h1{font-size:28px}form,.tabs,.history{padding:24px 20px 16px}.pair{grid-template-columns:1fr;gap:0}footer{align-items:stretch;flex-direction:column}button{width:100%}.fish{margin-bottom:18px}.tab{width:auto}}
.cando{background:#f7fbfd;border:1px solid var(--line);border-radius:8px;padding:12px 16px 6px;margin:12px 0 4px}
.cando-title{font-size:14px;font-weight:700;margin:0 0 8px;color:var(--blue)}
.cando ul{margin:0 0 10px;padding-left:20px;font-size:14px;line-height:1.75}
.cando li{margin:0 0 6px}.cando-no{font-size:13px;line-height:1.7;color:var(--muted);margin:0 0 10px}
.approvals{margin:18px 0 0;border:1px solid #e0b04a;background:#fff9ec;border-radius:8px;padding:12px 16px 4px}
.approvals h3{font-size:14px;font-weight:700;margin:0 0 10px;color:#8a5a06}
.approvals ul{list-style:none;margin:0;padding:0}
.approvals li{border:1px solid #e8cf9a;border-radius:6px;background:#fff;padding:10px 12px;margin:0 0 10px;font-size:13px;line-height:1.6}
.approvals .ap-target{font-family:Consolas,monospace;font-size:12px;word-break:break-all;color:#33424d;background:#f4f7f9;border-radius:4px;padding:3px 6px;display:block;margin:5px 0}
.approvals .ap-actions{display:flex;gap:10px;margin-top:8px}
.approvals button{min-height:32px;padding:4px 14px;font-size:13px;border-radius:5px}
.approvals .ap-allow{background:var(--blue);color:#fff;border:0}
.approvals .ap-deny{background:#fff;color:#a13b30;border:1.5px solid #d8a8a2}
.runs li .run-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:0 0 6px}
.runs .run-time{font-variant-numeric:tabular-nums}
.runs .run-pet{font-weight:700;color:var(--blue)}
.runs .run-badge{border-radius:4px;padding:1px 7px;font-size:11px;font-weight:700}
.runs .run-badge.is-ok{background:#e6f5ea;color:#1a7f37}
.runs .run-badge.is-blocked{background:#fff4e0;color:#8a5a06}
.runs .run-badge.is-failed{background:#fdeceb;color:#a13b30}
.runs .run-perm{background:#eef3f7;color:#4a5f6d;border-radius:4px;padding:1px 6px;font-size:11px}
.runs .run-ask{font-size:13px;margin:0 0 6px}
.runs .run-ask b{color:#333}
.runs .run-steps{list-style:none;margin:6px 0;padding:0;border-left:2px solid var(--line);padding-left:12px}
.runs .run-steps li{font-size:12px;line-height:1.6;margin:0 0 4px;padding:0;border:0;background:none}
.runs .run-steps .st-name{font-family:Consolas,monospace;font-weight:600;color:#33424d}
.runs .run-steps .st-ok{color:#1a7f37}.runs .run-steps .st-fail{color:#a13b30}
.runs .run-steps .st-args{color:#5b6f7c;word-break:break-all}
.runs .run-reply{font-size:13px;line-height:1.65;background:#f7fbfd;border-radius:5px;padding:7px 10px;margin:6px 0 0;white-space:pre-wrap;word-break:break-word}
#runs-clear.danger{background:#fff;color:#a13b30;border:1.5px solid #d8a8a2;min-height:38px;padding:6px 18px;font-size:14px;border-radius:6px;cursor:pointer;font-weight:600}
#runs-clear.danger:hover{background:#fdeceb}
`;

export const settingsScript = `
'use strict';
(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null, '', location.pathname);
  const get = id => document.getElementById(id);
  const form = get('settings');
  const status = get('status');
  const save = get('save');
  const testBtn = get('test-btn');
  const testResult = get('test-result');
  function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  async function request(method, body) {
    const response = await fetch('/standalone-ai/settings', {
      method, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'X-DSH-Pet-Token': token, ...(body ? {'Content-Type': 'application/json'} : {}) },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
      if (response.status === 429) throw new Error('保存过于频繁，请稍等一分钟再试。');
      throw new Error('设置未保存。请检查接口地址、模型名称与密钥，再重试。');
    }
    return response.json();
  }
  /** 直接打宿主的宠物路由（同源、带本次运行凭据）：人设卡与对话历史都走这里 */
  async function petRequest(path, method = 'GET', body) {
    const response = await fetch(path, {
      method, credentials: 'omit', cache: 'no-store',
      headers: { 'X-DSH-Pet-Token': token, ...(body ? {'Content-Type': 'application/json'} : {}) },
      ...(body ? {body: JSON.stringify(body)} : {})
    });
    if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
    if (!response.ok) throw new Error('本机接口返回 HTTP ' + response.status);
    return response.json();
  }
  function populate(data) {
    for (const id of ['protocol','baseUrl','model','whisperIntervalSec','maxTokens']) {
      if (data[id] !== undefined) get(id).value = String(data[id]);
    }
    for (const id of ['enabled','automaticWhispers']) get(id).checked = data[id] === true;
    get('key-state').textContent = data.hasKey ? '已保存 · 不回显' : '尚未设置';
    get('apiKey').value = '';
    get('clearApiKey').checked = false;
  }
  // ---------- 标签页 ----------
  const tabSettings = get('tab-settings');
  const tabHistory = get('tab-history');
  const tabRuns = get('tab-runs');
  function showTab(which) {
    const isHistory = which === 'history';
    const isRuns = which === 'runs';
    const isSettings = !isHistory && !isRuns;
    tabSettings.classList.toggle('is-active', isSettings);
    tabHistory.classList.toggle('is-active', isHistory);
    tabRuns.classList.toggle('is-active', isRuns);
    tabSettings.setAttribute('aria-selected', String(isSettings));
    tabHistory.setAttribute('aria-selected', String(isHistory));
    tabRuns.setAttribute('aria-selected', String(isRuns));
    get('panel-settings').hidden = !isSettings;
    get('panel-history').hidden = !isHistory;
    get('panel-runs').hidden = !isRuns;
    if (isHistory && !historyLoaded) void loadHistory(true);
    if (isRuns) void loadRuns();
  }
  tabSettings.addEventListener('click', () => showTab('settings'));
  tabHistory.addEventListener('click', () => showTab('history'));
  tabRuns.addEventListener('click', () => showTab('runs'));

  // ---------- 人设卡 ----------
  const petSelect = get('persona-pet');
  const personaBox = get('persona');
  const personaCount = get('persona-count');
  const personaResult = get('persona-result');
  const personaSave = get('persona-save');
  const personaPreview = get('persona-preview');
  let pets = [];
  function personaMessage(text, kind) {
    personaResult.className = 'test-result' + (kind ? ' ' + kind : '');
    personaResult.textContent = text;
  }
  function syncCount() { personaCount.value = String(personaBox.value.length) + ' 字'; }
  personaBox.addEventListener('input', syncCount);
  async function loadPersona() {
    if (!petSelect.value) return;
    personaSave.disabled = true;
    personaMessage('正在读取…');
    try {
      const data = await petRequest('/dsh-pet-7340/pet-persona?pet=' + encodeURIComponent(petSelect.value));
      if (!data.ok) throw new Error(data.message || data.reason || '读取失败');
      personaBox.value = data.persona || '';
      syncCount();
      personaPreview.textContent = data.system || '（空）';
      personaSave.disabled = false;
      personaMessage(data.persona ? '已读取这只宠物自己的人设。' : '这只宠物没有单独的人设，正沿用条目默认。');
    } catch (error) { personaMessage(error.message, 'test-error'); personaSave.disabled = false; }
  }
  petSelect.addEventListener('change', () => { void loadPersona(); });
  personaSave.addEventListener('click', async () => {
    if (!petSelect.value) return;
    personaSave.disabled = true;
    personaMessage('正在保存…');
    try {
      const data = await petRequest('/dsh-pet-7340/pet-persona?pet=' + encodeURIComponent(petSelect.value), 'POST', { persona: personaBox.value });
      if (!data.ok) throw new Error(data.message || data.reason || '保存失败');
      personaBox.value = data.persona || '';
      syncCount();
      personaPreview.textContent = data.system || '（空）';
      personaMessage(data.persona ? '已保存。桌宠下次说话就用这份人设。' : '已清空覆盖，回落到条目默认人设。', 'test-success');
    } catch (error) { personaMessage(error.message, 'test-error'); }
    finally { personaSave.disabled = false; }
  });

  // ---------- 对话历史 ----------
  const historyPet = get('history-pet');
  const historyLimit = get('history-limit');
  const historyList = get('history-list');
  const historyResult = get('history-result');
  const historyMore = get('history-more');
  const memoryMeta = get('memory-meta');
  const memorySummary = get('memory-summary');
  let historyLoaded = false;
  let historyTotal = 0;
  let historyOffset = 0;
  let historyRows = [];
  function historyMessage(text, kind) {
    historyResult.className = 'test-result' + (kind ? ' ' + kind : '');
    historyResult.textContent = text;
  }
  function fmtTime(ts) {
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '';
    // 记忆里的 ts 是毫秒（Date.now()），但也兼容秒级时间戳（< 1e12 视为秒）
    const d = new Date(ts < 1e12 ? ts * 1000 : ts);
    if (Number.isNaN(d.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function renderRows(rows, append) {
    if (!append) historyList.textContent = '';
    for (const row of rows) {
      const li = document.createElement('li');
      if (row.summarized) li.className = 'is-summarized';
      const head = document.createElement('p');
      head.className = 'msg-head';
      const role = document.createElement('span');
      role.className = 'msg-role';
      role.textContent = row.role === 'assistant' ? '桌宠' : row.role === 'user' ? '你' : (row.role || '未知');
      const meta = document.createElement('span');
      meta.textContent = [fmtTime(row.ts), row.summarized ? '已压缩' : ''].filter(Boolean).join(' · ');
      head.append(role, meta);
      const text = document.createElement('p');
      text.className = 'msg-text';
      text.textContent = row.content;
      li.append(head, text);
      historyList.appendChild(li);
    }
  }
  async function loadHistory(reset) {
    if (!historyPet.value) return;
    if (reset) { historyOffset = 0; historyRows = []; }
    historyMore.disabled = true;
    historyMessage('正在读取…');
    try {
      const limit = Number(historyLimit.value) || 200;
      const data = await petRequest('/dsh-pet-7340/chat/history?pet=' + encodeURIComponent(historyPet.value) + '&offset=' + historyOffset + '&limit=' + limit);
      if (!data.ok) throw new Error(data.message || data.reason || '读取失败');
      historyTotal = Number(data.total) || 0;
      historyRows = reset ? data.messages : historyRows.concat(data.messages);
      historyOffset = historyRows.length;
      renderRows(data.messages, !reset);
      const mem = data.memory || {};
      const sum = typeof mem.summary === 'string' ? mem.summary : '';
      memorySummary.textContent = sum || '（还没有生成过摘要）';
      memoryMeta.textContent = '已压缩 ' + (mem.summarized || 0) + ' / ' + (mem.total || 0) + ' 条' +
        (mem.summaryTs ? ' · 摘要生成于 ' + fmtTime(mem.summaryTs) : '') +
        (Number.isFinite(mem.pendingRounds) ? ' · 待压缩 ' + mem.pendingRounds + ' 轮' : '');
      historyMore.disabled = historyRows.length >= historyTotal;
      historyLoaded = true;
      historyMessage(historyTotal === 0 ? '这只宠物还没有对话记录。' : ('共 ' + historyTotal + ' 条，已显示 ' + historyRows.length + ' 条。'));
    } catch (error) { historyMessage(error.message, 'test-error'); historyMore.disabled = historyRows.length >= historyTotal; }
  }
  historyPet.addEventListener('change', () => { void loadHistory(true); });
  historyLimit.addEventListener('change', () => { void loadHistory(true); });
  get('history-load').addEventListener('click', () => { void loadHistory(true); });
  historyMore.addEventListener('click', () => { void loadHistory(false); });

  /** 宠物列表来自成品配置（与桌面端、浏览器端同一份） */
  async function loadPets() {
    try {
      const merged = await petRequest('/dsh-pet-7340/config');
      pets = [];
      for (const [entry, conf] of Object.entries(merged || {})) {
        const list = conf && Array.isArray(conf.pets) ? conf.pets : [];
        for (const pet of list) {
          if (!pet || !pet.id) continue;
          pets.push({ id: String(pet.id), name: String(pet.name || pet.id), entry });
        }
      }
    } catch { pets = []; }
    for (const select of [petSelect, historyPet, pinSelect]) {
      select.textContent = '';
      if (!pets.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '（没有读取到宠物）';
        select.appendChild(option);
        continue;
      }
      for (const pet of pets) {
        const option = document.createElement('option');
        option.value = pet.id;
        option.textContent = pet.name + (pet.entry === 'main' ? '' : '（' + pet.entry + '）');
        select.appendChild(option);
      }
    }
    if (pets.length) { void loadPersona(); void loadPin(); }
  }

   // ---------- 宠物位置（固定位置）----------
  const pinSelect = get('pin-pet');
  const pinEnabled = get('pin-enabled');
  const pinState = get('pin-state');
  const pinResult = get('pin-result');
  let pinLoaded = false;
  function pinMessage(text, kind) {
    pinResult.className = 'test-result' + (kind ? ' ' + kind : '');
    pinResult.textContent = text;
  }
  /** 读这只宠物当前的 pinned 状态（成品配置里读，与桌面端/浏览器端同一份） */
  async function loadPin() {
    if (!pinSelect.value) return;
    pinResult.textContent = '';
    pinEnabled.disabled = true;
    pinState.value = '读取中…';
    try {
      const merged = await petRequest('/dsh-pet-7340/config');
      let found = null;
      for (const conf of Object.values(merged || {})) {
        const list = conf && Array.isArray(conf.pets) ? conf.pets : [];
        const hit = list.find((p) => p && String(p.id) === pinSelect.value);
        if (hit) { found = hit; break; }
      }
      const pos = (found && found.position) || {};
      const isPinned = pos.pinned === true && Number.isFinite(Number(pos.pinX)) && Number.isFinite(Number(pos.pinY));
      pinEnabled.checked = isPinned;
      if (isPinned) {
        pinState.value = '已固定（' + (Number(pos.pinX) * 100).toFixed(1) + '%, ' + (Number(pos.pinY) * 100).toFixed(1) + '%）';
      } else {
        pinState.value = '未固定（跟角落配置走）';
      }
      pinLoaded = true;
    } catch (error) {
      pinState.value = '读取失败';
      pinMessage(error.message, 'test-error');
    } finally {
      pinEnabled.disabled = false;
    }
  }
  pinSelect.addEventListener('change', () => { void loadPin(); });
  pinEnabled.addEventListener('change', () => {
    // 只改本地勾选，等「保存位置设置」才落盘 —— 与下面所有卡片同一纪律：
    // 开关一拨就写盘会让"拨错了"没有反悔机会（这个页面其余开关也都是显式保存）。
    if (!pinLoaded) return;
    pinMessage('改了还没保存——点「保存位置设置」生效。');
  });
  get('pin-save').addEventListener('click', async () => {
    if (!pinSelect.value) return;
    const btn = get('pin-save');
    btn.disabled = true;
    pinMessage('正在保存…');
    try {
      // 只发 id + pinned：坐标由宿主自己取（优先桌面端实况上报的当前位置，
      // 退而用配置里上次固定的点）。设置页拿不到显示器几何，乱算一个比不给更糟。
      const data = await petRequest('/dsh-pet-7340/pet-pinned', 'POST', {
        id: pinSelect.value,
        pinned: pinEnabled.checked,
      });
      if (!data.ok) throw new Error(data.message || data.reason || '保存失败');
      await loadPin();
      pinMessage(pinEnabled.checked ? '已固定。桌宠会停在此刻的位置，不再跟着鼠标走。' : '已解除固定，宠物回到配置的角落。', 'test-success');
    } catch (error) { pinMessage(error.message, 'test-error'); }
    finally { btn.disabled = false; }
  });

  get('clearApiKey').addEventListener('change', () => {
    get('apiKey').disabled = get('clearApiKey').checked;
    if (get('clearApiKey').checked) {
      get('apiKey').value = '';
      get('enabled').checked = false;
      get('automaticWhispers').checked = false;
    }
  });
  if (testBtn && testResult) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testResult.className = 'test-result';
      testResult.textContent = '正在测试连接，请稍候…';
      const input = {
        protocol: get('protocol').value,
        baseUrl: get('baseUrl').value.trim(),
        model: get('model').value.trim(),
        apiKey: get('apiKey').value.trim(),
      };
      try {
        const response = await fetch('/standalone-ai/test', {
          method: 'POST',
          credentials: 'omit',
          cache: 'no-store',
          headers: {
            'X-DSH-Pet-Token': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });
        const data = await response.json();
        if (data.ok) {
          testResult.className = 'test-result test-success';
          testResult.textContent = '✓ ' + data.message;
          if (data.reply) {
            const preview = document.createElement('span');
            preview.className = 'reply-preview';
            preview.textContent = '回复: ' + data.reply;
            testResult.appendChild(preview);
          }
        } else {
          testResult.className = 'test-result test-error';
          testResult.textContent = '✗ ' + (data.message || data.error || '测试失败');
        }
      } catch (error) {
        testResult.className = 'test-result test-error';
        testResult.textContent = '✗ 请求异常：' + (error && error.message ? error.message : String(error));
      } finally {
        testBtn.disabled = false;
      }
    });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    save.disabled = true;
    message('正在保存到本机…');
    const input = {
      protocol: get('protocol').value, baseUrl: get('baseUrl').value.trim(), model: get('model').value.trim(),
      apiKey: get('apiKey').value, clearApiKey: get('clearApiKey').checked,
      enabled: get('enabled').checked, automaticWhispers: get('automaticWhispers').checked,
      whisperIntervalSec: Number(get('whisperIntervalSec').value), maxTokens: Number(get('maxTokens').value)
    };
    get('apiKey').value = '';
    try {
      populate(await request('POST', input));
      get('apiKey').disabled = false;
      message('已保存到本机。');
    } catch (error) { message(error.message, true); }
    finally { save.disabled = false; }
  });
  if (!token) { message('请从桌宠菜单或本机启动器打开设置，以获得本次运行的访问凭据。', true); return; }
  request('GET').then(data => { populate(data); save.disabled = false; message('设置只在本机保存。'); })
    .catch(error => message(error.message, true));
  void loadPets();

  // ---------- 读屏 + AI 助手 ----------
  const screenBox = get('screenContextEnabled');
  const excludeBox = get('screenExcludePatterns');
  const screenSave = get('screen-save');
  const screenResult = get('screen-result');
  const assistantBox = get('assistantEnabled');
  const permSelect = get('assistantPermission');
  const netBox = get('assistantNetworkEnabled');
  const assistantSave = get('assistant-save');
  const assistantResult = get('assistant-result');
  const workspaceList = get('workspace-list');
  const approvalsBox = get('approvals');
  const approvalList = get('approval-list');
  function note(el, text, kind) {
    el.className = 'test-result' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }
  async function loadAssistantSettings() {
    try {
      const data = await petRequest('/dsh-pet-7340/assistant/settings');
      if (!data.ok) throw new Error(data.message || data.reason || '读取失败');
      screenBox.checked = data.screenContextEnabled === true;
      excludeBox.value = (data.screenExcludePatterns || []).join('\\n');
      assistantBox.checked = data.assistantEnabled === true;
      permSelect.value = data.assistantPermission || 'readonly';
      netBox.checked = data.assistantNetworkEnabled !== false;
      const pets2 = data.pets || [];
      workspaceList.textContent = pets2.length
        ? pets2.map(p => (p.name || p.id) + ' → ' + p.workspace).join('　|　')
        : '（还没有宠物）';
      // 读屏不可用（缺 uia-reader.ps1）时禁用并说明
      if (data.screenAvailable === false) {
        screenBox.disabled = true;
        screenSave.disabled = true;
        note(screenResult, '这台机器上找不到读屏脚本，读屏暂时不可用。', 'test-error');
      }
    } catch (error) { note(screenResult, error.message, 'test-error'); }
  }
  screenSave.addEventListener('click', async () => {
    screenSave.disabled = true;
    note(screenResult, '正在保存…');
    try {
      const patterns = excludeBox.value.split('\\n').map(s => s.trim()).filter(s => s !== '');
      const data = await petRequest('/dsh-pet-7340/assistant/settings', 'POST', {
        screenContextEnabled: screenBox.checked,
        screenExcludePatterns: patterns,
      });
      if (!data.ok) throw new Error(data.message || data.reason || '保存失败');
      note(screenResult, screenBox.checked ? '已保存。桌宠说话前会读一次屏幕。' : '已保存。读屏已关闭。', 'test-success');
    } catch (error) { note(screenResult, error.message, 'test-error'); }
    finally { screenSave.disabled = false; }
  });
  assistantSave.addEventListener('click', async () => {
    assistantSave.disabled = true;
    note(assistantResult, '正在保存…');
    try {
      const data = await petRequest('/dsh-pet-7340/assistant/settings', 'POST', {
        assistantEnabled: assistantBox.checked,
        assistantPermission: permSelect.value,
        assistantNetworkEnabled: netBox.checked,
      });
      if (!data.ok) throw new Error(data.message || data.reason || '保存失败');
      note(assistantResult, assistantBox.checked ? '已保存。助手已启用，可以在对话里让它做事了。' : '已保存。助手已关闭，对话恢复成普通聊天。', 'test-success');
      void loadApprovals();
    } catch (error) { note(assistantResult, error.message, 'test-error'); }
    finally { assistantSave.disabled = false; }
  });
  /** 拉待审批列表：有内容才显示区块 */
  async function loadApprovals() {
    try {
      const data = await petRequest('/dsh-pet-7340/assistant/approvals');
      const items = (data && data.items) || [];
      approvalList.textContent = '';
      if (items.length === 0) { approvalsBox.hidden = true; return; }
      approvalsBox.hidden = false;
      for (const item of items) {
        const li = document.createElement('li');
        const head = document.createElement('div');
        head.textContent = (item.petId || '桌宠') + ' 想执行 ' + item.tool + '，被权限挡下了：';
        const target = document.createElement('span');
        target.className = 'ap-target';
        target.textContent = item.target;
        const why = document.createElement('div');
        why.textContent = item.message || '';
        const actions = document.createElement('div');
        actions.className = 'ap-actions';
        const allow = document.createElement('button');
        allow.type = 'button';
        allow.className = 'ap-allow';
        allow.textContent = '允许这一次';
        const deny = document.createElement('button');
        deny.type = 'button';
        deny.className = 'ap-deny';
        deny.textContent = '拒绝';
        allow.addEventListener('click', async () => {
          allow.disabled = true; deny.disabled = true;
          try {
            const r = await petRequest('/dsh-pet-7340/assistant/approvals', 'POST', { id: item.id, allow: true });
            if (!r.ok && !r.allowed) throw new Error(r.message || r.reason || '处理失败');
            note(assistantResult, r.ok ? '已允许，它重试完成了。' : ('已允许，但这次没成功：' + (r.message || r.reason || '')), r.ok ? 'test-success' : 'test-error');
          } catch (error) { note(assistantResult, error.message, 'test-error'); }
          void loadApprovals();
        });
        deny.addEventListener('click', async () => {
          allow.disabled = true; deny.disabled = true;
          try { await petRequest('/dsh-pet-7340/assistant/approvals', 'POST', { id: item.id, allow: false }); }
          catch (error) { note(assistantResult, error.message, 'test-error'); }
          void loadApprovals();
        });
        actions.appendChild(allow);
        actions.appendChild(deny);
        li.appendChild(head);
        li.appendChild(target);
        li.appendChild(why);
        li.appendChild(actions);
        approvalList.appendChild(li);
      }
    } catch { approvalsBox.hidden = true; }
  }
  void loadAssistantSettings();
  void loadApprovals();

  // ---------- 助手操作记录 ----------
  const runsList = get('runs-list');
  const runsResult = get('runs-result');
  const runsCount = get('runs-count');
  const runsLimit = get('runs-limit');
  const runsFilter = get('runs-filter');
  const runsLoad = get('runs-load');
  const runsClear = get('runs-clear');
  const RUN_STATUS_TEXT = { ok: '成功', blocked: '被拦下', failed: '失败' };
  function renderRuns(items) {
    runsList.textContent = '';
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = '还没有记录。助手每做一次事，这里就会多一条。';
      runsList.appendChild(li);
      return;
    }
    for (const r of items) {
      const li = document.createElement('li');
      const head = document.createElement('div');
      head.className = 'run-head';
      const t = document.createElement('span');
      t.className = 'run-time';
      t.textContent = fmtTime(r.ts);
      const pet = document.createElement('span');
      pet.className = 'run-pet';
      pet.textContent = r.petName || r.petId || '桌宠';
      const badge = document.createElement('span');
      const st = r.status === 'ok' ? 'ok' : r.status === 'blocked' ? 'blocked' : 'failed';
      badge.className = 'run-badge is-' + st;
      badge.textContent = RUN_STATUS_TEXT[st] || String(r.status);
      const perm = document.createElement('span');
      perm.className = 'run-perm';
      perm.textContent = '权限：' + (r.permission === 'readonly' ? '只读' : r.permission === 'workspace' ? '工作区内' : r.permission === 'full' ? '完全' : String(r.permission || '—'));
      const dur = document.createElement('span');
      dur.textContent = r.ms >= 0 ? '· ' + (r.ms / 1000).toFixed(1) + 's' : '';
      head.appendChild(t); head.appendChild(pet); head.appendChild(badge); head.appendChild(perm); head.appendChild(dur);
      li.appendChild(head);

      const ask = document.createElement('p');
      ask.className = 'run-ask';
      const askLabel = document.createElement('b');
      askLabel.textContent = '你让它做：';
      ask.appendChild(askLabel);
      ask.appendChild(document.createTextNode(r.userText || '（空）'));
      li.appendChild(ask);

      const steps = Array.isArray(r.steps) ? r.steps : [];
      if (steps.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'run-steps';
        for (const s of steps) {
          const sli = document.createElement('li');
          const nm = document.createElement('span');
          nm.className = 'st-name';
          nm.textContent = s.name;
          const mark = document.createElement('span');
          mark.className = s.ok ? 'st-ok' : 'st-fail';
          mark.textContent = s.ok ? ' ✓ ' : ' ✗ ';
          const args = document.createElement('span');
          args.className = 'st-args';
          args.textContent = s.args ? '(' + s.args + ')' : '';
          sli.appendChild(nm); sli.appendChild(mark); sli.appendChild(args);
          if (s.summary) {
            const sm = document.createElement('div');
            sm.className = 'st-args';
            sm.textContent = s.summary;
            sli.appendChild(sm);
          }
          ul.appendChild(sli);
        }
        li.appendChild(ul);
      }
      if (r.blockedTarget) {
        const bt = document.createElement('div');
        bt.className = 'st-args';
        bt.textContent = '被拦下的目标: ' + r.blockedTarget;
        li.appendChild(bt);
      }
      const reply = document.createElement('div');
      reply.className = 'run-reply';
      reply.textContent = r.reply || '（没有回复）';
      li.appendChild(reply);
      runsList.appendChild(li);
    }
  }
  async function loadRuns() {
    runsLoad.disabled = true;
    note(runsResult, '正在读取…');
    try {
      const limit = Number(runsLimit.value) || 100;
      const data = await petRequest('/dsh-pet-7340/assistant/history?limit=' + limit);
      if (!data.ok) throw new Error(data.message || '读取失败');
      const all = Array.isArray(data.items) ? data.items : [];
      const want = runsFilter.value;
      const items = want === 'all' ? all : all.filter(r => r.status === want);
      renderRuns(items);
      runsCount.textContent = '共 ' + (data.total || 0) + ' 条记录，当前显示 ' + items.length + ' 条（最多读最近 ' + limit + ' 条）';
      note(runsResult, '已读取。', 'test-success');
    } catch (error) { note(runsResult, error.message, 'test-error'); }
    finally { runsLoad.disabled = false; }
  }
  runsLoad.addEventListener('click', () => { void loadRuns(); });
  runsLimit.addEventListener('change', () => { void loadRuns(); });
  runsFilter.addEventListener('change', () => { void loadRuns(); });
  runsClear.addEventListener('click', async () => {
    if (!window.confirm('清空全部助手操作记录？此操作不可撤销。')) return;
    runsClear.disabled = true;
    try {
      const data = await petRequest('/dsh-pet-7340/assistant/history', 'DELETE');
      if (!data.ok) throw new Error(data.message || '清空失败');
      renderRuns([]);
      runsCount.textContent = '共 0 条记录';
      note(runsResult, '已清空。', 'test-success');
    } catch (error) { note(runsResult, error.message, 'test-error'); }
    finally { runsClear.disabled = false; }
  });
})();
`;
