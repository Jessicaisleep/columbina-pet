/**
 * 手机端页面（/mobile/）—— 桌宠的第三个客户端。
 *
 * 设计前提（见交接书 §30.3）：浏览器端与桌面端**本来就都只是客户端**，记忆唯一写方是 host。
 * 所以手机端不需要同步任何东西：只要能连上 host，它读到的就是同一份 memory.json，
 * 说的每句话也写回同一份 —— 这就是「手机接着对话 / 电脑接着对话」。
 *
 * 这一页刻意做成**零外部依赖的单文件**：不引字体、不引 CDN、不引框架。
 * 理由与 04-WEB桌宠/web-pet 相同：手机在弱网/离线缓存下打开也要能用，
 * 而且它同时要被 Capacitor 包进 APK（`capacitor://localhost` 里加载的也是这份 HTML）。
 *
 * 与 settings-page 一样拆成 page/style/script 三段：宿主给它们各自的 content-type，
 * 页面里不写内联 style/script，CSP 就不必开 unsafe-inline。
 *
 * 设置屏（2026-11-01，用户要求「手机端也能改人设、记忆等设置，一端改完另一端自动同步」）
 * 三段字符串直接写在下面（不拆到别的模块：build-www.mjs 用 Node 直接 import 本文件，
 * 而 Node 的 ESM 解析不补扩展名，跨文件的相对导入会在打包那一步炸掉）。
 */

export const mobilePage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f1218">
<title>桌宠</title>
<link rel="stylesheet" href="/mobile/mobile.css">
<script src="/mobile/mobile.js" defer></script>
</head><body>
<div id="app">
  <section id="connect" class="screen">
    <h1>连接电脑上的桌宠</h1>
    <p class="hint">在电脑上打开桌宠设置页 →「手机连接」，那里会显示一个地址和 6 位配对码。把它们填到这里。</p>
    <label for="host">电脑地址</label>
    <input id="host" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false"
      placeholder="192.168.1.5:60917">
    <label for="pin">配对码</label>
    <input id="pin" type="text" inputmode="numeric" maxlength="6" placeholder="6 位数字">
    <div class="row"><button id="connect-btn" type="button">连接</button></div>
    <p id="connect-msg" class="msg" role="status" aria-live="polite"></p>
    <details class="tip"><summary>连不上？</summary>
      <ul>
        <li>手机和电脑要在同一个 Wi-Fi，或都连着同一个 Tailscale 网络。</li>
        <li>配对码 5 分钟内有效，过期回电脑重新生成一个。</li>
        <li>电脑上的桌宠要开着（关掉电脑就没有 AI 了，这是设计如此）。</li>
      </ul>
    </details>
  </section>

  <section id="main" class="screen is-hidden">
    <header class="bar">
      <span id="pet-name">桌宠</span>
      <span id="conn-state" class="dot" title="连接状态"></span>
      <button id="pick-btn" type="button" class="link">切换</button>
      <button id="set-btn" type="button" class="link">设置</button>
      <button id="disconnect" type="button" class="link">断开</button>
    </header>
    <p id="tip" class="tipbar is-hidden"></p>
    <!-- 切换面板（2026-11-01）：上半是**这台电脑**上的宠物，下半是**配对过的电脑**。
         两块都要有：宠物决定你眼前是哪只，宿主决定数据来自哪一份（插件端 2 只 / 独立端 3 只）。 -->
    <div id="picker" class="picker is-hidden">
      <div class="phead">这台电脑上的宠物</div>
      <div id="pick-pets" class="plist"></div>
      <div class="phead">连哪台电脑</div>
      <div id="pick-hosts" class="plist"></div>
      <div class="prow"><button id="pick-add" type="button" class="nbtn">＋ 连另一台电脑</button><button id="pick-close" type="button" class="nbtn">收起</button></div>
    </div>
    <div id="stage" class="stage">
      <div id="bubble" class="bubble is-hidden"><span id="bubble-tag" class="btag"></span><span id="bubble-text"></span></div>
      <div id="pet" class="pet"></div>
    </div>
    <div id="native" class="native is-hidden">
      <div class="nrow"><span class="nlabel">悬浮宠物</span><span id="ov-state" class="nsub">检查中…</span><button id="ov-btn" type="button" class="nbtn">开</button></div>
      <div class="nrow"><span class="nlabel">语音唤醒</span><span id="wk-state" class="nsub">检查中…</span><button id="wk-btn" type="button" class="nbtn">开</button></div>
      <div class="nrow"><span class="nlabel">读屏</span><span id="rd-state" class="nsub">检查中…</span><button id="rd-btn" type="button" class="nbtn">去开</button></div>
      <p id="native-msg" class="msg"></p>
    </div>
    <div id="chat" class="chat"></div>
    <div id="selfai" class="selfai is-hidden">
      <div class="nrow"><span class="nlabel">手机自己聊（可选）</span><span id="selfai-state" class="nsub">关</span><button id="selfai-btn" type="button" class="nbtn">设置</button></div>
      <div id="selfai-form" class="is-hidden">
        <p class="hint" id="selfai-warn">开了之后，电脑连不上时由<b>手机自己</b>生成回复——所以密钥会存在这台手机上。手机丢了/借人用，别人就能拿这把密钥花你的额度，这一点请自己权衡。<b>不开</b>的话手机只是个远程窗口：连不上电脑时你写的话先存在手机上，回到同一网络再补进对话。</p>
        <label for="selfai-url">接口地址</label><input id="selfai-url" type="text" placeholder="https://api.deepseek.com/v1" autocomplete="off">
        <label for="selfai-model">模型</label><input id="selfai-model" type="text" placeholder="deepseek-chat" autocomplete="off">
        <label for="selfai-key">密钥（只存在这台手机上）</label><input id="selfai-key" type="password" placeholder="sk-..." autocomplete="off">
        <div class="nrow"><button id="selfai-save" type="button" class="nbtn">保存</button><button id="selfai-clear" type="button" class="nbtn">清除密钥</button><span id="selfai-msg" class="nsub"></span></div>
      </div>
    </div>
    <form id="composer" class="composer">
      <button id="mic" type="button" class="mic" aria-label="语音输入">🎤</button>
      <input id="text" type="text" autocomplete="off" placeholder="说点什么…" maxlength="2000">
      <button id="send" type="submit">发送</button>
    </form>
  </section>

  <section id="setts" class="screen is-hidden">
    <header class="bar">
      <button id="set-back" type="button" class="link">返回</button>
      <span id="set-title">设置</span>
      <span id="set-state" class="dot" title="同步状态"></span>
    </header>
    <p id="set-sync" class="tipbar is-hidden"></p>
    <div class="sscroll">
      <h2 class="sh">这只宠物的人设</h2>
      <p class="shint">这段会作为她说话的第一段设定。留空 = 用电脑上这只宠物的默认人设。
        改的是电脑上那一份，改完两端一致。<strong>不设字数上限</strong>，代价是每次说话多花相应 token。</p>
      <textarea id="set-persona" rows="8" spellcheck="false" placeholder="例：你是蓝毛小女仆，说话慢半拍，喜欢用短句，偶尔有点小坏心思。"></textarea>
      <p id="set-persona-note" class="shint"></p>

      <h2 class="sh">记忆</h2>
      <div class="srow2">
        <div><label for="set-rounds">带多少轮对话</label>
          <input id="set-rounds" type="number" min="0" max="200" step="1" inputmode="numeric"></div>
        <div><label for="set-recall">每次回捞往事</label>
          <input id="set-recall" type="number" min="0" max="50" step="1" inputmode="numeric"></div>
      </div>
      <p class="shint">轮数是「每次说话时把最近多少轮原始对话带上」，回捞是「按当前话题从往事里翻几条」。都是 0 = 不带。</p>
      <label class="scheck"><input id="set-group" type="checkbox">群聊机器人（关掉 = 纯单人桌宠）</label>
      <div id="set-group-block">
        <div class="srow2">
          <div><label for="set-scope">群成员记忆</label>
            <select id="set-scope">
              <option value="everyone">记得群里每个人</option>
              <option value="recent">只记最近 N 个</option>
            </select></div>
          <div><label for="set-recentn">N（1–100）</label>
            <input id="set-recentn" type="number" min="1" max="100" step="1" inputmode="numeric"></div>
        </div>
        <label class="scheck"><input id="set-ownersync" type="checkbox">把我在群里的发言也记进单人记忆</label>
        <div class="srow2"><div><label for="set-ownerqq">我的 QQ 号</label>
          <input id="set-ownerqq" type="text" inputmode="numeric" autocomplete="off" placeholder="例如 100012345"></div></div>
      </div>

      <h2 class="sh">回话节奏</h2>
      <label class="scheck"><input id="set-split" type="checkbox">分条回复（拆成几条短句逐条发）</label>
      <div class="srow2"><div><label for="set-merge">合并窗口（毫秒，0–3000）</label>
        <input id="set-merge" type="number" min="0" max="3000" step="100" inputmode="numeric"></div></div>
      <p class="shint">合并窗口 = 你连发几条时她先等这么久、攒一起理解再回。0 = 不合并（一句一回）。
        窗口越长越像真人，但回复也会相应晚这么久。默认 800。</p>

      <h2 class="sh">主动聊天</h2>
      <label class="scheck"><input id="set-proactive" type="checkbox">她会自己先开口找你</label>
      <div class="srow2"><div><label for="set-prosec">间隔（秒，120–86400）</label>
        <input id="set-prosec" type="number" min="120" max="86400" step="60" inputmode="numeric"></div></div>
      <p class="shint">每只宠物各算各的。这里和「碎碎念」不是一个开关：碎碎念是自言自语，不写进对话。</p>

      <h2 class="sh">读屏与助手</h2>
      <label class="scheck"><input id="set-screen" type="checkbox">说话前读一眼我的屏幕</label>
      <label class="scheck"><input id="set-assistant" type="checkbox">允许她在对话里动手（在你的工作区里读写文件）</label>
      <div class="srow2">
        <div><label for="set-perm">动手权限</label>
          <select id="set-perm">
            <option value="readonly">只读</option>
            <option value="workspace">工作区内可写</option>
            <option value="full">完全</option>
          </select></div>
      </div>
      <label class="scheck"><input id="set-net" type="checkbox">允许联网</label>

      <div class="srow"><button id="set-save" class="nbtn primary" type="button">保存设置</button></div>
      <p id="set-result" class="msg"></p>
      <p class="shint">配对设备管理只在电脑上做——「哪些手机能连进来」得由坐在电脑前的人决定，
        这台手机上不提供入口。</p>
      <p class="shint" id="set-ver"></p>
    </div>
  </section>
</div>
</body></html>`;

export const mobileStyle = `:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:#0f1218;color:#e8ecf3;font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans SC",sans-serif;
  -webkit-text-size-adjust:100%;overscroll-behavior:none}
