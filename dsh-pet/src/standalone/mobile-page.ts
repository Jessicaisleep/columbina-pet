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
      <button id="disconnect" type="button" class="link">断开</button>
    </header>
    <p id="tip" class="tipbar is-hidden"></p>
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
.nbtn.on{background:#1f7a4d}`;

export const mobileScript = `'use strict';
(function(){
  var LS_HOST='dshpet.host', LS_TOKEN='dshpet.token', LS_PET='dshpet.pet';
  var LS_DEV='dshpet.device', LS_DEVNAME='dshpet.deviceName';
  // 离线三件套（2026-11-01，用户拍板「不在同一 WIFI 只有手机能写，回来是追加」）：
  //   LS_MIRROR —— 上一次同步到的对话副本，电脑连不上时照旧能看；
  //   LS_OUTBOX —— 离线期间写下的话（带永久编号），回到同一网络整段补进电脑记忆；
  //   LS_AI*    —— 可选的"手机自己聊"密钥，默认不设。存不存由用户自己决定。
  var LS_MIRROR='dshpet.mirror', LS_OUTBOX='dshpet.outbox';
  var LS_AIURL='dshpet.aiurl', LS_AIMODEL='dshpet.aimodel', LS_AIKEY='dshpet.aikey';

  // ---- 本地副本 ----
  function saveMirror(list){
    try{localStorage.setItem(LS_MIRROR,JSON.stringify({pet:state.pet,at:Date.now(),items:list.slice(-200)}))}catch(e){}
  }
  function readMirror(){
    try{
      var o=JSON.parse(localStorage.getItem(LS_MIRROR)||'null');
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
    try{var a=JSON.parse(localStorage.getItem(LS_OUTBOX)||'[]');return Array.isArray(a)?a:[]}catch(e){return []}
  }
  function setOutbox(a){
    try{localStorage.setItem(LS_OUTBOX,JSON.stringify(a))}catch(e){}
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
    // overlayOn：悬浮窗开着时页面里弹出的话也推一份过去——用户此刻可能正在别的 App 里，
    // 只看得到悬浮宠物，看不到这个页面。
    idle:'',click:'',pos:{x:0,y:0},overlayOn:false};

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
        localStorage.setItem(LS_HOST,host);localStorage.setItem(LS_TOKEN,j.token);
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
        localStorage.removeItem(LS_TOKEN);
        state.token='';
        stopPoll();stopScreenLoop();
        showConnect('电脑换了新的口令（重启过桌宠），请回电脑重新拿一次配对码。',true);
        return;
      }
      // 连不上电脑（超时/被墙/换了网络）**不要退回连接页**：那样等于把手机变成砖头，
      // 用户连上次的对话都看不到。进离线模式：显示本地副本 + 离线期间说的话先排队。
      var m=readMirror();
      if(m){
        state.offline=true;
        showMain();
        $('chat').innerHTML='';
        var items=m.items||[];
        items.forEach(function(x){addBubble(x.role,x.content,x.origin)});
        addBubble('sys','现在连不上电脑（'+msg+'）。下面是上次同步过来的对话；你现在说的话会先存在手机上，回到同一网络后自动补进去。');
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
        if(Array.isArray(e.pets))e.pets.forEach(function(p){
          if(p&&p.id)pets.push({id:p.id,name:p.name,assetRoot:(p.assetRoot||k),idle:idle0,click:click0});
        });
      });
      if(!pets.length)throw new Error('电脑上还没有宠物');
      var want=localStorage.getItem(LS_PET);
      var hit=pets.filter(function(p){return p.id===want})[0]||pets[0];
      state.pet=hit.id;state.assetRoot=hit.assetRoot;
      state.idle=hit.idle||'待机呼吸';state.click=hit.click||'';
      localStorage.setItem(LS_PET,state.pet);
      $('pet-name').textContent=hit.name||hit.id;
      mountPet();
    });
  }
  function assetUrl(name){
    return state.base+'/dsh-pet-7340/thumb/'+encodeURIComponent(state.assetRoot)+'/'+encodeURIComponent(name)+'.webm';
  }
  // 素材必须走 fetch + blob，不能直接把 URL 塞进 <video src>：
  // 远程模式（手机连电脑）下每个请求都要令牌，而 <video src> **发不了自定义 header**，
  // 直接塞 src 会稳定 403、宠物整只不显示。桌面端也是这么做的（src/client/pet.ts 的
  // "素材加载走 fetch+blob"）。blob URL 记住并复用，19 段素材各取一次就够。
  var blobCache={};
  function fetchAsset(name){
    if(blobCache[name])return Promise.resolve(blobCache[name]);
    return fetch(assetUrl(name),{headers:{'X-DSH-Pet-Token':state.token},cache:'force-cache'})
      .then(function(r){
        if(!r.ok)throw new Error('素材 '+name+' HTTP '+r.status);
        return r.blob();
      })
      .then(function(b){
        var u=URL.createObjectURL(b);
        blobCache[name]=u;
        return u;
      });
  }
  function mountPet(){
    var host=$('pet');host.innerHTML='';
    function play(name){
      if(!name)return Promise.resolve(null);
      return fetchAsset(name).then(function(u){
        var nv=document.createElement('video');
        nv.muted=true;nv.defaultMuted=true;nv.playsInline=true;nv.setAttribute('webkit-playsinline','');
        nv.loop=true;nv.preload='auto';nv.setAttribute('disablepictureinpicture','');
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
        });
      }).catch(function(){return null});
    }
    play(state.idle||'待机呼吸');
    window.__petAnim=function(name){
      if(!name||(state.cur&&state.cur.__name===name))return;
      play(name);
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
  function loadPos(){
    try{
      var v=JSON.parse(localStorage.getItem('dshpet.petpos')||'null');
      if(v&&typeof v.x==='number'&&typeof v.y==='number')state.pos={x:v.x,y:v.y};
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
      if(started){localStorage.setItem('dshpet.petpos',JSON.stringify(state.pos));return}
      // 没挪动 = 点了一下：跟桌面端一样给一次「点击回应」（名字取配置里第一个）
      if(state.click&&window.__petAnim)window.__petAnim(state.click);
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
        localStorage.setItem(LS_HOST, r.host);
        localStorage.setItem(LS_TOKEN, r.token);
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
    stopPoll();
    localStorage.removeItem(LS_HOST);localStorage.removeItem(LS_TOKEN);
    state.base='';state.token='';state.since=null;
    $('host').value='';$('pin').value='';
    showConnect('已断开',true);
  });
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
  // 同样跟随页面协议：用户之前存下的地址只有 host:port，协议由「怎么打开的」决定。
  var savedHost=localStorage.getItem(LS_HOST),savedToken=localStorage.getItem(LS_TOKEN);
  if(savedHost&&savedToken){
    state.base=location.protocol+'//'+savedHost;state.token=savedToken;
    boot().then(function(){refreshSelfai();startScreenLoop();}).catch(function(){showConnect('')});
  }else{
    showConnect('');
  }
})();`;
