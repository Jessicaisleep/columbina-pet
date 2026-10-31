import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RequestSecurity {
  /** Process capability: private launcher manifest only, never an HTTP response or log. */
  readonly token: string;
  authenticatedUrl(baseUrl: string): string;
  authorize(req: IncomingMessage, res: ServerResponse, allowFileOrigin?: boolean): boolean;
}

/**
 * 手机端（远程）访问的开关来源。
 *
 * 为什么不直接在构造时传一个布尔值：开关是**运行时可变的**（用户在设置页点一下就要生效，
 * 不该要求重启），而 RequestSecurity 在服务器启动时就建好了。所以这里只持有一个读取器，
 * 每次请求现问。
 */
export interface RequestSecurityOptions {
  /** 手机端远程访问是否已开启；不提供 = 恒关（此时行为与改造前逐字一致）。 */
  remoteEnabled?: () => boolean;
}

/** 回环来源地址（Windows 上 IPv4-mapped 也要认）。 */
const LOOPBACK_PEERS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * 远程模式下**唯一**允许免令牌的路径。
 *
 * 只放手机壳页面本身与健康检查：手机第一次打开时还没有令牌，页面必须能加载；
 * 而 `/dsh-pet-*` 一律要令牌 —— 那里有配置（含人设）、状态（含气泡原文）与对话记忆。
 * 这一条是本文件里最要紧的边界，改它之前先读 §20.4 那次「GET 导出差点泄记忆」的记录。
 */
const REMOTE_PUBLIC_GET: ReadonlySet<string> = new Set([
  '/',
  '/health',
  '/mobile/',
  '/mobile/mobile.css',
  '/mobile/mobile.js',
]);

/**
 * 手机壳（Capacitor / Cordova）的 origin 白名单。
 *
 * <p>这些是容器自己造出来的「虚拟源」，不是真实站点：Capacitor 把 webDir 托管在
 * {@code https://localhost}（androidScheme='https'）或 {@code capacitor://localhost}；
 * Cordova 用 {@code file://}（Origin 是 `null`，那条走的是 allowFileOrigin 分支）。
 *
 * <p><b>只放行 origin 校验，不放松令牌</b>：命中这些 origin 的请求会走
 * {@code authorizeRemote}，静态页照旧免令牌、其余一律要 43 字符令牌。
 */
export const MOBILE_SHELL_ORIGINS: ReadonlySet<string> = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]);

export function rejectRequest(res: ServerResponse, status: number, error: string): false {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error }));
  return false;
}

function pathOf(req: IncomingMessage): string {
  // The plugin decodes its route before dispatch; authorization must use the same spelling.
  return decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
}

function publicRead(req: IncomingMessage): boolean {
  const path = pathOf(req);
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (['/standalone-ai/settings', '/shutdown'].includes(path)) return false;
  if (/^\/dsh-pet-\d+\/(?:whisper|chat)(?:\/|$)/.test(path)) return false;
  return (
    [
      '/',
      '/health',
      '/standalone-ai/',
      '/standalone-ai/settings.js',
      '/standalone-ai/settings.css',
      // 手机页三件：本机也要能直接打开预览（在电脑浏览器里调页面时不必带令牌），
      // 且它们不含任何秘密——页面本身是静态 HTML/CSS/JS，数据全靠令牌换来的接口。
      // 与 REMOTE_PUBLIC_GET 保持同一份清单：两处不一致会出现"手机能开、电脑打不开"。
      '/mobile/',
      '/mobile/mobile.css',
      '/mobile/mobile.js',
    ].includes(path) || /^\/dsh-pet-\d+\//.test(path)
  );
}

