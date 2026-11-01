/** Local-only settings shell; external same-origin assets keep CSP free of unsafe-inline. */
export const settingsPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>桌宠 AI 设置</title><link rel="stylesheet" href="/standalone-ai/settings.css">
<script src="/standalone-ai/settings.js" defer></script></head><body>
<main><header><span class="fish" aria-hidden="true">🐾</span><p class="local">独立桌宠 / 本机设置</p>
<h1>桌宠 AI 设置</h1><p class="intro">配置你的大模型 API 接口，写宠物人设，查看对话历史。<br>所有设置仅保存在本机，支持即时测试连接。</p></header>
<nav class="tabs" role="tablist"><button id="tab-settings" type="button" role="tab" aria-controls="panel-settings" aria-selected="true" class="tab is-active">模型与人设</button><button id="tab-history" type="button" role="tab" aria-controls="panel-history" aria-selected="false" class="tab">对话历史</button><button id="tab-runs" type="button" role="tab" aria-controls="panel-runs" aria-selected="false" class="tab">助手记录</button><button id="tab-backup" type="button" role="tab" aria-controls="panel-backup" aria-selected="false" class="tab">数据备份</button></nav>
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
<fieldset><legend>记忆（它记不记得你）</legend>
<p class="hint" id="memory-lead">桌宠会把你说的<b>稳定事实</b>（住在哪、养了什么、喜欢什么）记成一张小卡片，每次都带上；往事按关键词回捞。</p>
<label class="check"><input id="groupBotEnabled" type="checkbox" aria-describedby="memory-lead group-lead">启用群聊模式（Q 群机器人）</label>
<p class="hint" id="group-lead">不勾就是<b>纯单人桌宠</b>：只跟桌面上的你聊，一对一的陪伴。勾上之后，群里来的人按<b>各自分开</b>记，不会把甲的事安到乙头上；桌面端仍然是单人上下文——<b>两个入口互不串味</b>。</p>
<div id="group-box" hidden>
<label class="check"><input id="groupMemoryScope" type="radio" name="groupScope" value="everyone" aria-describedby="scope-hint">记得群里每个人</label>
<label class="check"><input id="groupMemoryScopeRecent" type="radio" name="groupScope" value="recent" aria-describedby="scope-hint">只记得最近说话的 N 个人</label>
<div class="pair"><div><label for="groupMemoryRecentN">N（1–100）</label><input id="groupMemoryRecentN" type="number" min="1" max="100" step="1" value="10" aria-describedby="scope-hint"></div></div>
<p class="hint" id="scope-hint">「只记得最近 N 个人」是<b>真的忘掉</b>：第 N+1 个人开口，最久没说话的那位就被移出记忆，下次他再说话宠物确实不认得他。要的是这个语义就别调太大。</p>
<div class="rule"></div><label class="check"><input id="ownerSyncEnabled" type="checkbox" aria-describedby="owner-hint">记住主人：我在群里的发言也算我的私聊记忆</label>
<div class="pair"><div><label for="ownerQq">我的 QQ 号</label><input id="ownerQq" type="text" inputmode="numeric" autocomplete="off" placeholder="例如 100012345" aria-describedby="owner-hint"></div></div>
<p class="hint" id="owner-hint">解决一个具体的痛点：你刚在群里说完话，回到桌面接着聊，它却像没听过。勾上并填对 QQ 号后，<b>只有你本人</b>在群里的发言会被额外记一份到单人记忆里，并自动标注是在哪个群说的；<b>群里别人的话不会进</b>——那不是你和它的私聊。它的群回复也不会被搬进单人记忆，不会伪造桌面上没说过的话。</p>
</div>
<div class="pair"><div><label for="memoryRecallK">每次回捞往事条数</label><input id="memoryRecallK" type="number" min="0" max="50" step="1" value="3" aria-describedby="recall-hint"></div></div>
<p class="hint" id="recall-hint">0 = 关闭检索。这是<b>上限</b>不是定额：命中几条就回填几条，多数问句只会命中 1~2 条，调大它只在档案很大时才用得上。</p>
<p class="notice" id="memory-warn">记忆全文保存在本机 <code>data/dsh-pet/memory.json</code>，不会因为压缩而删除原文。压缩只是把老对话写成一段摘要，不再每次全文发送。</p>
<div class="test-row"><button id="memory-save" type="button">保存记忆设置</button><span id="memory-result" class="test-result" role="status" aria-live="polite"></span></div>
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
<fieldset><legend>手机连接（让手机接着聊）</legend>
<p class="hint" id="mobile-lead">手机连上这台电脑后，读到的就是<b>同一份对话记忆</b>：电脑上聊到一半，拿起手机能接着聊；手机说完，回到电脑也接得上。电脑关机时手机连不上（AI 在电脑上跑），这是设计如此。</p>
<label class="check"><input id="mobile-enabled" type="checkbox" aria-describedby="mobile-lead mobile-warn">允许手机访问（局域网 / Tailscale）</label>
<p class="notice" id="mobile-warn">开启后服务会监听局域网地址，<b>但仍然需要令牌才能读任何数据</b>。只在你信任的网络里开；公共 Wi-Fi 下建议关掉。改动绑定地址需要重启桌宠才生效。</p>
<p class="hint" id="mobile-tls-hint">地址是 <b>https</b>（自签证书）。手机第一次打开会提示「连接不安全 / 证书不受信任」，选「高级」→「继续前往」即可，<b>不需要安装证书</b>。用 https 是因为手机浏览器只在安全页面里才给麦克风与语音识别 —— http 下语音功能整个不可用。</p>
<div class="pair"><div><label for="mobile-host">手机该填的地址</label><input id="mobile-host" type="text" readonly tabindex="-1" value="—"></div>
<div><label for="mobile-state">状态</label><input id="mobile-state" type="text" readonly tabindex="-1" value="—"></div></div>
<p class="hint" id="mobile-host-hint">没检测到局域网地址时，说明这台机器没连 Wi-Fi/网线，或者只连了虚拟网卡。</p>
<div class="test-row"><button id="mobile-save" type="button">保存手机连接设置</button><button id="mobile-pair" type="button">生成配对码</button><span id="mobile-result" class="test-result" role="status" aria-live="polite"></span></div>
<div id="mobile-pin-box" class="memory-card" hidden>
  <h2>配对码 <span id="mobile-pin" class="pin-code">------</span></h2>
  <p class="hint" id="mobile-pin-hint">在手机的桌宠 App 或浏览器里打开 <code id="mobile-pin-url">—</code>，填入上面的 6 位数字。5 分钟内有效，用过一次就作废。</p>
