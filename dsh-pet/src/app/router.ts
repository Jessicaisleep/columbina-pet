import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { RegisteredRoute } from '../standalone/context';
import { boundedRequest, MAX_REQUEST_BYTES, MAX_SETTINGS_BYTES } from '../standalone/request-body';
import { rejectRequest, MOBILE_SHELL_ORIGINS, type RequestSecurity } from '../standalone/request-security';
import {
  isRevoked,
  OFFLINE_GRACE_MS,
  phoneTakeover,
  takeoverReason,
  type PairedTable,
} from '../standalone/paired-devices';
import { mobilePage, mobileScript, mobileStyle } from '../standalone/mobile-page';
import type { MobileConfig } from '../standalone/mobile-config';
import type { Pairing } from '../standalone/pairing';
import { settingsHandler, testHandler, type StandaloneServerOptions } from '../standalone/server';
import { settingsPage, settingsScript, settingsStyle } from '../standalone/settings-page';

interface RouterDeps {
  security: RequestSecurity;
  ai?: StandaloneServerOptions['ai'];
  log(message: string): void;
  status(port: number): unknown;
  landingPage(port: number): string;
  /** 手机配对（短码换令牌）。不提供 = 手机连接功能未启用。 */
  pairing?: Pairing;
  /** 手机端远程访问是否已开启（运行时可变）。 */
  remoteEnabled?: () => boolean;
  /** 实际监听地址；默认 127.0.0.1（只回环）。手机连接开启时才应传 0.0.0.0。 */
  bindHost?: string;
  /**
   * 对外 HTTPS 的证书（自签）。只在 `bindHost` 不是回环时用得上。
   * 不提供 = 手机连接不可用（宁可没有手机页，也不裸奔明文）。
   */
  tls?: () => { key: string; cert: string } | undefined;
  /**
   * 已配对手机登记表（2026-11-01）。不提供 = 不做「手机接管」判定，行为退回到改造前
   * （电脑永远可写）—— 这是老版本/测试环境的兼容路径。
   */
  devices?: {
    read(): Promise<PairedTable>;
    /** 配对成功时登记（幂等）；返回登记后的表 */
    register(id: string, name?: string): Promise<PairedTable>;
    /** 刷新心跳（手机每次带令牌的请求都会调） */
    touch(id: string, name?: string): Promise<void>;
    /** 删除设备：从表里移除并记进 revoked */
    drop(id: string): Promise<PairedTable>;
  };
  /** 手机连接设置的读写与网卡探测（不提供 = 设置页不显示「手机连接」卡）。 */
  mobile?: {
    read(): MobileConfig;
    write(next: MobileConfig): void;
    lan(): string[];
    /** 启动时服务绑的是不是对外地址（决定「改完要不要重启」）。 */
    listeningWide: boolean;
  };
}

/** 回环来源（与 request-security 同口径；这里只用于决定要不要写 CORS 头）。 */
function isLoopbackPeer(peer: string): boolean {
  return peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
}