#app{height:100%;display:flex;flex-direction:column;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
.screen{flex:1;display:flex;flex-direction:column;min-height:0}
.is-hidden{display:none!important}
#connect{padding:24px 20px;gap:6px;overflow:auto}
#connect h1{font-size:20px;margin:8px 0 4px}
.hint{color:#9aa6b8;font-size:13px;margin:0 0 14px}
label{display:block;font-size:13px;color:#9aa6b8;margin:12px 0 6px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #2a3342;background:#161b24;color:#e8ecf3;font-size:16px}
input:focus{outline:2px solid #4a7cff;outline-offset:1px}
button{font:inherit;padding:12px 18px;border-radius:10px;border:0;background:#3a5bd9;color:#fff;font-weight:600}
button:disabled{opacity:.5}
button.link{background:none;color:#9aa6b8;font-weight:400;padding:6px 8px;font-size:13px}
.row{display:flex;gap:10px;margin-top:18px}
.row button{flex:1}
.msg{min-height:20px;font-size:13px;color:#ff9a9a;margin:10px 0 0}
.msg.ok{color:#7ee0a8}
.tip{margin-top:22px;font-size:13px;color:#9aa6b8}
.tip summary{cursor:pointer;color:#7f8ea6}
.tip ul{margin:8px 0 0;padding-left:20px}
.bar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #1e2530}
#pet-name{font-weight:600;flex:1}
.dot{width:9px;height:9px;border-radius:50%;background:#4b5563}
.dot.on{background:#34d399}
.dot.off{background:#ef4444}
/* 切换面板（2026-11-01）：不盖浮层，直接插在顶部提示条下面把内容挤下去 ——
   手机上「盖住聊天区」的面板容易被当成弹窗误关，插在流里反而一眼看懂这是设置区。 */
.picker{padding:2px 0 10px;background:#121822;border-bottom:1px solid #1e2530}
.phead{padding:10px 14px 2px;font-size:12px;color:#7f8ea6;letter-spacing:.3px}
.plist{display:flex;flex-direction:column}
.pitem{display:flex;align-items:center;gap:8px;width:100%;padding:11px 14px;border:0;border-top:1px solid #1a212c;
  border-radius:0;background:none;color:#e8ecf3;font-size:14px;font-weight:400;text-align:left;line-height:1.3}
.pitem .pname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pitem .psub{flex:0 0 auto;font-size:12px;color:#7f8ea6}
.pitem.on{color:#7ee0a8}
.pitem.on .psub{color:#7ee0a8}
.pitem .pdel{flex:0 0 auto;padding:4px 10px;border-radius:8px;background:#2a3444;color:#ff9a9a;font-size:12px}
.pempty{padding:12px 14px;font-size:13px;color:#7f8ea6}
.prow{display:flex;gap:8px;padding:12px 14px 0}
.prow .nbtn{flex:1}
.stage{position:relative;height:34vh;min-height:180px;max-height:300px;display:flex;align-items:flex-end;justify-content:center;
  background:radial-gradient(120% 80% at 50% 100%,#1b2330 0%,#0f1218 70%);overflow:hidden}
/* 顶部提示条：发消息前同步慢（>1 秒）、或某次操作失败时在这里说人话。 */
.tipbar{margin:0;padding:6px 14px;font-size:12px;line-height:1.5;color:#ffd479;background:#2a2416;border-bottom:1px solid #3b3320}
/* 拖动状态只改光标：位置本身用 transform，交给 pointer 事件算（见 bindDrag）。 */
.pet{cursor:grab}
.pet.dragging{cursor:grabbing}
.pet{width:min(72vw,280px);aspect-ratio:16/9;position:relative;touch-action:none;-webkit-user-select:none;user-select:none}
.pet video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;background:transparent}
.bubble{position:absolute;top:10px;left:50%;transform:translateX(-50%);max-width:86%;
  background:#f3f6fb;color:#14181f;padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.45;
  box-shadow:0 6px 18px rgba(0,0,0,.35);word-break:break-word;z-index:2}
/* 来意档位（与桌面端、安卓悬浮窗同一套语义，取值表在 shared/bubble-kind.ts）：
   calling = 她主动来找你：粉色描边 + 小标题，是最需要你回的那一个
   murmur  = 自言自语：灰底小字，一眼看出不用回
   plain   = 普通提示/对话回复：与改造前一致，不加类 */
.bubble .btag{display:none}
.bubble.tone-calling{border:2px solid rgba(255,138,178,.85);box-shadow:0 6px 18px rgba(255,138,178,.35);cursor:pointer}
.bubble.tone-calling .btag{display:block;font-size:11px;font-weight:700;color:#d9548a;margin-bottom:3px;letter-spacing:.3px}
/* 让它看起来能点：点一下把输入框拉到眼前（见 showBubble 里的 onclick）。
   桌面端用的是同一句话（index.html 的 .pet-bub-tag::after），两端不能各写一套说法 */
.bubble.tone-calling .btag::after{content:'（点一下回她）';font-weight:400;opacity:.75}
.bubble.tone-calling #bubble-text{font-weight:600}
.bubble.tone-murmur{background:#e9edf4;color:#3c4658;font-size:13px;font-style:italic;box-shadow:0 4px 12px rgba(0,0,0,.25)}
.bubble.tone-murmur .btag{display:block;font-size:10px;color:#7f8ea6;margin-bottom:2px}
.chat{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
.b{max-width:82%;padding:9px 13px;border-radius:14px;font-size:15px;white-space:pre-wrap;word-break:break-word}
.b.u{align-self:flex-end;background:#3a5bd9;color:#fff;border-bottom-right-radius:5px}
.b.a{align-self:flex-start;background:#1b2230;color:#e8ecf3;border-bottom-left-radius:5px}
.b.sys{align-self:center;background:none;color:#7f8ea6;font-size:12px;padding:2px 8px}
/* 「她主动来找你」这条消息本身（宿主写进记忆的 assistant，origin=proactive）：
   粉色左边线 + 小标题。它本来就在对话流里，所以**不再另顶一个顶部气泡**——
   同一句话说两遍才是乱的（用户 2026-11-01 报的）。 */
.b.pro{align-self:flex-start;background:#221620;color:#f6e9ef;border-left:2.5px solid rgba(255,138,178,.9);border-bottom-left-radius:5px}
.b.pro .ptag{display:block;font-size:11px;font-weight:700;color:#ff9dc4;margin-bottom:3px}
.selfai{padding:8px 14px;border-top:1px solid #1e2530;background:#111722}
#selfai-form{padding:6px 0 2px}
#selfai-form label{display:block;font-size:12px;color:#9fb0c8;margin:8px 0 4px}
#selfai-form input{width:100%}
.composer{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #1e2530;background:#0d1117}
.composer input{flex:1}
.mic{padding:12px;background:#1b2230;font-size:18px;line-height:1}
.mic.rec{background:#b91c1c}
/* 三个原生开关：只在 APK 里显示（没有 PetNative 时整块隐藏，见 mobileScript）。 */
.native{padding:8px 14px;border-top:1px solid #1e2530;background:#111722}
.nrow{display:flex;align-items:center;gap:8px;padding:5px 0}
.nlabel{flex:0 0 auto;font-size:13px;color:#c8d2e0}
.nsub{flex:1;font-size:12px;color:#7f8ea6;text-align:right}
.nbtn{flex:0 0 auto;padding:6px 12px;font-size:13px;border-radius:8px;background:#2a3444}
.nbtn.on{background:#1f7a4d}
.sh{margin:20px 14px 6px;font-size:13px;font-weight:600;color:#9fb0c7;letter-spacing:.3px}
.shint{margin:0 14px 8px;font-size:12px;line-height:1.6;color:#7f8ea6}
.sscroll{flex:1;min-height:0;overflow-y:auto;padding-bottom:28px;-webkit-overflow-scrolling:touch}
#setts .bar{gap:10px}
#set-title{flex:1;font-weight:600}
.sscroll textarea,.sscroll input,.sscroll select{width:100%;margin:0 0 4px;padding:10px 12px;border:1px solid #26303e;
  border-radius:10px;background:#151b25;color:#e8ecf3;font:14px/1.55 inherit;-webkit-appearance:none}
.sscroll textarea{margin:0 14px 6px;width:calc(100% - 28px);resize:vertical;min-height:120px;font-size:14px}
.sscroll select{appearance:none}
.sscroll label{display:block;font-size:12px;color:#7f8ea6;margin:0 0 4px}
.srow2{display:flex;gap:10px;padding:0 14px}
.srow2>div{flex:1;min-width:0}
/* 勾选行：.sscroll label 那条 display:block 会把这里的 flex 顶掉（它多一个元素选择器，
   优先级更高），结果复选框和文字叠在一起 —— 截图里「分条回复」的框压着第一个字。
   所以选择器写成 .sscroll label.scheck，比它多一个类；再把这行 input 的 padding /
   border 清掉（.sscroll input 那条给所有输入框加了 10px 12px 内边距，会把 18px 的
   复选框撑变形）。 */
.sscroll label.scheck{display:flex;align-items:center;gap:10px;margin:10px 14px;font-size:14px;color:#e8ecf3}
.sscroll label.scheck input{width:18px;height:18px;flex:0 0 auto;margin:0;padding:0;border:0;background:none;-webkit-appearance:checkbox;appearance:auto}
.srow{display:flex;gap:10px;padding:16px 14px 0}
.srow .nbtn{flex:1;padding:12px;font-size:15px}
.nbtn.primary{background:#1f7a4d;color:#eafff3}
#set-group-block.is-hidden{display:none}
#setts .msg{margin:8px 14px 0}
`;

export const mobileScript = `'use strict';
(function(){
  // 多宿主（2026-11-01，用户原话：「手机端可以同时配对两者，但是一次只能使用一份数据，
  // 玩家自己选独立端或者插件端」）：
  //   LS_HOSTS  = 配对过的电脑列表 [{id,host,token,label,pets,at}]，id 是电脑自报的 hostId；
  //   LS_ACTIVE = 当前正在用的那台。
  // 一台手机可能配过两台电脑（插件端 2 只 / 独立端 3 只），两边的宠物、对话、离线队列
  // **绝不能混**：所以宠物选择、本地副本、离线队列、拖动位置一律按宿主 id 分键（见 pk）。
  var LS_HOSTS='dshpet.hosts', LS_ACTIVE='dshpet.active';
  // 老版本的三个键：只在启动时读一次做迁移，别处不再写。
  var LS_HOST='dshpet.host', LS_TOKEN='dshpet.token', LS_PET='dshpet.pet';
  var LS_DEV='dshpet.device', LS_DEVNAME='dshpet.deviceName';
  // 离线三件套（2026-11-01，用户拍板「不在同一 WIFI 只有手机能写，回来是追加」）：
  //   LS_MIRROR —— 上一次同步到的对话副本，电脑连不上时照旧能看；
  //   LS_OUTBOX —— 离线期间写下的话（带永久编号），回到同一网络整段补进电脑记忆；
  //   LS_AI*    —— 可选的"手机自己聊"密钥，默认不设。存不存由用户自己决定。
  var LS_MIRROR='dshpet.mirror', LS_OUTBOX='dshpet.outbox';
  var LS_AIURL='dshpet.aiurl', LS_AIMODEL='dshpet.aimodel', LS_AIKEY='dshpet.aikey';

  // ---- 配对过的电脑（多宿主）----
  // 按宿主 id 分键：换宿主之后读不到另一台的宠物、对话副本与离线队列 —— 这就是
  // 「一次只用一份数据」的落地方式（不是靠界面藏起来，是数据本身就分开存）。
  function pk(name){
    return name+'@'+(state.hostId||'none');
  }
  function readProfiles(){
    try{var a=JSON.parse(localStorage.getItem(LS_HOSTS)||'[]');return Array.isArray(a)?a:[]}catch(e){return []}
  }
  function writeProfiles(a){
    // 上限 8 台：这是人手动配对的列表，不是日志；写多了 localStorage 会被别的东西挤掉。
    try{localStorage.setItem(LS_HOSTS,JSON.stringify(a.slice(0,8)))}catch(e){}
  }
  function getActiveId(){try{return localStorage.getItem(LS_ACTIVE)||''}catch(e){return ''}}
  function setActiveId(id){try{localStorage.setItem(LS_ACTIVE,id||'')}catch(e){}}
  function profileById(id){
    var a=readProfiles();
    for(var i=0;i<a.length;i++)if(a[i]&&a[i].id===id)return a[i];
    return null;
  }
  function upsertProfile(p){
    var a=readProfiles(),hit=false;
    for(var i=0;i<a.length;i++){
      if(a[i]&&a[i].id===p.id){a[i]=p;hit=true}
    }
    if(!hit)a.push(p);
    writeProfiles(a);setActiveId(p.id);
    return p;
  }
  // 老版本只存了一个 host+token：升级过来的人不该被要求重新配对一次。
  // 先记成 id='legacy:'+地址，等这台电脑下次真正配对时换成它自报的 hostId。
  function migrateLegacy(){
    if(readProfiles().length)return;
    var h='',t='';
    try{h=localStorage.getItem(LS_HOST)||'';t=localStorage.getItem(LS_TOKEN)||''}catch(e){}
    if(!h||!t)return;
    upsertProfile({id:'legacy:'+h,host:h,token:t,label:'',pets:[],at:Date.now()});
  }

  // ---- 本地副本 ----
  function saveMirror(list){
    try{localStorage.setItem(pk(LS_MIRROR),JSON.stringify({pet:state.pet,at:Date.now(),items:list.slice(-200)}))}catch(e){}
  }
  function readMirror(){
    try{
      var o=JSON.parse(localStorage.getItem(pk(LS_MIRROR))||'null');
      if(!o||!o.pet)return null;
      // 离线启动时 state.pet 还是空的（它平时由 loadConfig 从电脑拉回来）。
      // 这里**必须**用副本里记的宠物 id 把 state.pet 补上，否则：
      //   ① 副本永远被判成「不是这只宠物的」→ 整块丢弃 → 退回连接页（手机变砖头）；
      //   ② 之后排队发出去的消息 pet 字段是空的，回家也归不到正确的那只。
      if(!state.pet)state.pet=o.pet;
      return o.pet===state.pet?o:null;
    }catch(e){return null}
  }
  // ---- 离线队列 ----
  function outbox(){
    try{var a=JSON.parse(localStorage.getItem(pk(LS_OUTBOX))||'[]');return Array.isArray(a)?a:[]}catch(e){return []}
  }
  function setOutbox(a){
    try{localStorage.setItem(pk(LS_OUTBOX),JSON.stringify(a))}catch(e){}
  }
  function queueCount(){return outbox().filter(function(m){return m.pet===state.pet}).length}
  function queueMsg(role,content,ts){
    var a=outbox();
    a.push({
      // 编号与宿主 memory-io 的 assignIds 同一命名空间：回家合并时按编号去重就不会写两遍。
      id:'m-'+(state.pet||'pet').replace(/[^A-Za-z0-9_-]/g,'')+'-'+Math.floor(ts).toString(36)+'-q'+Math.random().toString(36).slice(2,6),
      role:role,content:content,ts:ts,pet:state.pet
    });
    setOutbox(a);
  }
  // 回家：把离线期间写的话整段补进电脑（按编号去重，重复传也安全）。只追加消息，
  // 摘要/事实卡不在这里改 —— 那些只能由电脑算（见 host/sync-append.ts 文件头）。
  function flushOutbox(){
    var mine=outbox().filter(function(m){return m.pet===state.pet});
    if(!mine.length)return Promise.resolve(0);
    return api('/dsh-pet-7340/sync/append?pet='+encodeURIComponent(state.pet),
      {method:'POST',body:JSON.stringify({messages:mine.map(function(m){
        return {id:m.id,role:m.role,content:m.content,ts:m.ts,origin:m.origin||'offline'};
      })})}).then(function(j){
        if(j&&j.ok){
          setOutbox(outbox().filter(function(m){return m.pet!==state.pet}));
          return (j.added||0);
        }
        return 0;
      });
  }
  // ---- 手机自己聊（可选）----
  function aiConf(){
    var key='',url='',model='';
    try{key=localStorage.getItem(LS_AIKEY)||'';url=localStorage.getItem(LS_AIURL)||'';model=localStorage.getItem(LS_AIMODEL)||''}catch(e){}
    return {key:key,url:url||'https://api.deepseek.com/v1',model:model||'deepseek-chat'};
  }
  // 直接问模型要一句回复。只在「电脑连不上 + 用户自己开了密钥」时走这条路。
  function askAI(text){
    var c=aiConf();
    // 结尾的斜杠去掉再拼路径。这里**不能写正则字面量**：这段代码长在本文件的模板字符串里，
    // 正则里转义的斜杠会被模板字符串吃掉，产出一个坏掉的正则 —— 浏览器直接 SyntaxError，
    // 整段脚本不执行（页面看着正常，实际一个按钮都没接上）。用循环比正则稳。
    var u=String(c.url||'');
    while(u.slice(-1)==='/')u=u.slice(0,-1);
    return fetch(u+'/chat/completions',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+c.key},
      body:JSON.stringify({model:c.model,messages:[
        {role:'system',content:'你是手机桌宠里的角色，用户正在手机上和你说活。回答简短、口语、一到两句。'},
        {role:'user',content:text}
      ]})}).then(function(r){return r.json().then(function(j){
        if(!r.ok)throw new Error((j&&j.error&&j.error.message)||('HTTP '+r.status));
        var t=j&&j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content;
        if(!t)throw new Error('模型没有返回内容');
        return String(t).trim();
      })});
  }
  // 这台手机的稳定标识（2026-11-01）：给电脑认人用，只在配对时生成一次。
  // 电脑靠它判断两件事：①「这台手机还在不在这个网络」（每次请求都是一个心跳）
  // ②「它是不是已经被移出配对」（被删的 id 会被 403，必须重新配对）。
  function deviceId(){
    var v='';
    try{v=localStorage.getItem(LS_DEV)||''}catch(e){}
    if(!v){
      v='d-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
      try{localStorage.setItem(LS_DEV,v)}catch(e){}
    }
    return v;
  }
  function deviceName(){
    var n='';
    try{n=localStorage.getItem(LS_DEVNAME)||''}catch(e){}
    if(!n){
      var ua=navigator.userAgent||'';
      // 注意：本段在模板字符串里，正则里的反斜杠要写两份，才会原样产出一个反斜杠加右括号
      // —— 只写一份会被模板字符串吃掉，产出一个**非法正则**，整段脚本直接 SyntaxError。
      var m=ua.match(/Android[^;]*;([^)]+)\\)/);
      n=((m&&m[1])||'手机').trim().slice(0,40);
      try{localStorage.setItem(LS_DEVNAME,n)}catch(e){}
    }
    return n;
  }
  var $=function(id){return document.getElementById(id)};
  // assetRoot：**素材根**，与 pet 的 id 是两回事。
  // /config 的顶层键就是素材根（main / columbina / nahida），其下 pets[] 才是实例（columbina1…）。
  // /thumb/<素材根>/<名>.webm —— 第一段必须是素材根，填实例 id 会 404（多实例共享同一套素材）。
  var state={base:'',token:'',pet:'',assetRoot:'',timer:null,since:null,cur:null,busy:false,
    // hostId：当前在用哪台电脑（配对时由电脑自报，老版本升级上来的是 'legacy:地址'）。
    // pets：这台电脑上的宠物清单，来自 /config —— 换宠物只在这份清单里挑。
    // local：APK 里随包带的动画清单 {素材根:[名字…]}（用户要求「电脑端能放的动画手机也放」，
    //        所以打包时把 assets 下所有 webm 一起塞进 www/pets/）；浏览器形态下这份清单取不到，
    //        自动退回向电脑现取（见 assetUrl）。
    hostId:'',pets:[],local:null,idleTimer:null,
    // cfgVer：上一次看到的「配置版本」（/state 里的 sections.config.counter）。
    // 手机设置的同步就靠它：宿主每次写配置都会更新这个 counter，长轮询当场就能看到，
    // 不需要新增接口，也不用多挂一条轮询。
    cfgVer:0,
    // overlayOn：悬浮窗开着时页面里弹出的话也推一份过去——用户此刻可能正在别的 App 里，
    // 只看得到悬浮宠物，看不到这个页面。
    idle:'',click:'',pool:{idle:[],click:[],actions:[]},pos:{x:0,y:0},overlayOn:false};

  function api(path,opt){
    opt=opt||{};
    var url=state.base+path;
    // 设备头同时在干两件事：心跳（证明"这台手机在电脑旁边"）+ 身份（被删的设备能认出来）。
    // 少了它，电脑无法判断手机在不在，只能永远当"在家"处理 —— 那就等于没有接管判定。
    var headers={'X-DSH-Pet-Token':state.token,'X-DSH-Pet-Device':deviceId()};
    if(opt.body!==undefined)headers['Content-Type']='application/json';
    return fetch(url,{method:opt.method||'GET',headers:headers,body:opt.body,cache:'no-store'})
      .then(function(r){
        return r.text().then(function(t){
          var j=null;try{j=JSON.parse(t)}catch(e){}
          if(!r.ok){
            // 把 HTTP 状态挂到错误上：调用方要能分清"口令失效"(401/403) 与"网络/超时"
            // —— 前者该退回连接页重配，后者只需提示重试。只带 message 就分不出来。
            var err=new Error((j&&(j.error||j.message))||('HTTP '+r.status));
            err.status=r.status;
            throw err;
          }
          return j;
        });
      });
  }

  // ---- 连接 ----
  function normalizeHost(v){
    v=String(v||'').trim().replace(/^https?:\\/\\//,'').replace(/\\/+$/,'');
    return v;
  }
  function showConnect(msg,ok){
    $('connect').classList.remove('is-hidden');
    $('main').classList.add('is-hidden');
    var m=$('connect-msg');m.textContent=msg||'';m.className='msg'+(ok?' ok':'');
  }
  function showMain(){
    $('connect').classList.add('is-hidden');
    $('main').classList.remove('is-hidden');
  }
  function connect(host,pin){
    host=normalizeHost(host);
    if(!host){showConnect('请填电脑地址');return}
    // 协议跟随**当前页面**：服务对外只监听 HTTPS（局域网 http 不是安全上下文，
    // 浏览器会禁掉麦克风与语音识别），写死 'http://' 会让配对请求打到没人监听的端口上。
    var base=location.protocol+'//'+host;
    $('connect-btn').disabled=true;
    showConnect('正在配对…',true);
    fetch(base+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({pin:pin,deviceId:deviceId(),deviceName:deviceName()})})
      .then(function(r){return r.text().then(function(t){var j=null;try{j=JSON.parse(t)}catch(e){};if(!r.ok)throw new Error((j&&j.message)||('HTTP '+r.status));return j})})
      .then(function(j){
        if(!j||!j.token)throw new Error('配对失败');
        state.base=base;state.token=j.token;
        // 配对成功 = 多一条宿主记录（不是覆盖上一条）。电脑自报的 hostId 优先当身份键：
        // 它不随网络/端口变化，所以「插件端」「独立端」两条连接可以长期共存、随时切换。
        // 老电脑（没有 hostId）退化成按地址记。
        var id=(j&&j.hostId)?String(j.hostId):('h:'+host);
        state.hostId=id;
        upsertProfile({id:id,host:host,token:j.token,label:'',pets:[],at:Date.now()});
        // 老键顺手清掉：留着会让下次启动的迁移逻辑把旧地址又变出一条记录
        try{localStorage.removeItem(LS_HOST);localStorage.removeItem(LS_TOKEN)}catch(e){}
        return boot();
      })
      .catch(function(e){
        showConnect('连不上：'+e.message+'（确认同一 Wi-Fi / 电脑上桌宠开着 / 配对码没过期）');
      })
      .then(function(){$('connect-btn').disabled=false});
  }
    function boot(){
    showMain();
    return loadConfig().then(function(){
      startPoll();
      startScreenLoop();
      return loadHistory();
    }).catch(function(e){
      // 令牌失效（电脑重启就会换新口令）应该**直接退回连接页**，而不是停在主界面
      // 报一句看不懂的"请从桌宠菜单重新打开设置" —— 用户看不出那是口令过期了。
      // 判据用 401/403：那是"你是谁我不认"，与"连不上"（超时/网络）要给的提示完全不同。
      var msg=String((e&&e.message)||'');
      if(e&&e.status===401||e&&e.status===403||/令牌|token|unauthor/i.test(msg)){
        // 只清**这一台**的令牌：手机可能还配着另一台能用的电脑，
        // 全清掉会把人家辛辛苦苦配的记录一起弄丢。
        var dead=profileById(state.hostId);
        if(dead){dead.token='';upsertProfile(dead)}
        state.token='';
        stopPoll();stopScreenLoop();
        showConnect('电脑换了新的口令（重启过桌宠），请回电脑重新拿一次配对码。',true);
        return;
      }
      // 连不上电脑（超时/被墙/换了网络）**不要退回连接页**：那样等于把手机变成砖头，
      // 用户连上次的对话都看不到。进离线模式：显示本地副本 + 离线期间说的话先排队。
      var m=readMirror();
      var last=profileById(state.hostId);
      var canLocal=!!(last&&last.pet&&last.assetRoot&&state.local&&state.local[last.assetRoot]);
      // 没有本地副本、但包里有这只的动画 → 仍然进离线模式：手机自己就是一台能看宠物的设备。
      // （用户要的是「电脑端能放的动画，手机 APP 也放」，那么连不上电脑不该等于看不见宠物。）
      if(m||canLocal){
        state.offline=true;
        showMain();
        $('chat').innerHTML='';
        var items=(m&&m.items)||[];
        items.forEach(function(x){addBubble(x.role,x.content,x.origin)});
        addBubble('sys','现在连不上电脑（'+msg+'）。'+(m?'下面是上次同步过来的对话；':'这台电脑的对话还没同步过；')+'你现在说的话会先存在手机上，回到同一网络后自动补进去。');
        // 离线也要有宠物：素材与动画都在包里（见 loadLocalPack），用的是上次这只。
        if(canLocal){
          state.pet=last.pet;state.assetRoot=last.assetRoot;
          // 待机名/点击名/动作池都从宿主记录恢复：离线时没有 /config 可问，
          // 少了这三样就只剩下「知道是哪只、但不知道该播哪个文件」。
          state.idle=last.idle||'';state.click=last.click||'';
          state.pool=last.pool||{idle:[],click:[],actions:[]};
          // 这台电脑上有几只也从记录恢复 —— 离线时切换面板要能列出全部宠物，
          // 每只的素材都在包里，切过去就该直接播（不用等回到同一 Wi-Fi）。
          if(last.list&&last.list.length){
            state.pets=last.list.map(function(p){
              return {id:p.id,name:p.name,assetRoot:p.assetRoot,idle:p.idle,click:p.click,
                      pool:(p.id===last.pet?state.pool:{idle:[],click:[],actions:[]})};
            });
          }
          $('pet-name').textContent=last.petName||last.pet;
          renderPicker();
          mountPet();
          startIdleLoop();
        }
        startPoll();
        return;
      }
      showConnect('已连上但读取失败：'+msg);
      stopPoll();
    });
  }
  function loadConfig(){
    return api('/dsh-pet-7340/config').then(function(cfg){
      // 顶层键 = 素材根，其下 pets[] = 实例。要把两者一起记住：
      // 素材（webm）按素材根取，对话/状态按实例 id 取。
      var pets=[];
      Object.keys(cfg||{}).forEach(function(k){
        var e=cfg[k];if(!e||typeof e!=='object')return;
        // 待机与点击的**真实文件名**只能从配置里拿：main 的待机叫「待机呼吸休闲」，
        // 哥伦比娅的叫「待机呼吸」。写死任何一个都会让另一只在首帧 404、舞台空着。
        var anims=(e&&e.animations)||{};
        var idle0=(Array.isArray(anims.idle)&&anims.idle[0])||'';
        var click0=(Array.isArray(anims.clicks)&&anims.clicks[0])||'';
        // 同一素材根下的实例共享一套动画池：算一次，挂到每只身上。
        var pool=animPool(anims);
        if(Array.isArray(e.pets))e.pets.forEach(function(p){
          if(p&&p.id)pets.push({id:p.id,name:p.name,assetRoot:(p.assetRoot||k),idle:idle0,click:click0,pool:pool});
        });
      });
      if(!pets.length)throw new Error('电脑上还没有宠物');
      state.pets=pets;
      var want=localStorage.getItem(pk(LS_PET));
      var hit=pets.filter(function(p){return p.id===want})[0]||pets[0];
      state.pet=hit.id;state.assetRoot=hit.assetRoot;
      state.idle=hit.idle||'待机呼吸';state.click=hit.click||'';
      state.pool=hit.pool||{idle:[],click:[],actions:[]};
      localStorage.setItem(pk(LS_PET),state.pet);
      $('pet-name').textContent=hit.name||hit.id;
      // 宿主记录里存一份「几台、几宠物」的快照：切换面板要在**没连上**的时候也能说清
      // 「这一条是 3 只的那台」还是「2 只的那台」。
      var prof=profileById(state.hostId);
      if(prof){
        prof.pets=pets.map(function(p){return p.name||p.id});
        prof.label=pets.length+' 只 · '+(pets[0].name||pets[0].id);
        prof.at=Date.now();
        // 记住上次用的是哪只：离线启动时没有 /config，只能靠这份记录把宠物画出来。
        // 连 idle/click/动作池一起存：离线启动时没有 /config，光有「哪只」画不出画面 ——
        // 待机文件名是「待机呼吸休闲」这种，猜不出来（猜「待机呼吸」就 404、舞台全黑）。
        prof.pet=state.pet;prof.assetRoot=state.assetRoot;prof.petName=hit.name||hit.id;
        prof.idle=state.idle;prof.click=state.click;prof.pool=state.pool;
        // 整份「这台电脑上有几只、每只播哪个文件」也存下来：手机带着全部动画，
        // 但没这份表就只画得出上次那一只，切换面板里其余几只是空的（用户要的是「能切换」）。
        prof.list=pets.map(function(p){
          return {id:p.id,name:p.name,assetRoot:p.assetRoot,idle:p.idle,click:p.click};
        });
        upsertProfile(prof);
      }
      mountPet();
      renderPicker();
      startIdleLoop();
    });
  }

  // ---- 待机循环 ----
  // 电脑端本来就会自己随机放动作（state.ts 的 idle/actions 池），手机原来只有一条待机 webm 在
  // loop。这里每 18–32 秒（随机，避免多台设备同拍）在不忙、页面可见时随机放一个动作，放完回待机。
  // 间隔不能太短：这些是 5–15 秒的整段动画，连着播就成了「一直跳舞」，不像待机。
  function startIdleLoop(){
    stopIdleLoop();
    function step(){
      state.idleTimer=setTimeout(function(){
        // 离线也放：包里有素材就能换着播（这正是「把全部动画放进手机」换来的）。
        // 只有「离线且包里没素材」才静默 —— 那时播放只会 404，看着像卡住。
        if(!state.busy&&(!state.offline||state.local)&&!document.hidden&&window.__petOnce){
          // 优先放动作（玩魔方、伸懒腰这类），没有动作池就换一条待机变体。
          var n=pickAnim('actions')||pickAnim('idle');
          if(n)window.__petOnce(n);
        }
        step();
      },18000+Math.floor(Math.random()*14000));
    }
    step();
  }
  function stopIdleLoop(){if(state.idleTimer){clearTimeout(state.idleTimer);state.idleTimer=null}}

  // ---- 换宠物 / 换电脑 ----
  // 用户原话（2026-11-01）：「手机显示宠物可以切换」「手机端可以同时配对两者，但是一次只能
  // 使用一份数据，玩家自己选独立端或者插件端」。所以这里是两个维度：
  //   换宠物 = 同一台电脑上换一只（对话、记忆、素材都按宠物在宿主侧分域）；
  //   换电脑 = 换数据源（插件端 2 只 / 独立端 3 只），本地副本与离线队列本来就按宿主 id 分键，
  //            所以切过去看到的是那一台自己的对话，不会串。
  function switchPet(id){
    var hit=state.pets.filter(function(p){return p.id===id})[0];
    if(!hit){return}
    if(hit.id===state.pet){closePicker();return}
    // 离线换宠物只允许「包里有这只的动画」的情况：没有素材还切过去，舞台就空了，
    // 看着像坏了。提示一句比黑屏好。
    if(state.offline&&(!state.local||!state.local[hit.assetRoot])){
      tip('这只的动画还没存到手机上，连回电脑后才能切',2600);
      return;
    }
    state.pet=hit.id;state.assetRoot=hit.assetRoot;
    state.idle=hit.idle||'待机呼吸';state.click=hit.click||'';
    state.pool=hit.pool||{idle:[],click:[],actions:[]};
    try{localStorage.setItem(pk(LS_PET),state.pet)}catch(e){}
    $('pet-name').textContent=hit.name||hit.id;
    // 对话与气泡都是按宠物分域的，换宠物必须整块重来：
    // 不重来就会把上一只说的话贴到这一只脸上，用户会以为是记忆串了。
    stopIdleLoop();
    $('chat').innerHTML='';
    state.since=null;state.cur=null;
    mountPet();
    startIdleLoop();
    renderPicker();
    if(state.offline){
      var m=readMirror();
      if(m)(m.items||[]).forEach(function(x){addBubble(x.role,x.content,x.origin)});
    }else{
      loadHistory().catch(function(){});
    }
  }
  function switchHost(id){
    if(id===state.hostId){closePicker();return}
    var p=profileById(id);
    if(!p||!p.token)return;
    stopPoll();stopIdleLoop();stopScreenLoop();
    state.cur=null;state.since=null;$('chat').innerHTML='';
    state.offline=false;
    state.hostId=p.id;state.base=location.protocol+'//'+p.host;state.token=p.token;
    // 换电脑 = 换一整套数据（用户的「一次只用一份」）。上一台的宠物、素材根、动画池、
    // 宠物清单和已下载的 blob 全部作废，否则会拿 A 的宠物去读 B 的本地副本 ——
    // readMirror() 会因为「副本里记的宠物不是现在这只」而整块丢弃，界面就停在上一台的样子。
    state.pet=p.pet||'';state.assetRoot=p.assetRoot||'';
    state.idle=p.idle||'';state.click=p.click||'';state.pool=p.pool||{idle:[],click:[],actions:[]};
    state.pets=[];
    $('pet-name').textContent=p.petName||p.pet||'';
    blobCache={};
    setActiveId(p.id);
    closePicker();
    boot().then(function(){refreshSelfai()}).catch(function(){});
  }
  function forgetHost(id){
    var a=readProfiles().filter(function(x){return x&&x.id!==id});
    writeProfiles(a);
    if(state.hostId===id){
      stopPoll();stopIdleLoop();stopScreenLoop();
      state.token='';state.hostId='';
      // 还有别的电脑就直接切过去；一台都不剩才回连接页 —— 删一台不该把手机变砖头。
      if(a.length){switchHost(a[0].id);return}
      showConnect('');
      return;
    }
    renderPicker();
  }
  var pickOpen=false;
  function openPicker(){pickOpen=true;$('picker').classList.remove('is-hidden');renderPicker()}
  function closePicker(){pickOpen=false;$('picker').classList.add('is-hidden')}
  function row(cls){
    var d=document.createElement('div');d.className=cls;return d;
  }
  function cell(cls,txt){var s=document.createElement('span');s.className=cls;s.textContent=txt;return s}
  function renderPicker(){
    if(!pickOpen)return;
    var box=$('pick-pets');box.innerHTML='';
    if(!state.pets.length){
      var e=document.createElement('div');e.className='pempty';e.textContent='还没读到这台电脑的宠物列表（连不上电脑时只显示已同步的那一只）';box.appendChild(e);
    }else{
      state.pets.forEach(function(p){
        var r=row('pitem'+(p.id===state.pet?' on':''));
        r.appendChild(cell('pname',p.name||p.id));
        r.appendChild(cell('psub',p.id===state.pet?'当前':''));
        r.addEventListener('click',function(){switchPet(p.id)});
        box.appendChild(r);
      });
    }
    var hb=$('pick-hosts');hb.innerHTML='';
    var list=readProfiles();
    if(!list.length){
      var e2=document.createElement('div');e2.className='pempty';e2.textContent='还没配过任何电脑';hb.appendChild(e2);
    }else{
      list.forEach(function(p){
        var on=p.id===state.hostId;
        var r=row('pitem'+(on?' on':''));
        r.appendChild(cell('pname',p.label||p.host||p.id));
        r.appendChild(cell('psub',on?'当前':''));
        r.addEventListener('click',function(){switchHost(p.id)});
        // 移除按钮：删的是「这台电脑的配对」，不是删宠物。删完如果它是当前那台，
        // 会自动切到另一台；全删完才回连接页。
        var del=document.createElement('button');
        del.type='button';del.className='pdel';del.textContent='移除';
        del.addEventListener('click',function(ev){
          ev.stopPropagation();
          forgetHost(p.id);
        });
        r.appendChild(del);
        hb.appendChild(r);
      });
    }
  }
  function bindPicker(){
    var b=$('pick-btn');
    if(b)b.addEventListener('click',function(){
      if(pickOpen)closePicker();else openPicker();
    });
    var c=$('pick-close');
    if(c)c.addEventListener('click',closePicker);
    var a=$('pick-add');
    if(a)a.addEventListener('click',function(){
      closePicker();
      // 不清任何记录：只是回到连接页再配一台，配完两台都在列表里。
      showConnect('');
    });
  }
  // ---- 动画池（2026-11-01 用户追加：「把电脑端所有动画放进手机APP里，电脑端能放的动画、
  // 待机动画循环这些，手机APP也放」）----
  // 池子只装**名字**，与桌面端同一套语义（名字即文件名，精确匹配，没有模糊回退）。
  // 待机/点击取 animations.idle / animations.clicks；可随机播放的动作取 moves.actions 与
  // categories[].actions（与桌面端 state.ts 的动作来源一致）。
  function animPool(a){
    a=a||{};
    function str(x){return typeof x==='string'&&x?x:''}
    var idle=(Array.isArray(a.idle)?a.idle.map(str):[]).filter(Boolean);
    var click=(Array.isArray(a.clicks)?a.clicks.map(str):[]).filter(Boolean);
    var acts=[];
    var mv=a.moves&&Array.isArray(a.moves.actions)?a.moves.actions:[];
    mv.forEach(function(x){var n=str(x)||(x&&str(x.name))||'';if(n)acts.push(n)});
    var cats=Array.isArray(a.categories)?a.categories:[];
    cats.forEach(function(c){
      if(!c||!Array.isArray(c.actions))return;
      c.actions.forEach(function(x){var n=str(x)||(x&&str(x.name))||'';if(n)acts.push(n)});
    });
    // 去重但保序：同一只的动作在不同类别里重名很常见（比如「原地踱步」）。
    function uniq(list){
      var out=[],seen={};
      list.forEach(function(n){if(!seen[n]){seen[n]=1;out.push(n)}});
      return out;
    }
    return {idle:uniq(idle),click:uniq(click),actions:uniq(acts)};
  }
  // 随机挑一个「手机上真有素材」的名字。local 为 null（浏览器形态）时不过滤 —— 素材现从电脑取，
  // 取不到就 play() 返回 null，不会把舞台弄黑（旧层还在）。
  function pickAnim(kind){
    var pool=state.pool||{},src=pool[kind]||[];
    var have=(state.local&&state.local[state.assetRoot])||null;
    // 离线启动时拿不到 /config，池子是空的 —— 此时包内清单就是唯一的池子
    // （这正是「把电脑端所有动画放进手机」换来的能力：不联网也能换着放）。
    if(!src.length&&have)src=have.slice();
    if(!src.length)return '';
    if(have&&have.length){
      var idx={};have.forEach(function(n){idx[n]=1});
      var ok=src.filter(function(n){return idx[n]});
      if(!ok.length)return '';           // 这套素材里一个都没有 → 宁可不播，也别 404 换黑屏
      src=ok;
    }
    var pick=src[Math.floor(Math.random()*src.length)]||'';
    // 别把正在放的这条再抽一次（看着像卡住）。
    if(state.cur&&state.cur.__name===pick&&src.length>1){
      pick=src[(src.indexOf(pick)+1)%src.length];
    }
    return pick;
  }
  // APK 随包动画清单：打包脚本写 www/pets/manifest.json。取不到就当没有（浏览器形态）。
  function loadLocalPack(){
    return fetch('pets/manifest.json',{cache:'force-cache'})
      .then(function(r){return r.ok?r.json():null})
      .then(function(j){
        state.local=(j&&typeof j==='object')?j:null;
      })
      .catch(function(){state.local=null});
  }
  function localUrl(name){
    var have=(state.local&&state.local[state.assetRoot])||null;
    if(!have)return '';
    for(var i=0;i<have.length;i++)if(have[i]===name)return 'pets/'+encodeURIComponent(state.assetRoot)+'/'+encodeURIComponent(name)+'.webm';
    return '';
  }
  function assetUrl(name){
    // 先查包内素材：手机离线时电脑不可达，只有这条路能出画面（这也是「放着动画」的意义）。
    var local=localUrl(name);
    if(local)return local;
    return state.base+'/dsh-pet-7340/thumb/'+encodeURIComponent(state.assetRoot)+'/'+encodeURIComponent(name)+'.webm';
  }
  // 素材必须走 fetch + blob，不能直接把 URL 塞进 <video src>：
  // 远程模式（手机连电脑）下每个请求都要令牌，而 <video src> **发不了自定义 header**，
  // 直接塞 src 会稳定 403、宠物整只不显示。桌面端也是这么做的（src/client/pet.ts 的
  // "素材加载走 fetch+blob"）。blob URL 记住并复用，19 段素材各取一次就够。
  var blobCache={};
  function grab(url,token){
    var opt={cache:'force-cache'};
    // 令牌只对电脑发（包内文件是本地读，带上无害但没必要；这里按需带，免得以后有人误以为
    // 本地素材也要令牌，把 fetch 改坏了查半天）。
    if(token)opt.headers={'X-DSH-Pet-Token':state.token};
    return fetch(url,opt).then(function(r){
      if(!r.ok)throw new Error('素材 HTTP '+r.status);
      return r.blob();
    });
  }
  function fetchAsset(name){
    // 缓存键带素材根：换宠物后同名素材（「待机呼吸」哥伦比娅和纳西妲都有）绝不能串。
    var key=state.assetRoot+'/'+name;
    if(blobCache[key])return Promise.resolve(blobCache[key]);
    var local=localUrl(name);
    var task=local?grab(local,false).catch(function(){
      // 清单说有、文件却不在（打包漏了/被删）：退回向电脑取，别把宠物弄没。
      return grab(assetUrl(name),true);
    }):grab(assetUrl(name),true);
    return task
      .then(function(b){
        var u=URL.createObjectURL(b);
        blobCache[key]=u;
        return u;
      });
  }
  function mountPet(){
    var host=$('pet');host.innerHTML='';
    // once=true：这个动作只放一遍，放完回到待机。
    // 待机循环本身是一条 loop 的 webm；随机动作（伸懒腰、玩魔方…）如果也 loop，
    // 宠物会卡在动作最后一帧不动 —— 手机端原来只有待机一条动画，所以没暴露这个区别。
    function play(name,once){
      if(!name)return Promise.resolve(null);
      return fetchAsset(name).then(function(u){
        var nv=document.createElement('video');
        nv.muted=true;nv.defaultMuted=true;nv.playsInline=true;nv.setAttribute('webkit-playsinline','');
        nv.loop=!once;nv.preload='auto';nv.setAttribute('disablepictureinpicture','');
        nv.__name=name;nv.src=u;
        return new Promise(function(res){
          nv.oncanplay=function(){
            host.appendChild(nv);
            nv.play().catch(function(){});
            var old=state.cur;state.cur=nv;
            // 旧层等新层真的开始出帧再摘（§8.3 坑 33：不要用固定时长等画面）
            if(old&&old!==nv){
              var drop=function(){if(old.parentNode)old.parentNode.removeChild(old)};
              if(nv.requestVideoFrameCallback)nv.requestVideoFrameCallback(drop);
              else requestAnimationFrame(function(){requestAnimationFrame(drop)});
            }
            res(nv);
          };
          nv.onerror=function(){res(null)};
          // 单次动作播完回待机。必须**先**判「还是不是当前层」：用户在动作播到一半时点了
          // 别的宠物/别的动作，这个 ended 才迟一步到，此时回待机会把新画面顶掉。
          if(once)nv.onended=function(){
            if(state.cur===nv)play(state.idle||'待机呼吸');
          };
        });
      }).catch(function(){return null});
    }
    // 首帧：有配置来的待机名就用它；没有（离线启动）就从包内清单里挑一条真实存在的 ——
    // 「待机呼吸」这种猜出来的名字在蓝毛的池子里不存在，硬播只会黑屏。
    play(state.idle||pickAnim('idle')||'待机呼吸');
    window.__petAnim=function(name){
      if(!name||(state.cur&&state.cur.__name===name))return;
      play(name);
    };
    // 放一遍就回待机（现点什么、待机随机动作都走这条）。同名正在播就不重开，
    // 否则点两下会把同一段从头再放，看着像卡住。
    window.__petOnce=function(name){
      if(!name)return;
      if(state.cur&&state.cur.__name===name&&!state.cur.ended)return;
      play(name,true);
    };
    loadPos();
    bindDrag();
    requestAnimationFrame(applyPos);
  }

  // ---- 拖动宠物（手机上原来完全挪不动）----
  // 舞台是 flex 居中 + 底对齐，用 transform 平移最省事：不触发 layout、也不会让 video 重排。
  // 边界按「舞台内可见」算：宠物本来贴底居中，所以 y 只能往上（负值），x 左右对称。
  var drag=null;
  function clampPos(x,y){
    var st=$('stage'),el=$('pet');
    var maxX=Math.max(0,Math.round((st.clientWidth-el.offsetWidth)/2));
    var maxY=Math.max(0,Math.round(st.clientHeight-el.offsetHeight));
    return {x:Math.min(maxX,Math.max(-maxX,x)),y:Math.min(0,Math.max(-maxY,y))};
  }
  function applyPos(){
    var p=clampPos(state.pos.x||0,state.pos.y||0);state.pos=p;
    var el=$('pet');if(el)el.style.transform='translate('+p.x+'px,'+p.y+'px)';
  }
  // 位置按「宿主+宠物」记：插件端那只和独立端那只不该互相覆盖拖到哪儿了。
  function posKey(){return pk('dshpet.petpos')+'/'+(state.pet||'pet')}
  function loadPos(){
    try{
      var v=JSON.parse(localStorage.getItem(posKey())||'null');
      if(v&&typeof v.x==='number'&&typeof v.y==='number')state.pos={x:v.x,y:v.y};
      else state.pos={x:0,y:0};
    }catch(e){}
  }
  function bindDrag(){
    var el=$('pet');if(!el||el.__drag)return;el.__drag=true;
    var TAP=6; // 移动不超过 6px 算「点一下」，与桌面端的判定一致
    el.addEventListener('pointerdown',function(e){
      if(e.button&&e.button!==0)return;
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,ox:state.pos.x,oy:state.pos.y,moved:0,started:false};
      el.classList.add('dragging');
      if(el.setPointerCapture)try{el.setPointerCapture(e.pointerId)}catch(err){}
    });
    el.addEventListener('pointermove',function(e){
      if(!drag||e.pointerId!==drag.id)return;
      var dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      drag.moved=Math.max(drag.moved,Math.abs(dx)+Math.abs(dy));
      if(!drag.started&&drag.moved<TAP)return;
      drag.started=true;
      if(e.cancelable)e.preventDefault();
      state.pos=clampPos(drag.ox+dx,drag.oy+dy);
      el.style.transform='translate('+state.pos.x+'px,'+state.pos.y+'px)';
    });
    function end(e){
      if(!drag||e.pointerId!==drag.id)return;
      var started=drag.started;drag=null;
      el.classList.remove('dragging');
      if(started){try{localStorage.setItem(posKey(),JSON.stringify(state.pos))}catch(err){};return}
      // 没挪动 = 点了一下：跟桌面端一样给一次「点击回应」。
      // 池子里有几条（开心跃动／害羞惊讶／傲娇生气…）就随机挑一条，否则每次都同一段像卡住；
      // 单次播放、放完回待机 —— 点击回应是"回应"，不该变成新待机。
      var one=pickAnim('click')||state.click;
      if(one&&window.__petOnce)window.__petOnce(one);
    }
    el.addEventListener('pointerup',end);
    el.addEventListener('pointercancel',function(e){drag=null;el.classList.remove('dragging')});
  }

  // ---- 轮询 /state ----
  function startPoll(){stopPoll();tick()}
  function stopPoll(){if(state.timer){clearTimeout(state.timer);state.timer=null}}
  function setConn(ok){$('conn-state').className='dot '+(ok?'on':'off')}
  function tick(){
    flushIfPossible();
    // timeout 上限是 10000（宿主回 invalid timeout (expect 0..10000)），
    // 传更大值会 400 → 长轮询永远失败、气泡与换动画全部收不到。
    var path='/dsh-pet-7340/state';
    if(state.since!==null)path+='?since='+encodeURIComponent(state.since)+'&timeout=10000';
    api(path).then(function(s){
      setConn(true);
      if(s&&s.counter!==undefined)state.since=s.counter;
      if(s&&s.sections&&s.sections.config){
        // 配置版本变了 = 有人改过设置（电脑设置页 / 另一台手机 / 桌面右键改显示位置）。
        // 首拍只记基线：否则一进页面就当作「被别人改了」，白刷一次设置屏。
        var cf=s.sections.config.counter;
        if(cf!==state.cfgVer){
          if(state.cfgVer)sxOnConfigSignal();
          state.cfgVer=cf;
        }
      }
      if(s){
        // /state 的形状：pets.<实例id>.{ say, anim, position, throw, lock }，
        // 每一项都是 { counter, data } 叶子 —— anim 与 say **并列**，不是 say.data.anim。
        var p=s.pets&&s.pets[state.pet];
        if(p){
          var say=p.say&&p.say.data;
          if(say&&say.text)showBubble(say.text,say.origin);
          var anim=p.anim&&p.anim.data;
          if(anim){
            if(anim.name)window.__petAnim(anim.name);
            // url 形态（第三方给的完整地址）本页不播：手机上跨域取视频还要过 CORS，
            // 而这条路径的用途是"给宿主所在那一端演一段"，手机端不是它的目标端。
          }
        }
      }
      state.timer=setTimeout(tick,300);
    }).catch(function(){
      setConn(false);
      state.timer=setTimeout(tick,3000);
    });
  }
  var bubbleTimer=null;
  // 来意 → 长相。**这份字面量必须与 src/shared/bubble-kind.ts 的 SAY_LOOKS 逐字段相等**，
  // 由 src/standalone/mobile-page.test.ts 逐字段比对（手机页是纯字符串模板、不能 import，
  // 所以用测试把两份钉在一起，而不是靠人记得同步）。
  var SAY_LOOK={"proactive":{"label":"她主动来找你","tone":"calling","hold":0,"focus":true},"whisper":{"label":"自言自语","tone":"murmur","hold":4000,"focus":false},"note":{"label":"","tone":"plain","hold":10000,"focus":false}};
  function sayLook(origin){
    return SAY_LOOK[origin==='proactive'||origin==='whisper'?origin:'note'];
  }
  function showBubble(text,origin){
    var look=sayLook(origin);
    // ★「她主动来找你」这条**不弹顶部气泡**：宿主已经把它写成一条 assistant 消息进了记忆，
    // 打开 App 就能在下面的对话流里看到（还带粉色「她主动来找你」小标题）。
    // 顶上再顶一个同样的气泡 = 同一句话说两遍，屏幕更乱（用户 2026-11-01 的反馈）。
    // 碎碎念不写记忆、对话流里没有，所以只有它还需要气泡这个出口。
    if(look.tone==='calling'){
      // 不弹气泡，但**必须把对话流刷新一次**：这条已经写进记忆了，用户打开 App 就该在
      // 下面看到它（带粉色「她主动来找你」小标题）。早先只在 say 变化时弹气泡、不刷历史，
      // 结果这条谁也不显示 —— 气泡被自己压掉、对话流又要等用户手动发一句才刷新，
      // 实测（2026-11-01 模拟器）症状就是「她说话了但 App 里什么都没有」。
      loadHistory().catch(function(){});
      if(state.overlayOn&&native)pushOverlay(text,origin);
      return;
    }
    var b=$('bubble');var tag=$('bubble-tag');var body=$('bubble-text');
    b.className='bubble'+(look.tone!=='plain'?' tone-'+look.tone:'');
    tag.textContent=look.label||'';
    body.textContent=text;
    if(bubbleTimer){clearTimeout(bubbleTimer);bubbleTimer=null}
    // hold=0 表示不自动消失（她主动来找你，得等你回一句）
    var hold=look.hold>0?Math.max(look.hold,Math.min(30000,text.length*220)):0;
    if(hold>0)bubbleTimer=setTimeout(function(){b.classList.add('is-hidden')},hold);
    // 抢焦点：暗示"该你回了"（只在她主动来找你时做，碎碎念不打扰打字）
    if(look.focus)try{$('text').focus()}catch(e){}
    // 「她主动来找你」这条可点：手机页的对话区本来就在下面，但用户盯着气泡时未必知道要往下滑，
    // 所以点一下 = 把聊天区滚到底 + 光标放进输入框。
    // **气泡不在这里收起**：用户只是点开了输入框，还没回话；它要一直挂着等她被下一句顶掉
    // （回完话宿主写新的 say，showBubble 自然覆盖它）。
    b.onclick = look.tone === 'calling' ? function () {
      focusChat();
    } : null;
    if(state.overlayOn&&native)pushOverlay(text,origin);
  }
  // 悬浮窗（别的 App 之上那层）与页内气泡是两条出口：页内不弹的那条，悬浮窗照样要显示，
  // 因为用户可能正看着别的 App，那里才是他唯一看得见的地方。
  function pushOverlay(text,origin){
    try{
      var p=native.overlaySay({text:text,origin:origin||''});
      if(p&&p.catch)p.catch(function(){});
    }catch(e){}
  }

  // ---- 对话 ----
  function addBubble(role,text,origin){
    var d=document.createElement('div');
    var pro=origin==='proactive';
    d.className='b '+(role==='user'?'u':role==='assistant'?(pro?'a pro':'a'):'sys');
    if(pro){
      var t=document.createElement('span');
      t.className='ptag';
      t.textContent='她主动来找你';
      d.appendChild(t);
    }
    d.appendChild(document.createTextNode(text));
    $('chat').appendChild(d);
    $('chat').scrollTop=$('chat').scrollHeight;
    return d;
  }
  function loadHistory(){
    return api('/dsh-pet-7340/chat/history?pet='+encodeURIComponent(state.pet)+'&rounds=20').then(function(j){
      $('chat').innerHTML='';
      var list=(j&&j.messages)||[];
      if(!list.length)addBubble('sys','还没有对话记录。说句话开始吧。');
      list.forEach(function(m){addBubble(m.role,m.content,m.origin)});
      // 每次成功拉到历史就刷新本地副本：手机断网后可读；也是"回家合并"的对照基线。
      saveMirror(list.map(function(m){return {role:m.role,content:m.content,origin:m.origin}}));
      state.offline=false;
    });
  }
  // ---- 顶部提示条 ----
  var tipTimer=null;
  function tip(text,keepMs){
    var t=$('tip');if(!t)return;
    t.textContent=text||'';
    if(text)t.classList.remove('is-hidden');else t.classList.add('is-hidden');
    if(tipTimer){clearTimeout(tipTimer);tipTimer=null}
    if(text&&keepMs)tipTimer=setTimeout(function(){tip('')},keepMs);
  }

  // 发消息前**先同步一次**电脑上的最新记录，再把自己的话追加在后面。
  // 不这么做的话：电脑那边刚说完一句、手机这边的长轮询还没收到，手机上先画出自己那句，
  // 等轮询回来又插进一条更早的 assistant，屏幕上先后就反了（记忆里其实是对的）。
  // 同步 = 拉一拍 /state（拿 counter 当 since）+ 重画历史；两件都是**读**，不改任何数据。
  function syncBeforeSend(){
    var t0=Date.now();
    return api('/dsh-pet-7340/state').then(function(s){
      if(s&&s.counter!==undefined)state.since=s.counter;
      var p=s&&s.pets&&s.pets[state.pet];
      if(p){
        var say=p.say&&p.say.data;
        if(say&&say.text)showBubble(say.text,say.origin);
        var anim=p.anim&&p.anim.data;
        if(anim&&anim.name)window.__petAnim(anim.name);
      }
      return loadHistory();
    }).then(function(){return Date.now()-t0});
  }

  // 离线发一句（2026-11-01）：这条路径**不写电脑的记忆**，只在手机本地排队。
  //   - 用户开了「手机自己聊」的密钥 → 由手机自己生成回复，两条都进队列；
  //   - 没开 → 只把用户这句排上，回来后电脑自己接（她那时才看到你说过什么）。
  function sendOffline(text){
    var now=Date.now();
    queueMsg('user',text,now);
    addBubble('user',text);
    var c=aiConf();
    if(!c.key){
      addBubble('sys','先存在手机上了（现在是离线）。回到和电脑同一个网络，这句会自动补进对话——她会接着回你。');
      return Promise.resolve();
    }
    var pending=addBubble('sys','（手机自己回，稍等…）');
    return askAI(text).then(function(t){
      if(pending.parentNode)pending.parentNode.removeChild(pending);
      queueMsg('assistant',t,Date.now());
      showBubble(t,'reply');
      addBubble('assistant',t);
      addBubble('sys','这句是手机自己回的，已经排进队列，回到同一网络后一并补进电脑的对话记录。');
    }).catch(function(e){
      if(pending.parentNode)pending.parentNode.removeChild(pending);
      addBubble('sys','手机自己聊失败：'+e.message+'（你这句话已经存下来了，回去后电脑会接）');
    });
  }
  function send(text){
    text=String(text||'').trim();
    if(!text||state.busy)return;
    if(state.offline){
      $('text').value='';
      state.busy=true;$('send').disabled=true;
      sendOffline(text).then(function(){state.busy=false;$('send').disabled=false});
      return;
    }
    state.busy=true;$('send').disabled=true;
    $('text').value='';
    // 同步期间先停长轮询：两个 /state 同时在跑会各自推进 since，容易漏掉一拍
    stopPoll();
    var slow=setTimeout(function(){tip('同步已超过 1 秒，网络有点慢，再等一下…')},1000);
    syncBeforeSend().then(function(ms){
      clearTimeout(slow);
      // 超过 1 秒必须让用户看见，否则他会以为那句话没发出去
      if(ms>1000)tip('已同步（用了 '+(ms/1000).toFixed(1)+' 秒），现在发送',2600);
      else tip('');
      addBubble('user',text);
      var pending=addBubble('sys','…');
      // 电脑那边可能在回上一句（宿主是单条串行队列），2.5 秒还没回就把「…」换成原因
      var wait=setTimeout(function(){pending.textContent='电脑那边还在回上一句，这句排在后面…'},2500);
      // surface=any：手机是远程客户端，宠物在电脑上是 desktop 还是 web 都该能聊
      //（写死 web 会让 display:desktop 的宠物直接被宿主拒掉，见 host/surface.ts 的表）
      return api('/dsh-pet-7340/chat?pet='+encodeURIComponent(state.pet)+'&surface=any',
        {method:'POST',body:JSON.stringify({text:text})})
        .then(function(j){
          clearTimeout(wait);
          if(pending.parentNode)pending.parentNode.removeChild(pending);
          if(!j||j.ok===false){
            addBubble('sys','失败：'+((j&&(j.message||j.reason))||'未知'));
            return;
          }
          if(j.text)showBubble(j.text);
          // 回复到了再重画一次历史：两端几乎同时说话时，屏幕上的顺序严格等于记忆里的顺序。
          // 重画失败不影响这一句已经显示出来，所以单独吞掉。
          return loadHistory().catch(function(){});
        })
        .catch(function(e){
          clearTimeout(wait);
          if(pending.parentNode)pending.parentNode.removeChild(pending);
          // 没有 HTTP 状态 = 压根没连上（有状态的失败是电脑明确拒绝，那种要如实报错）。
          // 没连上时不能把这句丢掉：转成离线排队，回到同一网络自动补进去。
          if(!e||e.status===undefined){
            state.offline=true;
            addBubble('sys','和电脑的连接断了（'+e.message+'）。这句先存在手机上，回到同一网络后自动补进对话。');
            queueMsg('user',text,Date.now());
            return;
          }
          addBubble('sys','发送失败：'+e.message);
        });
    }).catch(function(e){
      clearTimeout(slow);
      tip('');
      addBubble('sys','同步失败：'+e.message);
    }).then(function(){
      state.busy=false;$('send').disabled=false;
      startPoll();
    });
  }

  // ---- 语音 ----
  var rec=null,recOn=false;
  function hasNative(){return !!(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.PetVoice)}
  function startVoice(){
    if(hasNative()){
      window.Capacitor.Plugins.PetVoice.start({},function(res){
        if(res&&res.text)$('text').value=res.text;
      },function(err){addBubble('sys','语音识别失败：'+(err&&err.message||err))});
      return;
    }
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){addBubble('sys','这个浏览器不支持语音输入。可以先用打字，或者用手机 App。');return}
    if(recOn){if(rec)rec.stop();return}
    rec=new SR();rec.lang='zh-CN';rec.interimResults=true;rec.continuous=false;
    rec.onresult=function(e){
      var t='';
      for(var i=e.resultIndex;i<e.results.length;i++)t+=e.results[i][0].transcript;
      $('text').value=t;
      if(e.results[e.results.length-1].isFinal){recOn=false;$('mic').classList.remove('rec');send(t)}
    };
    rec.onerror=function(e){
      recOn=false;$('mic').classList.remove('rec');
      addBubble('sys','语音识别失败：'+(e.error||'未知'));
    };
    rec.onend=function(){recOn=false;$('mic').classList.remove('rec')};
    recOn=true;$('mic').classList.add('rec');rec.start();
  }

  // ---- 原生能力（只在 APK 里存在；纯浏览器打开时整块隐藏）----
  // 这三个开关都要**用户去系统设置里手动开权限**，光点按钮没用：
  //   · 悬浮宠物：SYSTEM_ALERT_WINDOW，Android 上没有任何运行时弹窗能授予
  //   · 语音唤醒：要麦克风 + 常驻前台服务（耗电，默认关）
  //   · 读屏：AccessibilityService，只能在系统无障碍列表里手开
  // 所以每个按钮的职责是「检查 → 没用就带去授权页 → 回来再检查」，而不是"点一下就开"。
  var native = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PetNative) || null;
  function nmsg(t, bad) {
    var m = $('native-msg');
    if (!m) return;
    m.textContent = t || '';
    m.className = 'msg' + (bad ? '' : ' ok');
  }
  function nbtn(id, text, on) {
    var b = $(id);
    if (!b) return;
    b.textContent = text;
    b.className = 'nbtn' + (on ? ' on' : '');
  }
  function focusChat() {
    var c = $('chat'); if (c) c.scrollTop = c.scrollHeight;
    var t = $('text');
    if (t) { try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } }
  }
  function refreshNative() {
    if (!native) return;
    // 悬浮窗
    native.overlayStatus().then(function (r) {
      var granted = r && r.granted === true;
      var running = r && r.running === true;
      state.overlayOn = !!(granted && running);
      $('ov-state').textContent = !granted ? '需要授权' : running ? '开着' : '可以开';
      nbtn('ov-btn', !granted ? '去授权' : running ? '关' : '开', running);
    }).catch(function () { $('ov-state').textContent = '不可用'; });
    // 语音唤醒
    native.wakeStatus().then(function (r) {
      var running = r && r.running === true;
      $('wk-state').textContent = running ? '正在听' : '关';
      nbtn('wk-btn', running ? '关' : '开', running);
    }).catch(function () { $('wk-state').textContent = '不可用'; });
    // 读屏
    native.readerStatus().then(function (r) {
      var conn = r && r.connected === true;
      var chars = (r && r.chars) || 0;
      $('rd-state').textContent = conn ? '已连接 · 最近 ' + chars + ' 字' : '未开启';
      nbtn('rd-btn', conn ? '已开' : '去开', conn);
    }).catch(function () { $('rd-state').textContent = '不可用'; });
  }
  if (native) {
    $('native').classList.remove('is-hidden');
    // 冷启动把连接信息交给原生（悬浮窗/唤醒服务要在没有主界面时也能自恢复）
    native.loadConn().then(function (r) {
      // 原生里已有连接信息、网页这边却没登录 → 直接用它，省得用户重配一次
      if (r && r.host && r.token && !state.token) {
        state.base = location.protocol + '//' + r.host;
        state.token = r.token;
        // 原生记忆里只有地址+令牌（没有电脑自报的 hostId）：先按地址记一条，
        // 等这台电脑下次连上、/config 回来时再补全。直接写旧键会让整套多宿主失效。
        var nid = 'h:' + String(r.host);
        state.hostId = nid;
        upsertProfile({ id: nid, host: r.host, token: r.token, label: '', pets: [], at: Date.now() });
        boot().catch(function () {});
      }
      refreshNative();
      // 上次悬浮窗是开着的、这次冷启动它却没起来（被系统回收 / 权限被关）：
      // 同样按保底处理 —— 把聊天区推到眼前，并说清「悬浮窗没了但 App 还能用」。
      native.overlayStatus().then(function (r2) {
        var want = false;
        try { want = localStorage.getItem('dshpet.overlayWanted') === '1'; } catch (e) {}
        if (want && (!r2 || r2.running !== true)) {
          nmsg('悬浮宠物这次没起来（可能被系统回收了，或权限被关）。你直接在这里聊就行。', true);
          focusChat();
        }
      }).catch(function () {});
    }).catch(refreshNative);
    $('ov-btn').addEventListener('click', function () {
      native.overlayStatus().then(function (r) {
        if (!r.granted) {
          nmsg('要给「显示在其他应用上层」的权限：点「去授权」进系统设置，找到本 App 打开它。'
            + '不想给也没关系——宠物就留在下面这个页面里陪你聊，功能一样。');
          return native.overlayRequest();
        }
        if (r.running) {
          try { localStorage.setItem('dshpet.overlayWanted', '0'); } catch (e) {}
          return native.overlayStop().then(function () { nmsg('已收起悬浮宠物。'); setTimeout(refreshNative, 600); });
        }
        return native.overlayStart().then(function (res) {
          if (res && res.needPermission) {
            // 保底（任务 6）：悬浮窗开不起来时，绝不能把用户丢在「没有宠物」的状态里。
            // App 本体就是一只会聊天的桌宠 —— 把聊天区顶到眼前、光标放进输入框。
            nmsg('悬浮窗没开成（权限没给）。宠物就留在这个页面里陪你聊，功能一样。', true);
            focusChat();
            return native.overlayRequest();
          }
          try { localStorage.setItem('dshpet.overlayWanted', '1'); } catch (e) {}
          nmsg('悬浮宠物已放出。它现在浮在别的 App 上面；想收起来点「关」。');
          setTimeout(refreshNative, 800);
        });
      }).catch(function (e) {
        nmsg('悬浮窗起不来（' + ((e && e.message) || e) + '）。不影响聊天：宠物就在这个页面里。', true);
        focusChat();
      });
    });

    $('wk-btn').addEventListener('click', function () {
      native.wakeStatus().then(function (r) {
        if (r.running) {
          return native.wakeStop().then(function () { nmsg('已关掉语音唤醒。'); setTimeout(refreshNative, 600); });
        }
        if (r.available === false) {
          nmsg('这台系统没有可用的语音识别引擎，唤醒用不了（可以先用麦克风按钮说话）。', true);
          return;
        }
        native.wakeStart().then(function (res) {
          if (res && res.needPermission) {
            nmsg('需要麦克风权限。请再点一次「开」，系统会弹授权框。', true);
            return;
          }
          if (res && res.reason === 'no-engine') {
            nmsg('系统没有语音识别引擎，唤醒用不了。', true);
            return;
          }
          nmsg('开始听你叫它了。喊一声「哥伦比娅」试试（会持续耗电，不用时记得关）。');
          setTimeout(refreshNative, 800);
        });
      }).catch(function (e) { nmsg('语音唤醒操作失败：' + (e && e.message || e), true); });
    });

    $('rd-btn').addEventListener('click', function () {
      native.readerStatus().then(function (r) {
        if (r && r.connected) {
          nmsg('读屏已在工作。碎碎念与对话会带上「你此刻屏幕上的文字」。');
          return;
        }
        nmsg('读屏要在系统的「无障碍」里手动开：点「去开」进设置，找到「桌宠读屏」打开它。');
        native.readerRequest();
      }).catch(function (e) { nmsg('读屏操作失败：' + (e && e.message || e), true); });
    });
  }

  // ---- 事件 ----
  $('connect-btn').addEventListener('click',function(){connect($('host').value,$('pin').value)});
  $('composer').addEventListener('submit',function(e){e.preventDefault();send($('text').value)});
  $('mic').addEventListener('click',startVoice);
  $('disconnect').addEventListener('click',function(){
    stopPoll();stopIdleLoop();stopScreenLoop();
    // 「断开」= 忘掉当前这台电脑的配对（别的电脑的记录保留，列表里还能切回去）。
    // 老版本是把唯一的 host/token 删掉；现在有多条记录，必须按宿主 id 精确删。
    if(state.hostId)forgetHost(state.hostId);
    else{state.base='';state.token='';state.since=null;showConnect('已断开',true)}
    $('host').value='';$('pin').value='';
    closePicker();
  });
  bindPicker();
  document.addEventListener('visibilitychange',function(){
    if(document.hidden)stopPoll();else if(state.base)startPoll();
  });
  // 转屏 / 键盘弹出会改舞台尺寸：拖动过的位置要按新边界重新夹一次，否则宠物可能被留在屏幕外
  window.addEventListener('resize',applyPos);

  // ---- 读屏上传（把手机的「此刻屏幕」喂给电脑上的碎碎念/对话）----
  // 为什么手机要自己抓、自己传：桌面端读屏走 PowerShell UIA，读的是**电脑**的前台窗口；
  // 手机上聊天时，用户眼前的东西在手机那块屏，电脑那份上下文完全帮不上忙。
  //
  // 节奏取 20 秒而不是每分钟：太慢跟不上「你刚打开微信」这种瞬时场景；
  // 太快则每轮都上传同一段文字，白白占带宽与宿主的日志。20 秒是折中。
  // 只在**已连接且读屏已连通**时才跑，没开读屏时完全不上传（不制造假上下文）。
  var screenTimer = null;
  function pushScreen() {
    if (!native || !state.base || !state.token) return;
    native.readerStatus().then(function (r) {
      if (!r || !r.connected) return;
      return native.readerText().then(function (t) {
        if (!t || !t.connected || !t.text) return;
        // api() 的第二个参数是**选项对象**（{method, body}），不是 (method, body)。
        // 写错会退化成「无 body 的 GET /screen」→ 宿主回 405，而这条链是静默 catch：
        // 读屏上传会悄无声息地永不生效（脚本事后看不出任何报错）。
        // pkg 从 readerStatus 拿：readerText 只回 text，没有包名。
        api('/dsh-pet-7340/screen', { method: 'POST', body: JSON.stringify({ pkg: r.pkg || '', text: t.text }) })
          .catch(function () { /* 上传失败静默：读屏是附加能力，不能打断对话 */ });
      });
    }).catch(function () {});
  }
  function startScreenLoop() {
    if (screenTimer) return;
    pushScreen();
    screenTimer = setInterval(pushScreen, 20000);
  }
  function stopScreenLoop() {
    if (screenTimer) { clearInterval(screenTimer); screenTimer = null; }
  }

  // ---- 手机自己聊（可选密钥）----
  // 默认关闭：不设密钥 = 手机只是远程窗口，一个字都不会自己生成。
  // 打开 = 电脑连不上时由手机自己接话（用户 m04513 的原话是「给选项交给用户决定」）。
  function refreshSelfai() {
    var box = $('selfai');
    if (!box) return;
    box.classList.remove('is-hidden');
    var c = aiConf();
    var st = $('selfai-state');
    if (st) st.textContent = c.key ? ('已开启（' + c.model + '）') : '关';
    var u = $('selfai-url'), m = $('selfai-model');
    if (u && !u.value) u.value = c.url;
    if (m && !m.value) m.value = c.model;
    var q = queueCount();
    if (q > 0) {
      addBubbleOnce('sys', '离线期间有 ' + q + ' 条还没有补进电脑，连上后会自动补。');
    }
  }
  // 队列提示只提示一次，别每轮刷新都往对话流里塞一条
  var saidQueue = false;
  function addBubbleOnce(kind, text) {
    if (saidQueue) return;
    saidQueue = true;
    addBubble(kind, text);
  }
  function bindSelfai() {
    var btn = $('selfai-btn'), form = $('selfai-form');
    if (!btn || !form) return;
    btn.addEventListener('click', function () {
      form.classList.toggle('is-hidden');
    });
    var save = $('selfai-save');
    if (save) save.addEventListener('click', function () {
      var key = String(($('selfai-key') || {}).value || '').trim();
      var url = String(($('selfai-url') || {}).value || '').trim();
      var model = String(($('selfai-model') || {}).value || '').trim();
      if (!key) { $('selfai-msg').textContent = '密钥不能为空（不想开就点「清除密钥」）'; return; }
      try {
        localStorage.setItem(LS_AIKEY, key);
        localStorage.setItem(LS_AIURL, url || 'https://api.deepseek.com/v1');
        localStorage.setItem(LS_AIMODEL, model || 'deepseek-chat');
      } catch (e) { $('selfai-msg').textContent = '存不下：' + e.message; return; }
      // 存完立刻清掉输入框里的明文：密钥在 localStorage 里，没必要再多一处留在 DOM 上
      $('selfai-key').value = '';
      $('selfai-msg').textContent = '已保存。连不上电脑时，手机自己接话。';
      refreshSelfai();
    });
    var clr = $('selfai-clear');
    if (clr) clr.addEventListener('click', function () {
      try {
        localStorage.removeItem(LS_AIKEY);
        localStorage.removeItem(LS_AIURL);
        localStorage.removeItem(LS_AIMODEL);
      } catch (e) { }
      $('selfai-key').value = '';
      $('selfai-msg').textContent = '已清除。手机不再自己生成回复。';
      refreshSelfai();
    });
  }
  bindSelfai();

  // ---- 设置屏（2026-11-01）----
  var sxDirty=false;    // 用户手上有没保存的改动：有就不自动覆盖，改为提示
  var sxBusy=false;     // 保存中：防止连点两下发两遍
  var sxLoadedAt=0;

  function sxShow(msg){
    $('setts').classList.remove('is-hidden');
    $('main').classList.add('is-hidden');
    if(msg)sxNote(msg,false);
    sxLoad();
  }
  function sxHide(){
    $('setts').classList.add('is-hidden');
    $('main').classList.remove('is-hidden');
  }
  function sxNote(text,ok){
    var m=$('set-result');m.textContent=text||'';
    m.className='msg'+(ok?' ok':'');
  }
  function sxSyncNote(text){
    var b=$('set-sync');
    if(!text){b.classList.add('is-hidden');b.textContent='';return}
    b.textContent=text;b.classList.remove('is-hidden');
  }
  function sxGroupVis(){
    var on=$('set-group').checked;
    $('set-group-block').classList.toggle('is-hidden',!on);
    $('set-recentn').disabled=!on||$('set-scope').value!=='recent';
    $('set-ownerqq').disabled=!on||!$('set-ownersync').checked;
  }

  // 读取：人设（按当前宠物）+ 全局设置，两个接口一次并发。
  function sxLoad(){
    if(!state.token){sxNote('还没连上电脑，设置要连上电脑才能改。',false);return Promise.resolve()}
    var pet=state.pet||'';
    if(!pet){sxNote('还没选宠物，先回上一步点一下宠物再进来。',false);return Promise.resolve()}
    sxNote('正在读取…',false);
    return Promise.all([
      api('/dsh-pet-7340/pet-persona?pet='+encodeURIComponent(pet)),
      api('/dsh-pet-7340/assistant/settings')
    ]).then(function(res){
      var per=res[0]||{},st=res[1]||{};
      $('set-title').textContent='设置 · '+(per.pet&&per.pet.name?per.pet.name:pet);
      $('set-persona').value=per.persona||'';
      $('set-persona-note').textContent=per.persona
        ? '这段是这只宠物自己的（'+per.persona.length+' 字），会覆盖电脑上所属条目的默认人设。'
        : (per.entryPersona? '现在留空，生效的是所属条目的默认人设（'+per.entryPersona.length+' 字）。' : '现在留空，也没读到默认人设。');
      $('set-rounds').value=String(typeof st.chatMemoryRounds==='number'?st.chatMemoryRounds:5);
      $('set-recall').value=String(typeof st.memoryRecallK==='number'?st.memoryRecallK:3);
      $('set-group').checked=st.groupBotEnabled===true;
      $('set-scope').value=st.groupMemoryScope==='recent'?'recent':'everyone';
      $('set-recentn').value=String(typeof st.groupMemoryRecentN==='number'?st.groupMemoryRecentN:10);
      $('set-ownersync').checked=st.ownerSyncEnabled===true;
      $('set-ownerqq').value=typeof st.ownerQq==='string'?st.ownerQq:'';
      $('set-split').checked=st.chatSplitEnabled!==false;
      $('set-merge').value=String(typeof st.chatMergeWindowMs==='number'?st.chatMergeWindowMs:800);
      $('set-proactive').checked=st.proactiveChatEnabled===true;
      $('set-prosec').value=String(typeof st.proactiveChatSec==='number'?st.proactiveChatSec:1800);
      $('set-screen').checked=st.screenContextEnabled===true;
      $('set-assistant').checked=st.assistantEnabled===true;
      $('set-perm').value=st.assistantPermission||'readonly';
      $('set-net').checked=st.assistantNetworkEnabled!==false;
      if(st.screenAvailable===false){
        $('set-screen').disabled=true;$('set-screen').checked=false;
        $('set-screen').parentNode.appendChild(document.createTextNode('（这台电脑上找不到读屏脚本，暂时不可用）'));
      }
      $('set-ver').textContent='工作区：'+(st.workspaceRoot||'（未知）');
      sxGroupVis();
      sxDirty=false;
      sxLoadedAt=Date.now();
      sxNote('已读取。改完点下面「保存设置」。',true);
    }).catch(function(e){
      // 口令失效与「电脑不在」要分开说：前者必须回电脑重配，后者等一会儿再试就行。
      if(e&&(e.status===401||e.status===403)){
        sxNote('电脑换了新的口令（重启过桌宠），请回电脑重新拿一次配对码。',false);
      }else{
        sxNote('读不到设置：'+(e&&e.message?e.message:'网络没通')+'。离线时改不了设置，连回电脑再试。',false);
      }
    });
  }

  function sxSave(){
    if(sxBusy)return;
    if(!state.token){sxNote('还没连上电脑，设置要连上电脑才能存。',false);return}
    // 先在本机校验一遍：后端的 topFieldValid 越界会整包拒绝（bad-request），
    // 那样用户只看到「提交的值不合法」，不知道是哪个格子错了。
    var rounds=Number($('set-rounds').value);
    if(!isFinite(rounds)||rounds<0||rounds>200){sxNote('「带多少轮对话」要在 0–200 之间。',false);return}
    var recall=Number($('set-recall').value);
    if(!isFinite(recall)||recall<0||recall>50){sxNote('「每次回捞往事」要在 0–50 之间。',false);return}
    var recentN=Number($('set-recentn').value);
    if($('set-group').checked&&(!isFinite(recentN)||recentN<1||recentN>100)){sxNote('群成员记忆的 N 要在 1–100 之间。',false);return}
    var merge=Number($('set-merge').value);
    if(!isFinite(merge)||merge<0||merge>3000){sxNote('合并窗口要在 0–3000 毫秒之间（0 = 不合并）。',false);return}
    var prosecute=Number($('set-prosec').value);
    if(!isFinite(prosecute)||prosecute<120||prosecute>86400){sxNote('主动聊天间隔要在 120–86400 秒之间（最短 2 分钟）。',false);return}

    sxBusy=true;
    var btn=$('set-save');btn.disabled=true;
    sxNote('正在保存…',false);
    var body={
      chatMemoryRounds:Math.floor(rounds),
      memoryRecallK:Math.floor(recall),
      groupBotEnabled:$('set-group').checked,
      groupMemoryScope:$('set-scope').value==='recent'?'recent':'everyone',
      groupMemoryRecentN:Math.floor(recentN),
      ownerSyncEnabled:$('set-ownersync').checked,
      ownerQq:$('set-ownerqq').value.trim(),
      chatSplitEnabled:$('set-split').checked,
      chatMergeWindowMs:Math.floor(merge),
      proactiveChatEnabled:$('set-proactive').checked,
      proactiveChatSec:Math.floor(prosecute),
      screenContextEnabled:$('set-screen').checked,
      assistantEnabled:$('set-assistant').checked,
      assistantPermission:$('set-perm').value,
      assistantNetworkEnabled:$('set-net').checked
    };
    var persona=$('set-persona').value;
    // 两个接口：设置走 PATCH 语义的 POST（只写 body 里给出的键），人设走 /pet-persona。
    // 人设放第二个，是为了让「设置存了、人设没存」这种半成功能被准确说出口。
    api('/dsh-pet-7340/assistant/settings',{method:'POST',body:JSON.stringify(body)})
      .then(function(r){
        if(r&&r.ok===false)throw new Error(r.message||r.reason||'电脑拒了这组设置');
        return api('/dsh-pet-7340/pet-persona?pet='+encodeURIComponent(state.pet||''),
          {method:'POST',body:JSON.stringify({persona:persona})});
      })
      .then(function(r2){
        if(r2&&r2.ok===false)throw new Error('设置已存，但人设没存上：'+(r2.message||r2.reason||''));
        sxDirty=false;
        sxBusy=false;btn.disabled=false;
        sxNote('已保存。电脑那一端会自己同步。',true);
        return sxLoad();
      })
      .catch(function(e){
        sxBusy=false;btn.disabled=false;
        sxNote('没存上：'+(e&&e.message?e.message:'网络没通')+'。',false);
      });
  }

  /**
   * 配置被别人改过（电脑设置页 / 桌面右键改显示位置 / 另一台手机）。
   * 宿主每次写配置都会写 config 信号叶子，手机在 /state 长轮询里就能看到。
   * 用户手上有未保存的改动时**绝不自动覆盖**——那等于把人家正在写的东西冲掉。
   */
  function sxOnConfigSignal(){
    if($('setts').classList.contains('is-hidden'))return; // 没打开就等下次打开时读
    if(sxDirty){sxSyncNote('另一端改了设置。你这里有没保存的改动，所以没有自动覆盖——想跟电脑一致就点这里重新读取。');return}
    sxSyncNote('');
    sxLoad().then(function(){sxSyncNote('')}).catch(function(){});
  }

  function sxBind(){
    if(!$('set-btn'))return;
    $('set-btn').addEventListener('click',function(){sxShow('')});
    $('set-back').addEventListener('click',function(){sxHide()});
    $('set-save').addEventListener('click',sxSave);
    $('set-group').addEventListener('change',function(){sxDirty=true;sxGroupVis()});
    $('set-scope').addEventListener('change',function(){sxDirty=true;sxGroupVis()});
    $('set-ownersync').addEventListener('change',function(){sxDirty=true;sxGroupVis()});
    // 其余控件：任何一次改动都置脏，同步逻辑据此不覆盖。
    var ids=['set-persona','set-rounds','set-recall','set-recentn','set-ownerqq','set-split','set-merge',
      'set-proactive','set-prosec','set-screen','set-assistant','set-perm','set-net'];
    for(var i=0;i<ids.length;i++){
      (function(id){
        var el=$(id);
        if(!el)return;
        el.addEventListener('input',function(){sxDirty=true});
        el.addEventListener('change',function(){sxDirty=true});
      })(ids[i]);
    }
    $('set-sync').addEventListener('click',function(){
      sxDirty=false;sxSyncNote('');sxLoad();
    });
  }
  sxBind();


  // ---- 回家就补：一发现能连上电脑，就把离线那段整段追加进去 ----
  // 触发点是 /state 长轮询回来（那是「能打到电脑」的唯一可靠信号，不是看 SSID）。
  // 追加成功后才清队列；失败就留着，下一拍再试 —— 顺序与去重都靠消息编号，重复传也安全。
  var flushing = false;
  function flushIfPossible() {
    if (flushing || state.offline) return;
    if (!queueCount()) return;
    flushing = true;
    flushOutbox().then(function (added) {
      flushing = false;
      if (added > 0) {
        tip('把手机上的 ' + added + ' 条补进电脑了', 3000);
        return loadHistory().catch(function () {});
      }
    }).catch(function () { flushing = false; });
  }

  // ---- 启动 ----
  // 多宿主的启动顺序：
  //   ① 老版本的单条 host/token 迁成一条记录（不逼已经配过的人重配）；
  //   ② 先取包内动画清单（决定「本地播」还是「向电脑取」，mountPet 第一帧就要用）；
  //   ③ 按「上次在用的那台」恢复；没有就取列表里第一台。
  migrateLegacy();
  function activate(id){
    var p=profileById(id);
    if(!p||!p.token){showConnect('');return Promise.resolve()}
    state.hostId=p.id;
    // 协议跟随页面：存下来的只有 host:port，怎么打开的（https）就怎么连。
    state.base=location.protocol+'//'+p.host;
    state.token=p.token;
    setActiveId(p.id);
    return boot();
  }
  loadLocalPack().then(function(){
    var act=getActiveId();
    var prof=act?profileById(act):null;
    if(!prof){
      var all=readProfiles();
      if(all.length)prof=all[0];
    }
    if(prof&&prof.token){
      return activate(prof.id).then(function(){refreshSelfai();startScreenLoop()});
    }
    showConnect('');
  }).catch(function(){showConnect('')});
})();`;