</div>
<div id="mobile-devices-box" class="memory-card" hidden>
  <h2>已配对的手机</h2>
  <p class="hint" id="mobile-devices-lead">手机连着这台电脑时，对话由<b>电脑</b>记（手机拿的是同一份）。手机不在这个网络后，电脑<b>转为只读</b>、由手机那边接着记，等它回到这个网络再自动合并回来——这样两边永远不会各写一套。</p>
  <ul id="mobile-devices" class="dev-list"></ul>
  <p class="hint" id="mobile-devices-hint">删掉一台手机 = 这台电脑立刻恢复可写，那台手机需要重新配对才能连。手机没电/忘带时，电脑会一直只读，直到它回来或你在这里删掉它。</p>
  <p class="hint dev-warn" id="mobile-takeover" hidden></p>
</div>
</fieldset>
<fieldset><legend>主动聊天（让它自己找你说话）</legend>
<p class="hint" id="proactive-lead">打开后，它<b>不用等你开口</b>，会按下面的间隔自己说一句——而且这一句<b>会记进对话记忆</b>：你回它一句，它接得上；换到手机上接着聊，它也知道自己昨天主动找过你。</p>
<label class="check"><input id="proactiveChatEnabled" type="checkbox" aria-describedby="proactive-lead proactive-hint">允许它主动找你说话</label>
<div class="pair"><div><label for="proactiveChatSec">间隔（秒，120–86400）</label><input id="proactiveChatSec" type="number" min="120" max="86400" step="60" value="1800" aria-describedby="proactive-hint"></div></div>
<p class="hint" id="proactive-hint">默认 1800 秒（半小时）。最短 120 秒，最长一天。间隔按<b>每只宠物</b>算，与「碎碎念」的周期是两套互不影响的设置。</p>
<p class="notice" id="proactive-warn">和「碎碎念」的区别：碎碎念是自言自语，<b>不进记忆</b>；主动聊天是真的开一轮对话，<b>会写进记忆</b>、会消耗一次对话额度。所以它更慢、更克制。</p>
<p class="hint" id="proactive-group-hint">群聊模式下，它会挑你<b>最近聊过</b>的那个群开口（三个月没动静的老群不会被突然问候）。群里只写进该群的记忆，不会污染你和它的私聊。<b>注意</b>：本机没有往 QQ 群发消息的通道，所以群聊里的主动发言只会出现在这台电脑的气泡里，需要你的群机器人自己来取。</p>
<div class="test-row"><button id="proactive-save" type="button">保存主动聊天设置</button><button id="proactive-test" type="button">现在试一句</button><span id="proactive-result" class="test-result" role="status" aria-live="polite"></span></div>
</fieldset>
<fieldset><legend>回话节奏（像真人那样分几条说）</legend>
<p class="hint" id="rhythm-lead">真人发消息很少把一长段话塞进一条：说一句、停一下、再补一句。打开下面的开关，它回答时会自己把话拆成 <b>1–3 条短句</b>，一条一条发出来（几个气泡先后出现，不是一次性刷出一大段）。</p>
<label class="check"><input id="chatSplitEnabled" type="checkbox" aria-describedby="rhythm-lead rhythm-hint">分条回复（把一段话拆成几条短句逐条发）</label>
<div class="pair"><div><label for="chatMergeWindowMs">合并窗口（毫秒，0–3000，0 = 不合并）</label><input id="chatMergeWindowMs" type="number" min="0" max="3000" step="100" value="800" aria-describedby="rhythm-hint"></div></div>
<p class="hint" id="rhythm-hint">合并窗口管的是<b>你这边</b>：你连着发好几条时，它会先攒这一小会儿（默认 800 毫秒）再一起理解、<b>只回一次</b>，不会一句一回把话说碎。填 0 = 关掉合并（发一条回一条）。代价：窗口越长，它开口越晚（最多晚这么久）。</p>
<p class="notice">两条硬保护不在这里配：一批最多合并 6 条、从你第一条起最多等 5 秒——一直打字也会回你。</p>
<div class="test-row"><button id="rhythm-save" type="button">保存回话节奏</button><span id="rhythm-result" class="test-result" role="status" aria-live="polite"></span></div>
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
<div id="panel-backup" role="tabpanel" aria-labelledby="tab-backup" hidden>
<section class="history">
<h2>导出备份</h2>
<p class="hint" id="backup-lead">把<b>全部用户状态</b>收成一个 JSON 文件：宠物配置（列表/位置/大小/动画池/人设）、全局开关、对话记忆。<br>换机器、重装、或者想给别人一份同样的配置时用它。<b>运行日志与助手操作记录不在备份里</b>（那是排查用的，不是你的配置）。</p>
<label class="check"><input id="backup-include-key" type="checkbox">同时导出 API 密钥（<b>风险：文件里会是明文</b>，只在给自己换机时勾）</label>
<p class="hint" id="backup-key-warn" hidden>勾了的话，导出的文件里 <code>apiKey</code> 是明文。别把它发给别人、别传到网盘或聊天工具。</p>
<div class="test-row"><button id="backup-export" type="button">导出到文件</button><span id="backup-export-result" class="test-result" role="status" aria-live="polite"></span></div>
<p class="hint" id="backup-export-detail"></p>

<h2 class="backup-h2">从备份恢复</h2>
<p class="hint">先选文件，会先<b>只读预览</b>会改哪些、新增哪些，你确认了才真的写盘。写入前旧文件会自动留一份 <code>.bak-before-import-时间戳</code> 副本，选错了可以拿回来。</p>
<div class="test-row"><input id="backup-file" class="backup-file" type="file" accept=".json,application/json"><button id="backup-preview" type="button">读取并预览</button><span id="backup-import-result" class="test-result" role="status" aria-live="polite"></span></div>
<div id="backup-plan" hidden>
  <p class="hint" id="backup-plan-meta"></p>
  <ul id="backup-plan-list" class="msgs"></ul>
  <div class="test-row"><button id="backup-apply" type="button" class="danger">确认恢复（覆盖本机配置）</button><span id="backup-apply-result" class="test-result" role="status" aria-live="polite"></span></div>