/** App HTTP boundary, isolated from Electron so malformed and untrusted requests can be tested. */
export function startRouter(
  routes: RegisteredRoute[],
  deps: RouterDeps,
): Promise<{ port: number; mobilePort: number; close: () => Promise<void> }> {
  const settings = settingsHandler(deps.ai);
  const tester = testHandler(deps.ai);
  let boundPort = 0;
  /** 对外 HTTPS 端口（手机连这个）。0 = 手机连接未开。 */
  let mobilePort = 0;

  /** 配对：手机填地址 + 6 位短码，换回进程令牌。只有设置页生成过票时才可能成功。 */
  const pairHandler = (req: IncomingMessage, res: ServerResponse): void => {
    const pairing = deps.pairing;
    if (!pairing) return void rejectRequest(res, 404, '手机连接未启用');
    if (req.method !== 'POST') return void rejectRequest(res, 405, '配对请使用 POST');
    if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
      return void rejectRequest(res, 415, '配对需要 application/json');
    }
    void boundedRequest(req, res, 1024)
      .then(async (bounded) => {
        if (!bounded) return;
        const raw = await readBodyText(bounded);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return void rejectRequest(res, 400, '请求体不是合法 JSON');
        }
        const pin = (parsed as { pin?: unknown } | null)?.pin;
        if (typeof pin !== 'string') return void rejectRequest(res, 400, '缺少配对码');
        if (!pairing.claim(pin)) {
          // 不区分「码错了」与「票过期了」：两者都给同一句，避免试探服务端状态
          return void rejectRequest(res, 403, '配对码不正确或已过期，请在电脑上重新生成');
        }
        // 登记这台手机（2026-11-01）：配对成功的那一刻是唯一可信的登记时机。
        // deviceId 由手机端生成并长期保存（localStorage），用来区分「同一台」与「新设备」；
        // 缺了也能配对（老版本手机页没有这个字段），只是记不进登记表 → 不参与接管判定。
        const deviceId = (parsed as { deviceId?: unknown } | null)?.deviceId;
        const deviceName = (parsed as { deviceName?: unknown } | null)?.deviceName;
        if (deps.devices && typeof deviceId === 'string' && deviceId.trim() !== '') {
          try {
            await deps.devices.register(
              deviceId.trim(),
              typeof deviceName === 'string' && deviceName.trim() !== '' ? deviceName.trim() : undefined,
            );
            deps.log('已登记配对手机 ' + (typeof deviceName === 'string' ? deviceName.trim() : deviceId.trim()));
          } catch (e) {
            // 登记失败不能连累配对本身：手机连上才算能用，登记表坏了只是退回「不判定接管」
            deps.log('配对手机登记失败（不影响本次配对）：' + (e instanceof Error ? e.message : String(e)));
          }
        }
        deps.log('手机配对成功');
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: true, token: deps.security.token }));
      })
      .catch(() => rejectRequest(res, 400, '配对请求无法处理'));
  };

  /** 请求处理体。HTTP（回环）与 HTTPS（对外）两个 server 共用同一份。 */
  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      rejectRequest(res, 400, '请求地址无效');
      return;
    }
    const peer = req.socket.remoteAddress ?? '';
    const remote = !isLoopbackPeer(peer);
    /**
     * 手机壳（Capacitor/Cordova）的 origin 与局域网地址天然不同源，必须给 CORS。
     *
     * <p>两处都要给，不能只看 remote：APK 里页面是 {@code https://localhost}，
     * 而 adb reverse 场景下请求会从**回环**进来（peer=127.0.0.1）—— 那正是
     * 调试/代理时最常见的情形。只看 remote 的话，回环下的壳请求没有 CORS 头，
     * 预检直接失败（实测 logcat：
     * {@code Access to fetch at '.../pair' from origin 'https://localhost' has been blocked by CORS policy}）。
     *
     * <p>令牌是唯一凭证、且不依赖 Cookie，所以用 `*` 而不是回显 origin。
     * 非壳的普通回环请求（桌面窗口、设置页）仍然不加 —— 保持改造前的严格口径。
     */
    const shellOrigin = typeof req.headers.origin === 'string' && MOBILE_SHELL_ORIGINS.has(req.headers.origin);
    if (remote || shellOrigin) {
      res.setHeader('access-control-allow-origin', '*');
      // x-dsh-pet-device 必须在这里：手机页每次请求都带它（配对设备/接管判定要靠它）。
      // 漏一个头 = 预检失败 = 浏览器报 “Failed to fetch”，而同样的 URL 手动 fetch（不带该头）
      // 却 200 —— 2026-11-01 就是这么白查了一轮。加新请求头时**必须同步这一行**。
      res.setHeader('access-control-allow-headers', 'content-type,x-dsh-pet-token,x-dsh-pet-device');
      res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('access-control-max-age', '600');
    }
    const method = req.method ?? 'GET';
    /**
     * CORS 预检必须在**鉴权之前**答掉。
     *
     * <p>为什么：预检请求（OPTIONS）按规范不带自定义头、也不带 Cookie，所以它**永远
     * 拿不到 `X-DSH-Pet-Token`**。若让它走 authorize，必然 403，浏览器随即判定
     * 「preflight doesn't pass access control check: It does not have HTTP ok status」
     * 并放弃真正的请求 —— 实测就是这样卡住的。
     *
     * <p>为什么这样安全：OPTIONS 没有副作用、不返回任何数据，放行它等于只回答了
     * 「这个源能不能发那种方法」，真正的 GET/POST 仍然要过令牌。
     * 只对「远程或手机壳」放行：桌面窗口那种同源请求本来不发预检，保持原口径。
     */
    if (method === 'OPTIONS' && (remote || shellOrigin)) {
      res.writeHead(204);
      res.end();
      return;
    }
    const route = routes.find((candidate) =>
      candidate.kind === 'exact'
        ? url.pathname === candidate.path
        : url.pathname === candidate.path || url.pathname.startsWith(`${candidate.path}/`),
    );
    // Only plugin calls may come from a file renderer, and even those require its capability.
    if (!deps.security.authorize(req, res, !!route)) return;
    /**
     * 手机设备标识（2026-11-01）。
     *
     * <p>手机页每次请求都带 `x-dsh-pet-device`（配对时生成的稳定 id）。它是两件事的唯一依据：
     * ①「这台手机还在不在这个网络」—— 每次请求顺手刷新 hello（心跳），不用 SSID、不用网段，
     * 4G / 热点 / VPN 都骗不过；②「这台手机是不是已经被移出配对」—— 命中 revoked 一律 403。
     *
     * <p>必须在 authorize **之后**取：没令牌的请求不许替手机续命（否则任何人都能让电脑保持可写）。
     */
    const deviceId =
      typeof req.headers['x-dsh-pet-device'] === 'string' ? req.headers['x-dsh-pet-device'].trim() : '';
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const dispatch = async (request: IncomingMessage): Promise<void> => {
      // 吊销与心跳（见上面 deviceId 的注释）。任何一处读表失败都**不挡正常请求** ——
      // 设备登记表只是「谁在写记忆」的判据，坏了顶多退回改造前行为，不能让人连不上。
      if (deps.devices && deviceId !== '') {
        try {
          const table = await deps.devices.read();
          if (isRevoked(table, deviceId)) {
            rejectRequest(res, 403, '这台手机已被移出配对，请在电脑上重新拿一次配对码再连');
            return;
          }
          await deps.devices.touch(deviceId);
        } catch {
          /* 忽略：见上 */
        }
      }
      const assets: Record<string, readonly [string, string]> = {
        '/standalone-ai/': [settingsPage, 'text/html'],
        '/standalone-ai/settings.js': [settingsScript, 'text/javascript'],
        '/standalone-ai/settings.css': [settingsStyle, 'text/css'],
        '/mobile/': [mobilePage, 'text/html'],
        '/mobile/mobile.js': [mobileScript, 'text/javascript'],
        '/mobile/mobile.css': [mobileStyle, 'text/css'],
      };
      const asset = assets[url.pathname];
      if (asset || url.pathname === '/health' || url.pathname === '/') {
        if (method !== 'GET' && method !== 'HEAD') {
          rejectRequest(res, 405, '仅支持 GET');
          return;
        }
        if (asset) sendText(res, 200, asset[1], asset[0]);
        else if (url.pathname === '/health')
          sendText(res, 200, 'application/json', JSON.stringify(deps.status(boundPort)));
        else sendText(res, 200, 'text/html', deps.landingPage(boundPort));
        return;
      }
      if (url.pathname === '/pair') {
        pairHandler(request, res);
        return;
      }
      // 手机连接设置（只在设置页用，需要令牌 —— 走的是回环路径的授权）
      if (url.pathname === '/mobile/api/state' && method === 'GET') {
        const cfg = deps.mobile?.read();
        // 手机要连的是对外 HTTPS 端口，不是回环端口 —— 两个端口现在是分开的。
        const port = mobilePort || boundPort;
        sendJson(res, 200, {
          enabled: cfg?.enabled === true,
          port,
          listeningWide: deps.mobile?.listeningWide === true,
          addresses: deps.mobile?.lan() ?? [],
          // 只有「已开启且确实对外监听」时地址才有意义
          host: deps.mobile?.lan()[0] ? `${deps.mobile.lan()[0]}:${port}` : '',
          scheme: 'https',
        });
        return;
      }
      if (url.pathname === '/mobile/api/enable' && method === 'POST') {
        if (!deps.mobile) return void rejectRequest(res, 404, '手机连接未启用');
        const current = deps.mobile.read();
        deps.mobile.write({ ...current, enabled: true });
        deps.pairing?.cancel();
        deps.log('手机连接已开启（需重启应用后生效）');
        sendJson(res, 200, { ok: true, restartRequired: !deps.mobile.listeningWide });
        return;
      }
      if (url.pathname === '/mobile/api/disable' && method === 'POST') {
        if (!deps.mobile) return void rejectRequest(res, 404, '手机连接未启用');
        const current = deps.mobile.read();
        deps.mobile.write({ ...current, enabled: false });
        deps.pairing?.cancel();
        deps.log('手机连接已关闭');
        sendJson(res, 200, { ok: true, restartRequired: deps.mobile.listeningWide });
        return;
      }
      // 生成配对码：**只有这里**会让短码存在，平时 POST /pair 一律 403
      if (url.pathname === '/mobile/api/pair' && method === 'POST') {
        if (!deps.mobile) return void rejectRequest(res, 404, '手机连接未启用');
        if (!deps.mobile.read().enabled) return void rejectRequest(res, 409, '请先开启手机连接');
        const ticket = deps.pairing?.issue();
        if (!ticket) return void rejectRequest(res, 409, '配对功能不可用');
        const address = deps.mobile.lan()[0];
        const port = mobilePort || boundPort;
        sendJson(res, 200, {
          ok: true,
          pin: ticket.pin,
          expiresAt: ticket.expiresAt,
          ttlSeconds: Math.round((ticket.expiresAt - Date.now()) / 1000),
          host: address ? `${address}:${port}` : '',
          scheme: 'https',
          listeningWide: deps.mobile.listeningWide,
        });
        return;
      }
      // 已配对手机管理（2026-11-01，用户要求）：列出 + 删除。
      // 删除的语义（用户原话「删配对后恢复电脑可写」）：从登记表移除 → 一台不剩 → 接管判定失效 →
      // 电脑立刻恢复可写；同时把 id 记进 revoked，那台手机的请求从此 403，必须重新配对。
      if (url.pathname === '/mobile/api/devices' && method === 'GET') {
        if (!deps.devices) {
          sendJson(res, 200, { ok: true, supported: false, devices: [], phoneAway: false, reason: '' });
          return;
        }
        const table = await deps.devices.read();
        const now = Date.now();
        const away = phoneTakeover(table.devices, now);
        const newest = table.devices.reduce((max, d) => (d.lastSeenAt > max ? d.lastSeenAt : max), 0);
        sendJson(res, 200, {
          ok: true,
          supported: true,
          devices: table.devices.map((d) => ({
            id: d.id,
            name: d.name,
            pairedAt: d.pairedAt,
            lastSeenAt: d.lastSeenAt,
            // 「在线」= 心跳还在宽容期内。宽容期 45s 与宿主判定同一常量，别各写一个数字。
            online: d.lastSeenAt > 0 && now - d.lastSeenAt <= OFFLINE_GRACE_MS,
          })),
          phoneAway: away,
          reason: away ? takeoverReason(newest === 0 ? undefined : Math.round((now - newest) / 60_000)) : '',
        });
        return;
      }
      if (url.pathname === '/mobile/api/devices/remove' && method === 'POST') {
        if (!deps.devices) return void rejectRequest(res, 404, '手机连接未启用');
        const raw = await readBodyText(request).catch(() => '');
        let id = '';
        try {
          const parsed = JSON.parse(raw) as { id?: unknown } | null;
          id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
        } catch {
          return void rejectRequest(res, 400, '请求体不是合法 JSON');
        }
        if (id === '') return void rejectRequest(res, 400, '缺少设备 id');
        const table = await deps.devices.drop(id);
        deps.log('已删除配对手机 ' + id + '（电脑恢复可写）');
        sendJson(res, 200, {
          ok: true,
          devices: table.devices.map((d) => ({
            id: d.id,
            name: d.name,
            pairedAt: d.pairedAt,
            lastSeenAt: d.lastSeenAt,
            online: false,
          })),
          phoneAway: phoneTakeover(table.devices, Date.now()),
        });
        return;
      }
      if (url.pathname === '/standalone-ai/settings' || url.pathname === '/standalone-ai/test') {
        await (url.pathname === '/standalone-ai/test' ? tester : settings)(request, res);
        return;
      }
      if (!route) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      // CORS is useful to the authenticated file renderer; it grants no capability by itself.
      if (!remote) res.setHeader('access-control-allow-origin', '*');
      await route.handler(request, res);
    };

    const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;
    const bodyMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    void (async () => {
      if (hasBody || bodyMethod) {
        const limit =
          url.pathname === '/standalone-ai/settings'
            ? MAX_SETTINGS_BYTES
            : url.pathname === '/pair'
              ? 1024
              : MAX_REQUEST_BYTES;
        const bounded = await boundedRequest(req, res, limit);
        if (bounded) await dispatch(bounded);
      } else await dispatch(req);
    })().catch(() => {
      // Request bodies, URLs and thrown values may contain credentials; keep logs generic.
      deps.log('本机接口处理失败');
      if (!res.headersSent) rejectRequest(res, 500, '接口暂时无法处理请求');
      else res.end();
    });
  };

  // 回环一律 HTTP（桌面窗口、设置页、CLI 都走它，行为与改造前完全一致）；
  // 对外一律 HTTPS。**不提供「局域网 HTTP」**：手机浏览器把 http://192.168.x.x 判为
  // 非安全上下文，getUserMedia 直接不存在、SpeechRecognition 一调就 not-allowed，
  // 语音功能整个废掉；而且明文传令牌本来就是白白送人。自签证书点一次「继续前往」即可。
  const httpServer = createServer(handle);
  const tls = deps.bindHost && deps.bindHost !== '127.0.0.1' ? deps.tls?.() : undefined;
  const httpsServer = tls ? createHttpsServer({ key: tls.key, cert: tls.cert }, handle) : null;

  const tune = (target: typeof httpServer): void => {
    target.requestTimeout = 10000;
    target.headersTimeout = 10000;
    target.on('clientError', (_error, socket) => socket.destroy());
  };
  tune(httpServer);
  if (httpsServer) tune(httpsServer);

  /** 固定端口 + 顺延重试。回环用 0（让系统挑），对外用 7340 起。 */
  const bind = (target: typeof httpServer, host: string, preferred: number, tries: number): Promise<number> =>
    new Promise((resolvePort, rejectPort) => {
      const listen = (port: number, left: number): void => {
        const onError = (error: NodeJS.ErrnoException): void => {
          target.off('listening', onListening);
          if (error.code === 'EADDRINUSE' && left > 0) return void listen(port + 1, left - 1);
          rejectPort(error);
        };
        const onListening = (): void => {
          target.off('error', onError);
          resolvePort((target.address() as AddressInfo).port);
        };
        target.once('error', onError);
        target.once('listening', onListening);
        target.listen(port, host);
      };
      listen(preferred, tries);
    });

  return (async () => {
    boundPort = await bind(httpServer, '127.0.0.1', 0, 0);
    if (httpsServer) {
      mobilePort = await bind(httpsServer, deps.bindHost ?? '0.0.0.0', 7340, 50);
    }
    return {
      port: boundPort,
      /** 手机要连的端口（HTTPS）。手机连接没开时等于回环端口，调用方不该用它。 */
      mobilePort: mobilePort || boundPort,
      close: async () => {
        for (const target of [httpServer, httpsServer]) {
          if (!target) continue;
          target.closeAllConnections();
          await new Promise<void>((done) => target.close(() => done()));
        }
      },
    };
  })();
}

function sendText(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  sendText(res, status, 'application/json', JSON.stringify(value));
}

/** 读完 boundedRequest 交回来的重放流（它已把大小/超时管住，这里只管拼字符串）。 */
function readBodyText(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}