/** Origin/Fetch-Metadata are CSRF checks; the custom capability header also excludes HTML forms. */
export function createRequestSecurity(options: RequestSecurityOptions = {}): RequestSecurity {
  const token = randomBytes(32).toString('base64url');

  /** 令牌校验（本机与远程共用的最后一道）。 */
  const checkToken = (req: IncomingMessage, res: ServerResponse): boolean => {
    const supplied = req.headers['x-dsh-pet-token'];
    if (
      typeof supplied !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
    ) {
      return rejectRequest(res, 403, '请从桌宠菜单重新打开设置');
    }
    return true;
  };

  /**
   * 手机（非回环来源）路径。
   *
   * 与本地路径的区别只有一条：**不做 Origin / Sec-Fetch-Site 判定**。
   * 理由是手机上的页面由本服务自己托管（同源），而将来 Capacitor 壳里 origin 会是
   * `http://localhost` 之类，和局域网地址天然对不上；CSRF 在这里没有意义（攻击者拿不到令牌），
   * 令牌是唯一凭证。相应地，远程路径下**没有任何免令牌的 `/dsh-pet-*` 读接口**。
   */
  const authorizeRemote = (req: IncomingMessage, res: ServerResponse): boolean => {
    const method = req.method ?? 'GET';
    let path: string;
    try {
      path = pathOf(req);
    } catch {
      return rejectRequest(res, 400, '请求地址无效');
    }
    // 配对：短码由路由自己校验（本文件拿不到 pairing 实例）。这是唯一免令牌的写接口，
    // 它的强度靠「6 位数字 + 5 分钟 + 5 次机会 + 一次性」，见 ./pairing。
    if (method === 'POST' && path === '/pair') return true;
    if ((method === 'GET' || method === 'HEAD') && REMOTE_PUBLIC_GET.has(path)) return true;
    return checkToken(req, res);
  };

  return {
    token,
    authenticatedUrl(baseUrl) {
      const base = new URL(baseUrl);
      if (
        base.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(base.hostname) ||
        base.username ||
        base.password
      ) {
        throw new Error('设置地址必须是本机 HTTP 地址');
      }
      return `${base.origin}/standalone-ai/#token=${token}`;
    },
    authorize(req, res, allowFileOrigin = false) {
      const remote = options.remoteEnabled?.() ?? false;
      const peer = req.socket.remoteAddress ?? '';
      // 来源不是回环 → 手机路径。关着手机访问时这里就是硬墙：即使服务监听在 0.0.0.0，
      // 局域网也进不来（这一条比 Host 头可靠 —— Host 是请求方随便写的）。
      //
      // 拿不到来源地址（`''`）时**当本机**处理：真实的 HTTP 请求一定有 remoteAddress，
      // 空值只出现在内部构造/测试里。这条判据必须是「确知来自外部才算外部」，
      // 否则一个读不到的字段就能把请求降级到宽松分支上。
      if (peer !== '' && !LOOPBACK_PEERS.has(peer)) {
        if (!remote) return rejectRequest(res, 403, '仅允许当前本机地址');
        return authorizeRemote(req, res);
      }
      const host = req.headers.host;
      const port = req.socket.localPort;
      if (!port || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && host !== `[::1]:${port}`)) {
        return rejectRequest(res, 403, '仅允许当前本机地址');
      }
      // A file renderer still needs the process capability: sandboxed websites also send "null".
      // Non-CORS media loads from the same file renderer may omit Origin altogether.
      const fileOrigin = allowFileOrigin && (req.headers.origin === 'null' || req.headers.origin === undefined);

      /**
       * 手机壳（Capacitor）的 origin 与「本服务自己的地址」天然不同源。
       *
       * <p>为什么需要这条：APK 里的页面是 {@code https://localhost}（Capacitor 把 webDir
       * 托管在这个虚拟域名下），而它连的是 {@code https://<电脑IP>:7340} —— 两者不同源，
       * 浏览器照样会先发 CORS 预检。若这里按「跨站」一律拒，App 里就永远连不上
       * （实测 {@code Access to fetch at '.../pair' from origin 'https://localhost'
       * has been blocked by CORS policy}）。
       *
       * <p>为什么放行它是安全的：这些 origin 只可能来自本机容器里的壳（外站无法伪造成
       * {@code capacitor://localhost} 还让浏览器认账，且预检阶段攻击者拿不到令牌）。
       * 关键是**放行的只是 origin 检查，令牌检查一点没松** —— 走这条分支的请求
       * 之后仍然必须带对 43 字符令牌（或命中 {@link #REMOTE_PUBLIC_GET} 那三个静态页）。
       */
      const shellOrigin = typeof req.headers.origin === 'string' && MOBILE_SHELL_ORIGINS.has(req.headers.origin);
      if (
        !fileOrigin &&
        !shellOrigin &&
        ((req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) ||
          req.headers['sec-fetch-site'] === 'cross-site')
      ) {
        return rejectRequest(res, 403, '不允许跨站请求');
      }
      if (shellOrigin) {
        // 手机壳路径：与远程路径同一套口径（静态页免令牌、其余必须带令牌）。
        return authorizeRemote(req, res);
      }
      try {
        if (publicRead(req) && !fileOrigin) return true;
      } catch {
        return rejectRequest(res, 400, '请求地址无效');
      }
      return checkToken(req, res);
    },
  };
}

/** Upstream plugin handlers write wildcard CORS; remove it at the actual HTTP boundary. */
export function secureResponse(res: ServerResponse, pathname?: string): void {
  const writeHead = res.writeHead.bind(res);
  const isPublicOp = pathname === '/' || pathname === '/health';
  res.writeHead = ((status: number, ...args: unknown[]) => {
    const filtered = isPublicOp
      ? args
      : args.map((value) => {
          if (Array.isArray(value)) {
            return value.reduce<string[]>((result, item, index) => {
              if (index % 2 === 0 && !String(item).toLowerCase().startsWith('access-control-')) {
                return [...result, String(item), String(value[index + 1])];
              }
              return result;
            }, []);
          }
          if (value !== null && typeof value === 'object') {
            return Object.fromEntries(
              Object.entries(value).filter(([name]) => !name.toLowerCase().startsWith('access-control-')),
            );
          }
          return value;
        });
    if (!isPublicOp) {
      for (const name of res.getHeaderNames()) {
        if (name.toLowerCase().startsWith('access-control-')) res.removeHeader(name);
      }
    }
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cache-control', 'no-store');
    return Reflect.apply(writeHead, res, [status, ...filtered]);
  }) as typeof res.writeHead;
}