</div>
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
.dev-list{list-style:none;margin:6px 0 0;padding:0}
.dev-item{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);min-height:44px}
.dev-item:last-child{border-bottom:0}
.dev-name{flex:1;font-size:14px;font-weight:600;word-break:break-all}
.dev-meta{flex:0 0 auto;font-size:12px;color:var(--muted)}
.dev-on{color:#1f7a4d;font-weight:600}
.dev-off{color:#a13b30;font-weight:600}
.dev-del{flex:0 0 auto;min-height:36px;padding:6px 14px;font-size:13px;background:#a13b30}
.dev-del:hover{background:#8a2f26}
.dev-empty{font-size:13px;color:var(--muted);padding:8px 0}
.dev-warn{color:#a13b30;font-weight:600}
fieldset{padding:0 0 28px;margin:0 0 24px;border:0;border-bottom:1px solid var(--line);min-width:0}legend{font-size:19px;font-weight:700;margin-bottom:18px;padding:0}label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}input:not([type=checkbox]):not([type=radio]),select,textarea{display:block;width:100%;min-height:44px;border:1px solid #a5bdcb;border-radius:6px;background:#fff;color:var(--ink);padding:9px 12px;font:inherit;font-size:15px}input[type=radio]{accent-color:var(--blue);width:18px;height:18px;flex-shrink:0;margin:0}textarea{min-height:220px;resize:vertical;line-height:1.7}input::placeholder,textarea::placeholder{color:#6a7e8b}input[type=checkbox]{accent-color:var(--blue);width:18px;height:18px;flex-shrink:0;margin:0}.check{display:flex;align-items:center;gap:10px;min-height:32px;cursor:pointer}.enabled{margin-top:24px}.clear{font-weight:400;color:var(--muted);font-size:13px}.hint{font-size:12px;line-height:1.6;color:var(--muted);margin:7px 0 0}.key-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}.key-heading label{margin:0 0 6px}.key-heading .hint{margin:0 0 6px}.notice{font-size:13px;color:#704b13;background:#fff7e7;border-left:3px solid #c18e36;margin:12px 0 16px;padding:12px 14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.rule{height:1px;background:var(--line);margin:16px 0 12px}footer{display:flex;align-items:center;justify-content:space-between;gap:18px}footer p{font-size:12px;color:var(--muted);margin:0}button{border:0;border-radius:7px;min-height:44px;padding:10px 20px;background:var(--blue);color:#fff;font:600 15px/1.5 inherit;white-space:nowrap;cursor:pointer}button:hover{background:#0b4e73}button:disabled{opacity:.55;cursor:wait}:focus-visible{outline:3px solid #3a94c4;outline-offset:3px}#status{font-size:13px;min-height:24px;margin:18px 0 0;color:var(--blue)}#status[data-error=true]{color:#a13b30}
.test-row{display:flex;align-items:center;gap:14px;margin:20px 0 6px;flex-wrap:wrap}#test-btn,#persona-save,#history-load,#history-more{background:#fff;color:var(--blue);border:1.5px solid var(--blue);min-height:38px;padding:6px 18px;font-size:14px;border-radius:6px;cursor:pointer;font-weight:600}#test-btn:hover,#persona-save:hover,#history-load:hover,#history-more:hover{background:#edf5fa}#test-btn:disabled,#persona-save:disabled,#history-load:disabled,#history-more:disabled{opacity:.6;cursor:wait}.test-result{font-size:13px;line-height:1.5;min-height:22px;flex:1 1 200px}.test-success{color:#1a7f37;font-weight:600}.test-error{color:#cf222e}.reply-preview{display:block;color:var(--muted);font-weight:normal;font-size:12px;margin-top:4px;word-break:break-all}
.preview{margin:18px 0 0}.preview summary{font-size:13px;color:var(--blue);cursor:pointer;font-weight:600}.pre{white-space:pre-wrap;word-break:break-word;font:13px/1.7 "Consolas","Microsoft YaHei UI",monospace;background:#f7fbfd;border:1px solid var(--line);border-radius:6px;padding:12px 14px;margin:10px 0 0;max-height:340px;overflow:auto}
.history h2{font-size:16px;font-weight:700;margin:22px 0 6px}.memory-card{border:1px solid var(--line);border-radius:10px;padding:14px 18px 6px;background:#f7fbfd;margin:0 0 8px}.memory-card h2{margin-top:4px}.msgs{list-style:none;margin:10px 0 0;padding:0}.msgs li{border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:0 0 10px;background:#fff}.msgs li.is-summarized{background:#f6f8f9;border-style:dashed}.msgs li.is-summarized .msg-text{color:#7b8b96}.msg-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--muted);margin:0 0 5px}.msg-role{font-weight:700;color:var(--blue)}.msgs li.is-summarized .msg-role{color:#8ca0ad}.msg-text{white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.65}
.msg-ops{display:flex;gap:8px;margin:8px 0 0;flex-wrap:wrap}.msg-ops button{min-height:30px;padding:4px 14px;font-size:13px;background:#fff;color:var(--blue);border:1.5px solid var(--blue);border-radius:6px}.msg-ops button:hover{background:#edf5fa}.msg-ops button.danger{color:#cf222e;border-color:#e2a3a0}.msg-ops button.danger:hover{background:#fdf0ef}.msg-ops .op-note{font-size:12px;color:var(--muted);align-self:center}
.msg-edit{display:block;width:100%;min-height:88px;border:1px solid #a5bdcb;border-radius:6px;padding:8px 10px;font:14px/1.65 inherit;resize:vertical}
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
.backup-h2{margin-top:28px}.backup-file{max-width:320px}
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
  const tabBackup = get('tab-backup');
  function showTab(which) {
    const isHistory = which === 'history';
    const isRuns = which === 'runs';
    const isBackup = which === 'backup';
    const isSettings = !isHistory && !isRuns && !isBackup;
    tabSettings.classList.toggle('is-active', isSettings);
    tabHistory.classList.toggle('is-active', isHistory);
    tabRuns.classList.toggle('is-active', isRuns);
    tabBackup.classList.toggle('is-active', isBackup);
    tabSettings.setAttribute('aria-selected', String(isSettings));
    tabHistory.setAttribute('aria-selected', String(isHistory));
    tabRuns.setAttribute('aria-selected', String(isRuns));
    tabBackup.setAttribute('aria-selected', String(isBackup));
    get('panel-settings').hidden = !isSettings;
    get('panel-history').hidden = !isHistory;
    get('panel-runs').hidden = !isRuns;
    get('panel-backup').hidden = !isBackup;
    if (isHistory && !historyLoaded) void loadHistory(true);
    if (isRuns) void loadRuns();
  }
  tabSettings.addEventListener('click', () => showTab('settings'));
  tabHistory.addEventListener('click', () => showTab('history'));
  tabRuns.addEventListener('click', () => showTab('runs'));
  tabBackup.addEventListener('click', () => showTab('backup'));

  // ---------- 手机连接 ----------
  // 三个端点都是本机路由（走 petRequest，带本次运行凭据）：
  //   GET  /mobile/api/state   当前开关、端口、局域网地址
  //   POST /mobile/api/enable  打开（写盘，重启生效）
  //   POST /mobile/api/pair    生成 6 位配对码（只有点了才会存在，平时 /pair 一律 403）
  const mobileEnabled = get('mobile-enabled');
  const mobileHost = get('mobile-host');
  const mobileState = get('mobile-state');
  const mobileResult = get('mobile-result');
  const mobilePinBox = get('mobile-pin-box');
  const mobilePin = get('mobile-pin');
  const mobilePinUrl = get('mobile-pin-url');
  let mobilePinTimer = null;
  function mobileMsg(text, error = false) { mobileResult.textContent = text; mobileResult.dataset.error = String(error); }
  function renderMobile(data) {
    mobileEnabled.checked = data.enabled === true;
    mobileHost.value = data.host || '（未检测到局域网地址）';
    mobileState.value = data.enabled
      ? (data.listeningWide ? '已开启 · 正在监听局域网' : '已开启 · 需重启桌宠才生效')
      : '未开启（仅本机可访问）';
  }
  async function loadMobile() {
    try { renderMobile(await petRequest('/mobile/api/state')); }
    catch (error) { mobileState.value = '读取失败'; mobileMsg(error.message, true); }
  }
  get('mobile-save').addEventListener('click', async () => {
    mobileMsg('保存中…');
    try {
      await petRequest(mobileEnabled.checked ? '/mobile/api/enable' : '/mobile/api/disable', 'POST');
      mobileMsg(mobileEnabled.checked ? '已开启。若刚才提示需要重启，请从托盘退出后重开桌宠。' : '已关闭。', false);
      await loadMobile();
    } catch (error) { mobileMsg(error.message, true); }
  });
  get('mobile-pair').addEventListener('click', async () => {
    mobileMsg('生成中…');
    try {
      const data = await petRequest('/mobile/api/pair', 'POST');
      mobilePin.textContent = data.pin;
      // 对外一律 https（自签）：局域网 http:// 不是安全上下文，手机浏览器会禁掉
      // 麦克风与语音识别。手机上第一次打开会弹「证书不受信任」，点「继续前往」即可。
      mobilePinUrl.textContent = data.host ? 'https://' + data.host + '/mobile/' : '（未检测到局域网地址）';
      mobilePinBox.hidden = false;
      mobileMsg('配对码已生成，' + data.ttlSeconds + ' 秒内有效。', false);
      if (mobilePinTimer) clearInterval(mobilePinTimer);
      let left = data.ttlSeconds;
      mobilePinTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(mobilePinTimer); mobilePinTimer = null;
          mobilePin.textContent = '------';
          get('mobile-pin-hint').textContent = '已过期。再点一次「生成配对码」。';
        } else {
          mobileMsg('配对码 ' + left + ' 秒后失效。', false);
        }
      }, 1000);
    } catch (error) { mobileMsg(error.message, true); }
  });
  // ---------- 已配对的手机（2026-11-01）----------
  //   GET  /mobile/api/devices          列出（带 online = 心跳是否新鲜）
  //   POST /mobile/api/devices/remove   删一台（电脑立刻恢复可写，那台手机需重新配对）
  //
  // 为什么「删掉就恢复可写」是安全的：删完登记表空了 → 接管判定失效 → 电脑写；
  // 被删的 id 进 revoked，它的请求一律 403，必须重新拿配对码。
  const deviceBox = get('mobile-devices-box');
  const deviceList = get('mobile-devices');
  const deviceTakeover = get('mobile-takeover');
  function fmtAgo(ms) {
    if (!ms) return '还没连过';
    const diff = Date.now() - ms;
    if (diff < 60000) return '刚刚还在';
    if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' 小时前';
    return Math.round(diff / 86400000) + ' 天前';
  }
  function renderDevices(data) {
    if (!data || data.supported === false) { deviceBox.hidden = true; return; }
    const list = Array.isArray(data.devices) ? data.devices : [];
    deviceBox.hidden = false;
    deviceList.textContent = '';
    if (list.length === 0) {
      const li = document.createElement('li');
      li.className = 'dev-empty';
      li.textContent = '还没配过手机。点上面的「生成配对码」开始。';
      deviceList.appendChild(li);
    }
    for (const d of list) {
      const li = document.createElement('li');
      li.className = 'dev-item';
      const name = document.createElement('span');
      name.className = 'dev-name';
      name.textContent = (d.name && d.name !== '' ? d.name : '手机') + (d.id ? ' · ' + String(d.id).slice(-6) : '');
      const meta = document.createElement('span');
      meta.className = 'dev-meta ' + (d.online ? 'dev-on' : 'dev-off');
      meta.textContent = (d.online ? '在线' : '不在线') + ' · ' + fmtAgo(d.lastSeenAt);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'dev-del';
      del.textContent = '删除';
      del.addEventListener('click', async () => {
        del.disabled = true;
        mobileMsg('正在删除…');
        try {
          const next = await petRequest('/mobile/api/devices/remove', 'POST', JSON.stringify({ id: d.id }));
          renderDevices(next);
          mobileMsg('已删除。这台电脑现在可以正常聊天了。', false);
        } catch (error) {
          mobileMsg(error.message, true);
        } finally {
          del.disabled = false;
        }
      });
      li.appendChild(name);
      li.appendChild(meta);
      li.appendChild(del);
      deviceList.appendChild(li);
    }
    if (data.phoneAway === true) {
      deviceTakeover.hidden = false;
      deviceTakeover.textContent = data.reason || '手机不在这个网络，电脑现在只读。';
    } else {
      deviceTakeover.hidden = true;
      deviceTakeover.textContent = '';
    }
  }
  async function loadDevices() {
    try { renderDevices(await petRequest('/mobile/api/devices')); }
    catch (error) { deviceBox.hidden = true; }
  }
  void loadDevices();
  // 15 秒刷新一次「在线/不在线」。带 typeof 守卫：设置页脚本会被 settings.test.ts 放进
  // 没有计时器的 vm 里求值，裸调 setInterval 会直接 ReferenceError 把整段脚本打断。
  if (typeof setInterval === 'function') setInterval(() => { void loadDevices(); }, 15000);
  void loadMobile();

  // ---------- 数据备份（导出 / 导入）----------
  // 导出：GET 拿 bundle → Blob 下载。走 petRequest 会按 JSON 解析，这里直接 fetch 保原文。
  // 导入：两阶段。先 POST dry=1 只算不写 → 展示计划 → 用户点确认才 POST 真导。
  const backupIncludeKey = get('backup-include-key');
  const backupKeyWarn = get('backup-key-warn');
  const backupExportBtn = get('backup-export');
  const backupExportResult = get('backup-export-result');
  const backupExportDetail = get('backup-export-detail');
  const backupFile = get('backup-file');
  const backupPreviewBtn = get('backup-preview');
  const backupImportResult = get('backup-import-result');
  const backupPlan = get('backup-plan');
  const backupPlanMeta = get('backup-plan-meta');
  const backupPlanList = get('backup-plan-list');
  const backupApplyBtn = get('backup-apply');
  const backupApplyResult = get('backup-apply-result');
  let pendingBackupText = '';

  backupIncludeKey.addEventListener('change', () => {
    backupKeyWarn.hidden = !backupIncludeKey.checked;
  });

  function backupStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  async function petRequestRaw(path, method = 'GET', payload) {
    const response = await fetch(path, {
      method, credentials: 'omit', cache: 'no-store',
      headers: { 'X-DSH-Pet-Token': token, ...(payload ? {'Content-Type': 'application/json'} : {}) },
      ...(payload ? {body: JSON.stringify(payload)} : {})
    });
    if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
    if (!response.ok) throw new Error('本机接口返回 HTTP ' + response.status);
    return response.json();
  }

  backupExportBtn.addEventListener('click', async () => {
    backupExportBtn.disabled = true;
    backupExportResult.textContent = '正在收集…';
    backupExportResult.dataset.error = 'false';
    backupExportDetail.textContent = '';
    try {
      const data = await petRequestRaw('/dsh-pet-7340/portable/export', 'POST', { includeApiKey: backupIncludeKey.checked });
      if (!data.ok) throw new Error(data.error || '导出失败');
      const blob = new Blob([JSON.stringify(data.bundle, null, 2)], {type: 'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dsh-pet-backup-' + backupStamp() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      backupExportResult.textContent = '已导出 ' + data.bundle.files.length + ' 个文件';
      backupExportDetail.textContent = '包含：' + data.bundle.files.map(f => f.path).join('、')
        + (data.skipped && data.skipped.length ? '\\n跳过（读不出来）：' + data.skipped.join('、') : '');
    } catch (e) {
      backupExportResult.textContent = e.message;
      backupExportResult.dataset.error = 'true';
    } finally {
      backupExportBtn.disabled = false;
    }
  });

  function resetImportPlan() {
    pendingBackupText = '';
    backupPlan.hidden = true;
    backupPlanList.textContent = '';
    backupPlanMeta.textContent = '';
    backupApplyResult.textContent = '';
  }

  backupPreviewBtn.addEventListener('click', async () => {
    resetImportPlan();
    backupImportResult.dataset.error = 'false';
    const file = backupFile.files && backupFile.files[0];
    if (!file) { backupImportResult.textContent = '先选一个备份文件。'; backupImportResult.dataset.error = 'true'; return; }
    backupImportResult.textContent = '读取中…';
    try {
      const text = await file.text();
      const data = await petRequestRaw('/dsh-pet-7340/portable/import', 'POST', { text, dry: true });
      if (!data.ok) {
        backupImportResult.textContent = data.message || '这个文件不能导入';
        backupImportResult.dataset.error = 'true';
        return;
      }
      pendingBackupText = text;
      const overwrite = data.files.filter(f => f.overwrite).length;
      const added = data.files.length - overwrite;
      backupPlanMeta.textContent = '备份导出于 ' + (data.exportedAt || '未知时间')
        + (data.appVersion ? '（程序 v' + data.appVersion + '）' : '')
        + ' · ' + data.files.length + ' 个文件：覆盖 ' + overwrite + ' 个，新增 ' + added + ' 个'
        + (data.includeApiKey ? ' · 含 API 密钥（会一并覆盖本机密钥）' : ' · 不含 API 密钥');
      for (const f of data.files) {
        const li = document.createElement('li');
        li.textContent = (f.overwrite ? '覆盖 ' : '新增 ') + f.path + '（' + f.bytes + ' 字节）';
        backupPlanList.appendChild(li);
      }
      backupPlan.hidden = false;
      backupImportResult.textContent = '预览完成，确认后再写入。';
    } catch (e) {
      backupImportResult.textContent = e.message;
      backupImportResult.dataset.error = 'true';
    }
  });

  backupApplyBtn.addEventListener('click', async () => {
    if (!pendingBackupText) { backupApplyResult.textContent = '先预览。'; backupApplyResult.dataset.error = 'true'; return; }
    if (!confirm('确认用这个备份覆盖本机配置？\\n\\n旧文件会留一份 .bak-before-import-时间戳 副本。')) return;
    backupApplyBtn.disabled = true;
    backupApplyResult.dataset.error = 'false';
    backupApplyResult.textContent = '正在写入…';
    try {
      const data = await petRequestRaw('/dsh-pet-7340/portable/import', 'POST', { text: pendingBackupText });
      if (!data.ok) {
        backupApplyResult.textContent = data.message || '导入失败';
        backupApplyResult.dataset.error = 'true';
        return;
      }
      backupApplyResult.textContent = '已恢复 ' + data.written.length + ' 个文件'
        + (data.backups.length ? '，旧文件留了 ' + data.backups.length + ' 份副本' : '')
        + (data.apiKeyKept ? '；本机 API 密钥保持不变（备份里没有密钥）' : '');
      backupFile.value = '';
      resetImportPlanKeepMessage(backupApplyResult.textContent);
    } catch (e) {
      backupApplyResult.textContent = e.message;
      backupApplyResult.dataset.error = 'true';
    } finally {
      backupApplyBtn.disabled = false;
    }
  });

  // reset 会清掉 backupApplyResult，导入成功后要保住那句提示
  function resetImportPlanKeepMessage(msg) {
    pendingBackupText = '';
    backupPlan.hidden = true;
    backupPlanList.textContent = '';
    backupPlanMeta.textContent = '';
    backupApplyResult.textContent = msg;
  }

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
      // data-index = 这条在 entry.messages 里的绝对下标，改/删都靠它定位（内容可重复、可被改，只有下标稳定）
      li.dataset.index = String(row.index);
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
      li.append(head, text, buildOps(row, li, text));
      historyList.appendChild(li);
    }
  }

  /**
   * 每条历史消息下面那排「改 / 删」按钮。
   *
   * 两条口径写死在这里：
   *  1. 改完/删完**都以服务端回执为准**（回执里的 total / summarized / memory），不靠前端自己算——
   *     尤其是「已压缩」那条，删掉后摘要会被重写、游标会退一格，前端算不出来。
   *  2. 已压缩的条目要点明「会顺带重写摘要」，因为那是一次真实的云端调用、可能要等几秒，
   *     用户得知道自己在等什么；摘要没改写成功时服务端**整体不保存**，这里要把原因原样转达。
   *  （注意：这一段是模板字符串里的正文，注释里不能出现反引号，否则会提前截断整页脚本。）
   */
  function buildOps(row, li, textEl) {
    const ops = document.createElement('p');
    ops.className = 'msg-ops';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = '改';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = '删';
    ops.append(edit, del);

    edit.addEventListener('click', () => {
      if (li.querySelector('.msg-edit')) return;  // 已经在编辑中
      textEl.hidden = true;
      edit.disabled = true;
      del.disabled = true;
      const box = document.createElement('textarea');
      box.className = 'msg-edit';
      box.value = row.content;
      const bar = document.createElement('p');
      bar.className = 'msg-ops';
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = '保存';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '取消';
      const hint = document.createElement('span');
      hint.className = 'op-note';
      if (row.summarized) hint.textContent = '这条已压进摘要，保存后会顺带重写摘要';
      bar.append(save, cancel, hint);
      li.append(box, bar);
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);

      function close() {
        box.remove(); bar.remove();
        textEl.hidden = false;
        edit.disabled = false;
        del.disabled = false;
      }
      cancel.addEventListener('click', close);
      save.addEventListener('click', async () => {
        const next = box.value.trim();
        if (!next) { historyMessage('内容不能为空；不想保留这条就用「删」。', 'test-error'); return; }
        if (next === row.content) { close(); return; }
        save.disabled = true; cancel.disabled = true;
        historyMessage('正在保存…');
        try {
          const r = await petRequest('/dsh-pet-7340/chat/history', 'POST', {
            pet: historyPet.value, index: row.index, content: next,
          });
          if (!r.ok) throw new Error(r.message || r.reason || '保存失败');
          row.content = next;
          textEl.textContent = next;
          close();
          applyMemory(r);
          historyMessage(
            (r.covered ? '已保存；这条在摘要覆盖区内，摘要' + (r.summaryRewritten ? '已重写。' : '未变。') : '已保存。'),
            'test-success',
          );
        } catch (error) {
          save.disabled = false; cancel.disabled = false;
          historyMessage(error.message, 'test-error');
        }
      });
    });

    del.addEventListener('click', async () => {
      // 注意：这里整段是模板字符串里的正文，换行必须写成反斜杠 n 的转义形式；
      // 直接写真换行会把下面那行字符串字面量物理截断，页面脚本立刻 SyntaxError（settings.test.ts 会抓到）。
      const why = row.summarized
        ? '确认删除这条？\\n\\n它已经压进摘要了，删掉后摘要会被重写（可能要等几秒）。'
        : '确认删除这条？此操作不可撤销。';
      if (!window.confirm(why)) return;
      edit.disabled = true; del.disabled = true;
      historyMessage('正在删除…');
      try {
        const r = await petRequest(
          '/dsh-pet-7340/chat/history?pet=' + encodeURIComponent(historyPet.value) + '&index=' + row.index,
          'DELETE',
        );
        if (!r.ok) throw new Error(r.message || r.reason || '删除失败');
        // 删掉之后**后面所有条目的绝对下标都退一格**，DOM 上的 data-index 也就全错了。
        // 与其在 DOM 上做偏移，不如按本地账本整体重画一遍——改/删都只发生在用户点按钮的这一刻，重画没有副作用。
        historyRows = historyRows.filter(x => x.index !== row.index);
        historyTotal = Number(r.total) || Math.max(0, historyTotal - 1);
        historyOffset = historyRows.length;
        renderRows(historyRows, false);
        historyMore.disabled = historyRows.length >= historyTotal;
        applyMemory(r);
        historyMessage(
          (r.covered ? '已删除；这条在摘要覆盖区内，摘要' + (r.summaryRewritten ? '已重写。' : '未变。') : '已删除。') +
            '现在共 ' + historyTotal + ' 条，已显示 ' + historyRows.length + ' 条。',
          'test-success',
        );
      } catch (error) {
        edit.disabled = false; del.disabled = false;
        historyMessage(error.message, 'test-error');
      }
    });

    return ops;
  }

  /** 服务端回执里的 memory 概览 → 摘要与计数（改/删之后它可能已经变了） */
  function applyMemory(r) {
    const mem = (r && r.memory) || {};
    if (typeof mem.summary === 'string') memorySummary.textContent = mem.summary || '（还没有生成过摘要）';
    if (mem.total != null) historyTotal = Number(mem.total) || historyTotal;
    memoryMeta.textContent = '已压缩 ' + (mem.summarized || 0) + ' / ' + (mem.total || 0) + ' 条' +
      (mem.summaryTs ? ' · 摘要生成于 ' + fmtTime(mem.summaryTs) : '') +
      (Number.isFinite(mem.pendingRounds) ? ' · 待压缩 ' + mem.pendingRounds + ' 轮' : '');
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
  // 记忆设置（2026-10-29，2026-10-30 改为「群聊是可勾选开关」）
  const memGroupBot = get('groupBotEnabled');
  const memRecallK = get('memoryRecallK');
  const memGroupBox = get('group-box');
  const memScopeAll = get('groupMemoryScope');
  const memScopeRecent = get('groupMemoryScopeRecent');
  const memRecentN = get('groupMemoryRecentN');
  const memOwnerSync = get('ownerSyncEnabled');
  const memOwnerQq = get('ownerQq');
  const memSave = get('memory-save');
  const memResult = get('memory-result');
  // 主动聊天（2026-10-31，第四件事）
  const proactBox = get('proactiveChatEnabled');
  const proactSec = get('proactiveChatSec');
  const proactSave = get('proactive-save');
  const proactTest = get('proactive-test');
  const proactResult = get('proactive-result');
  // 回话节奏（2026-11-01，用户要求「像真人那样分多条说」）
  const rhythmSplit = get('chatSplitEnabled');
  const rhythmMerge = get('chatMergeWindowMs');
  const rhythmSave = get('rhythm-save');
  const rhythmResult = get('rhythm-result');
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
      // 记忆设置：缺键给默认（群聊关 / everyone / 10 / 3），与后端 memoryModeOf 等函数同口径
      //
      // 2026-10-30 起「群聊」不再是单选模式，而是一个开关：默认关 = 纯单人桌宠。
      // 兼容老配置：以前存过 memoryMode:'group' 的用户，这里当成"开关是开的"，
      // 否则他们升级后会发现群聊突然不工作（用户看不到 memoryMode 这个键了，没法自己改回来）。
      const groupOn = data.groupBotEnabled === true || data.memoryMode === 'group';
      memGroupBot.checked = groupOn;
      memRecallK.value = typeof data.memoryRecallK === 'number' ? data.memoryRecallK : 3;
      const scope = data.groupMemoryScope === 'recent' ? 'recent' : 'everyone';
      memScopeAll.checked = scope === 'everyone';
      memScopeRecent.checked = scope === 'recent';
      memRecentN.value = typeof data.groupMemoryRecentN === 'number' ? data.groupMemoryRecentN : 10;
      memOwnerSync.checked = data.ownerSyncEnabled === true;
      memOwnerQq.value = typeof data.ownerQq === 'string' ? data.ownerQq : '';
      // 主动聊天：缺键给默认（关 / 1800s），与后端 proactiveEnabled / proactivePeriodSec 同口径
      proactBox.checked = data.proactiveChatEnabled === true;
      proactSec.value = typeof data.proactiveChatSec === 'number' ? data.proactiveChatSec : 1800;
      // 回话节奏：缺键给默认（开 / 800ms），与后端 splitEnabledOf / mergeWindowMsOf 同口径
      rhythmSplit.checked = data.chatSplitEnabled !== false;
      rhythmMerge.value = typeof data.chatMergeWindowMs === 'number' ? data.chatMergeWindowMs : 800;
      syncMemoryVisibility();
      const pets2 = data.pets || [];
      workspaceList.textContent = pets2.length
        ? pets2.map(p => (p.name || p.id) + ' → ' + p.workspace).join(' | ')
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
  /**
   * 记忆区块的显示联动（2026-10-30 改造）：
   *  - 群聊开关关 → 整块成员策略与「记住主人」都不显示（纯单人桌宠，这些控件是纯噪声）；
   *  - 群聊开 → 显示成员策略；「只记得最近 N 个」档才允许填 N；
   *  - 「记住主人」的 QQ 输入框只在勾上后才可编辑（没勾时填了也没用，禁用比留个能填的空框更明确）。
   *
   * 为什么用 hidden 而不是 disabled：隐藏比禁用干净（禁用会留下一块灰控件，用户会怀疑自己漏配了什么）。
   */
  function syncMemoryVisibility() {
    const isGroup = memGroupBot.checked;
    memGroupBox.hidden = !isGroup;
    // N 输入框只在 recent 档可编辑：everyone 档下它无意义（改了不起任何作用）
    memRecentN.disabled = !isGroup || !memScopeRecent.checked;
    memOwnerQq.disabled = !isGroup || !memOwnerSync.checked;
  }
  memGroupBot.addEventListener('change', syncMemoryVisibility);
  memScopeAll.addEventListener('change', syncMemoryVisibility);
  memScopeRecent.addEventListener('change', syncMemoryVisibility);
  memOwnerSync.addEventListener('change', syncMemoryVisibility);
  memSave.addEventListener('click', async () => {
    memSave.disabled = true;
    note(memResult, '正在保存…');
    try {
      const isGroup = memGroupBot.checked;
      const scope = memScopeRecent.checked ? 'recent' : 'everyone';
      // N 只在 group+recent 时有意义；其他情况一律发 10（默认值），避免把上一次的旧值带进去
      const n = isGroup && scope === 'recent' ? Number(memRecentN.value) : 10;
      if (isGroup && scope === 'recent' && (!Number.isFinite(n) || n < 1 || n > 100)) {
        throw new Error('N 必须是 1 到 100 之间的整数');
      }
      const k = Number(memRecallK.value);
      if (!Number.isFinite(k) || k < 0 || k > 50) throw new Error('回捞条数必须是 0 到 50 之间的整数');
      // 「记住主人」：勾了就必须填一个像样的 QQ 号——不填等于静默不生效，
      // 而用户的期望是"我勾了它就该记得"，静默失败是最难自查的那种。
      const ownerSync = isGroup && memOwnerSync.checked;
      const ownerQq = memOwnerQq.value.trim();
      if (ownerSync && !/^\\d{4,15}$/.test(ownerQq)) {
        throw new Error('勾了「记住主人」就要填 QQ 号（4 到 15 位数字）');
      }
      const data = await petRequest('/dsh-pet-7340/assistant/settings', 'POST', {
        groupBotEnabled: isGroup,
        // 老键同步写一次，让降级回旧版本的用户不会突然失去群聊（存的是等效语义）
        memoryMode: isGroup ? 'group' : 'single',
        groupMemoryScope: scope,
        groupMemoryRecentN: n,
        memoryRecallK: k,
        ownerSyncEnabled: ownerSync,
        // 没开群聊/没勾记住主人时清空，避免留下一个"看起来还挂着"的号
        ownerQq: ownerSync ? ownerQq : '',
      });
      if (!data.ok) throw new Error(data.message || data.reason || '保存失败');
      const summary = !isGroup
        ? '纯单人桌宠。'
        : (scope === 'recent' ? '群聊模式，只记得最近 ' + n + ' 个人。' : '群聊模式，记得群里每个人。')
          + (ownerSync ? '你在群里的发言也会记进单人记忆。' : '');
      note(memResult, '已保存。' + summary + (k === 0 ? '（往事回捞已关闭）' : '每次回捞 ' + k + ' 条往事。'), 'test-success');
    } catch (error) { note(memResult, error.message, 'test-error'); }
    finally { memSave.disabled = false; }
  });
  // ---- 主动聊天（2026-10-31，第四件事）----
  // 保存走与记忆/助手同一个 PATCH 端点（/assistant/settings），两个字段在白名单里。
  // 间隔在前端先校一遍：后端 topFieldValid 越界会整包拒（返回 bad-request），
  // 但那时用户只看到"提交的值不合法"，不知道是哪一个输入错了。
  proactSave.addEventListener('click', async () => {
    proactSave.disabled = true;
    note(proactResult, '正在保存…');
    try {
      const sec = Number(proactSec.value);
      if (!Number.isFinite(sec) || sec < 120 || sec > 86400) {
        throw new Error('间隔必须是 120 到 86400 秒之间（最短 2 分钟，最长一天）');
      }
      const data = await petRequest('/dsh-pet-7340/assistant/settings', 'POST', {
        proactiveChatEnabled: proactBox.checked,
        proactiveChatSec: Math.floor(sec),
      });
      if (!data.ok) throw new Error(data.message || data.reason || '保存失败');
      const mins = Math.round(sec / 60);
      const human = sec < 3600 ? mins + ' 分钟' : (sec / 3600).toFixed(sec % 3600 === 0 ? 0 : 1) + ' 小时';
      note(
        proactResult,
        proactBox.checked
          ? '已保存。它大约每 ' + human + ' 主动找你一次（每只宠物各算各的）。'
          : '已保存。主动聊天已关闭，它不会再自己开口。',
        'test-success',
      );
    } catch (error) { note(proactResult, error.message, 'test-error'); }
    finally { proactSave.disabled = false; }
  });
  // ---- 回话节奏（2026-11-01，分条回复 + 合并窗口）----
  // 与主动聊天同一个 PATCH 端点（/assistant/settings），两个字段都在白名单里。
  // 窗口在前端先校一遍：后端 topFieldValid 越界会整包拒（bad-request），
  // 那时用户只看到「提交的值不合法」，不知道是哪个输入错了。
  rhythmSave.addEventListener('click', async () => {
    rhythmSave.disabled = true;
    note(rhythmResult, '正在保存…');
    try {
      const ms = Number(rhythmMerge.value);
      if (!Number.isFinite(ms) || ms < 0 || ms > 3000) {
        throw new Error('合并窗口必须是 0 到 3000 毫秒之间（0 = 不合并）');
      }
      const data = await petRequest('/dsh-pet-7340/assistant/settings', 'POST', {
        chatSplitEnabled: rhythmSplit.checked,
        chatMergeWindowMs: Math.floor(ms),
      });
      if (!data.ok) throw new Error(data.message || data.reason || '保存失败');
      const parts = [];
      parts.push(rhythmSplit.checked ? '她会把回答拆成几条短句逐条发' : '她一次只说一条（不拆）');
      parts.push(ms === 0 ? '你连发几条时她一句一回，不做合并' : '你连发几条时她先攒 ' + Math.floor(ms) + ' 毫秒再一起回');
      note(rhythmResult, '已保存。' + parts.join('；') + '。', 'test-success');
    } catch (error) { note(rhythmResult, error.message, 'test-error'); }
    finally { rhythmSave.disabled = false; }
  });
  // 「现在试一句」：走 POST /proactive（force 绕过间隔与开关，但仍守住"她还欠一个回复"）。
  // 这个按钮的价值在于**让用户不必等半小时才知道它会不会说话**——否则「开了但没反应」
  // 与「没开」在界面上长得一模一样。
  proactTest.addEventListener('click', async () => {
    proactTest.disabled = true;
    note(proactResult, '正在让它说一句…');
    try {
      // 用当前选中的宠物（设置页顶部那个下拉），与对话/历史页同一个目标
      // surface=any：宿主对 /proactive 与 /whisper 一样要求显式声明"期望显示在哪一端"
      // （见 src/host/surface.ts 的三条边界——不传会回 bad-request）。这里点按钮的是人，
      // 不关心宠物显示在网页还是桌面，只关心它到底会不会开口，所以选 any。
      const petId = petSelect && petSelect.value ? petSelect.value : '';
      const q = '?surface=any' + (petId ? '&pet=' + encodeURIComponent(petId) : '');
      const data = await petRequest('/dsh-pet-7340/proactive' + q, 'POST', {});
      if (!data.ok) {
        // 这几种 reason 是"正常拒绝"不是故障，给用户可操作的解释而不是抛错
        const why = {
          'not-at-boundary': '它刚才在等你回话（你问了它、它还没答），这时不该另起话头。等它答完再试。',
          'unanswered': '它已经主动说过一句、还没人接。回它一句再试。',
          'ai-unavailable': 'AI 不可用（没配密钥或被停用），先把 AI 配好再试。',
          'unknown-pet': '没有这只宠物，先在设置页顶部的宠物下拉里选一只。',
          'generate-error': '生成失败：' + (data.message || '模型没返回内容'),
        };
        throw new Error(why[data.reason] || data.message || data.reason || '没说出来');
      }
      note(proactResult, '它说：' + data.text, 'test-success');
    } catch (error) { note(proactResult, error.message, 'test-error'); }
    finally { proactTest.disabled = false; }
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

  // ---------- 另一端改了设置，这里自动跟过来（2026-11-01） ----------
  //
  // 手机端也能改人设、记忆、回话节奏了（见 ./mobile-settings），改的是**同一份**配置。
  // 那条路走完，宿主会写 state.writeSection('config', {})；手机在长轮询里看得到，
  // 这一页没有长轮询，就用一条低频对账把它补上：每 4 秒比一次「值变没变」，变了才重新
  // 载入。三条自我约束：
  //   ① 值没变什么都不做（自己的保存也会落到同一个值，不会自己覆盖自己）；
  //   ② 用户手上有焦点在输入框里 → 只提示、不覆盖：手机上点一下保存，不该把这里写了一半
  //      的人设冲掉；
  //   ③ 页面不可见时不轮询（后台开的设置页没必要一直问）。
  const syncBar = document.createElement('p');
  syncBar.className = 'hint';
  syncBar.hidden = true;
  // 这条横幅只是提示用：某些环境（单测里那个没有 body 的 vm，见本文件里同样的 setInterval 守卫）
  // 没有 document.body，插不进去也不能让整页脚本挂掉 —— 少一条提示远好过整页白屏。
  if (document.body && typeof document.body.insertBefore === 'function') {
    document.body.insertBefore(syncBar, document.body.firstChild);
  }
  function showSyncBar(text) {
    syncBar.textContent = text || '';
    syncBar.hidden = !text;
  }
  function remoteFingerprint(st, persona) {
    return [
      st.chatMemoryRounds, st.memoryRecallK, st.groupBotEnabled, st.groupMemoryScope, st.groupMemoryRecentN,
      st.ownerSyncEnabled, st.ownerQq, st.chatSplitEnabled, st.chatMergeWindowMs,
      st.proactiveChatEnabled, st.proactiveChatSec, st.screenContextEnabled,
      st.assistantEnabled, st.assistantPermission, st.assistantNetworkEnabled,
      persona,
      // 分隔符用控制字符：人设正文是自己写的，任何可打印字符都可能出现在里面，
      // 用 '|' 之类做分隔会有一天把两段不同的东西拼成同一个指纹（→ 改了指纹没变→不同步）。
    ].join('\\u0001');
  }
  function editingNow() {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }
  let remoteFp = '';
  async function pollRemoteChanges() {
    if (document.hidden) return;
    try {
      const st = await petRequest('/dsh-pet-7340/assistant/settings');
      const per = await petRequest('/dsh-pet-7340/pet-persona?pet=' + encodeURIComponent(petSelect.value));
      const fp = remoteFingerprint(st, per.persona || '');
      if (remoteFp === '') { remoteFp = fp; return; } // 首轮只记基线，不覆盖刚载入的内容
      if (fp === remoteFp) return;
      if (editingNow()) {
        showSyncBar('另一端改了设置。你正在编辑，所以这里没有自动覆盖 —— 想让这里也变成最新的，先点走输入框（或刷新页面）。');
        return;
      }
      remoteFp = fp;
      personaBox.value = per.persona || '';
      syncCount();
      await loadAssistantSettings();
      showSyncBar('另一端（比如手机）改了设置，这里已自动同步过来。');
    } catch {
      // 对账失败什么都不做：这是后台心跳，报错弹窗会盖住用户正在做的事。
    }
  }
  if (typeof setInterval === 'function') setInterval(() => { void pollRemoteChanges(); }, 4000);
})();
`;
