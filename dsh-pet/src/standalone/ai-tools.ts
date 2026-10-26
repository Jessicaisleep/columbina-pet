/**
 * 工具调用传输层（standalone 半侧）：一次「带 tools 的对话轮」。
 *
 * ## 为什么单独一个文件，不复用 sdkTextStream
 * `sdkTextStream` 是**流式纯文本**：只 yield `text` 增量，拿不到 `tool_calls`。
 * 工具调用需要拿到结构化的 `tool_calls`（名字 + JSON 参数 + id），并要求**非流式**或
 * 「流式聚合 tool_calls 增量」——后者各家实现差异大，容易踩坑。所以这里走**非流式**：
 * 一轮一次请求，返回 `{ text }` 或 `{ toolCalls }`，由上层循环驱动。
 *
 * ## 只支持 openai-compatible 的原因
 * Anthropic 的 tools 形状（`tool_use` block / `tool_result` block）与 OpenAI 完全不同，
 * 需要一整套独立的消息转换。当前用户的配置是 DeepSeek（openai-compatible），
 * 因此**优先把这条打通**；Anthropic 下返回明确错误（`toolsUnsupported`），
 * 上层据此降级成「普通对话」并在结果里说明，**不静默假装成功**。
 *
 * ## 安全边界
 * - 请求仍走 `isolatedFetch`：只允许打用户配置的那个 endpoint，不跟随重定向到别处。
 * - `maxRetries: 0`：工具轮失败就失败，不自动重试（重试会造成同一动作重复执行）。
 */
import OpenAI from 'openai';
import type { StandaloneAiSettings } from './ai-config';
import { isolatedFetch } from './ai-transport';
import type { AiFetch } from './ai-transport';

/** 模型要求调用的一个工具 */
export interface ToolCall {
  id: string;
  name: string;
  /** 原始 arguments 字符串（JSON；可能不合法，由上层解析并容错） */
  arguments: string;
}

/** 一轮的结果 */
export type ToolTurnResult =
  | { ok: true; kind: 'text'; text: string }
  | { ok: true; kind: 'tools'; toolCalls: ToolCall[]; /** 可能同时带一句说明 */ text: string }
  | { ok: false; reason: 'tools-unsupported' | 'provider-error' | 'empty'; message: string };

/** 一条对话消息（工具轮用；比 AiTextMessage 多出 tool 角色与 tool_calls） */
export type ToolMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/** 工具定义（OpenAI function 形状） */
export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

/** ToolMessage → OpenAI messages 形状 */
function toOpenAiMessages(
  system: string,
  messages: ToolMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (system !== '') out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const hasTools = Array.isArray(m.toolCalls) && m.toolCalls.length > 0;
      out.push({
        role: 'assistant',
        // OpenAI 要求 assistant 带 tool_calls 时 content 可为 null
        content: m.content === '' && hasTools ? null : m.content,
        ...(hasTools
          ? {
              tool_calls: m.toolCalls!.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

/**
 * 跑一轮带工具的对话（非流式）。
 *
 * @param settings 当前的 AI 连接配置（含 apiKey）
 * @param system   system 提示词（人设 + 时间 + 屏幕上下文都拼在这里）
 * @param messages 到目前为止的消息序列
 * @param tools    可用工具定义（空数组 = 不传 tools，退化成普通对话）
 * @param signal   外部取消信号
 * @param fetcher  隔离的 fetch（测试可注入）
 */
export async function toolTurn(
  settings: Readonly<StandaloneAiSettings>,
  system: string,
  messages: ToolMessage[],
  tools: readonly ToolDef[],
  signal: AbortSignal,
  fetcher: AiFetch,
): Promise<ToolTurnResult> {
  if (settings.protocol !== 'openai-compatible') {
    return {
      ok: false,
      reason: 'tools-unsupported',
      message: '当前协议（' + settings.protocol + '）暂不支持工具调用，只支持 OpenAI 兼容协议。',
    };
  }
  const client = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseUrl.replace(/\/+$/, ''),
    maxRetries: 0,
    timeout: settings.timeoutMs,
    fetch: isolatedFetch(settings, fetcher),
    logger: quiet,
    logLevel: 'off' as const,
    organization: null,
    project: null,
    webhookSecret: null,
  });
  try {
    const completion = await client.chat.completions.create(
      {
        model: settings.model,
        messages: toOpenAiMessages(system, messages),
        // 空数组会让某些兼容层报 400（"tools must not be empty"），所以只在非空时传
        ...(tools.length > 0 ? { tools: tools as OpenAI.Chat.Completions.ChatCompletionTool[] } : {}),
        max_tokens: settings.maxTokens,
        n: 1,
        stream: false,
      },
      { signal },
    );
    const choice = completion.choices?.[0];
    if (!choice) return { ok: false, reason: 'empty', message: '模型没有返回任何选择项' };
    const msg = choice.message;
    const text = typeof msg?.content === 'string' ? msg.content.trim() : '';
    const rawCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    if (rawCalls.length > 0) {
      const toolCalls: ToolCall[] = rawCalls.map((c, i) => {
        // SDK 的类型是 union（function 调用 / custom 调用）；这里只认 function 形状，
        // custom 调用拿不到 name/arguments，直接折叠成空名，由下面过滤掉。
        const fn = 'function' in c ? c.function : undefined;
        return {
          // 某些兼容层不给 id，兜一个稳定的本地 id（同一轮内唯一即可）
          id: typeof c.id === 'string' && c.id !== '' ? c.id : 'call_' + i,
          name: String(fn?.name ?? ''),
          arguments: String(fn?.arguments ?? '{}'),
        };
      });
      // 丢掉名字为空的（畸形返回，执行不了）
      const usable = toolCalls.filter((c) => c.name !== '');
      if (usable.length === 0) {
        return text !== ''
          ? { ok: true, kind: 'text', text }
          : { ok: false, reason: 'empty', message: '模型返回了空的工具调用' };
      }
      return { ok: true, kind: 'tools', toolCalls: usable, text };
    }
    if (text === '') return { ok: false, reason: 'empty', message: '模型没有返回文本' };
    return { ok: true, kind: 'text', text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // 很多兼容层在「不支持 tools」时回 400/422，文案千奇百怪——统一折叠成可读提示
    const looksUnsupported = /tool|function|unsupported|not support|invalid.*param/i.test(message);
    return {
      ok: false,
      reason: looksUnsupported ? 'tools-unsupported' : 'provider-error',
      message,
    };
  }
}
