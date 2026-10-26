/**
 * 助手循环（host 半侧）：把「用户说一句话」变成「模型可以连做几步动作，然后用桌宠人设回复」。
 *
 * ## 与普通对话的关系
 * 普通对话 = 一次请求、一句回复。助手模式 = **多步循环**：
 * ```
 *   user: 帮我把 notes 里的 todo 汇总成一个文件
 *     -> 模型: tool_call list_dir(notes)
 *     -> 我们执行，回 tool 结果
 *     -> 模型: tool_call read_file(notes/a.md)
 *     -> ...
 *     -> 模型: 纯文本回复  ← 循环结束，这句就是桌宠说的话
 * ```
 * **循环的上限必须硬**（`MAX_STEPS`）：没有上限的 agent 循环会烧光 API 额度。
 *
 * ## 两个刻意的设计
 * 1. **思考过程不可见**：模型返回的 `text` 若与 `tool_calls` 同轮出现，那是「边想边做」的过程话术，
 *    只进日志、不弹给用户。用户看到的只有**最后一轮纯文本**。
 * 2. **回复带人设**：system 里本来就有人设 + 名字 + 时间 + 屏幕上下文，所以最后那句自然带人设。
 *    执行过程的中间文本不带——那是工具日志，不是角色台词。
 *
 * ## 失败与降级
 * - 协议不支持工具（Anthropic）→ 直接按普通对话跑，并在日志说明（**不静默**，用户能看到降级原因）。
 * - 工具执行失败 → 把错误作为 `tool` 消息回给模型，让它自己纠正（这是 agent 该有的行为）。
 * - 权限被挡 → **中断循环**，返回 `needsApproval`，由 UI 问用户；不继续瞎试。
 */
import {
  findTool,
  toolDefinitions,
  type ToolContext,
  type ToolResult,
} from './tools';

/** 循环上限：超过就停（防止无限自我调用烧额度） */
const MAX_STEPS = 8;

/** 一轮工具调用后要记的东西（给日志/UI 用） */
export interface AssistantStep {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** 结果摘要（截断到 300 字符，日志与 UI 都用它） */
  summary: string;
}

/** 助手循环的产出 */
export type AssistantOutcome =
  | {
      ok: true;
      /** 最终给用户的话（带人设） */
      text: string;
      /** 这一轮做过的动作（按顺序） */
      steps: AssistantStep[];
      /** 是否因为协议不支持工具而降级成普通对话 */
      degraded?: 'tools-unsupported';
    }
  | {
      ok: false;
      reason: 'needs-approval';
      /** 被挡下的具体动作，UI 用它生成审批提示 */
      blocked: { tool: string; target: string; reason: 'readonly' | 'outside-workspace'; message: string };
      /** 已经做过的动作（中断前的） */
      steps: AssistantStep[];
    }
  | { ok: false; reason: 'provider-missing' | 'generate-error' | 'stopped'; message: string; steps: AssistantStep[] };

/** 助手循环依赖的 llm 缝隙（测试可注入替身） */
export interface AssistantLlm {
  /** 跑一轮带工具的对话 */
  toolTurn(input: {
    system: string;
    messages: unknown[];
    tools: unknown[];
    signal?: AbortSignal;
  }): Promise<
    | { ok: true; kind: 'text'; text: string }
    | { ok: true; kind: 'tools'; toolCalls: Array<{ id: string; name: string; arguments: string }>; text: string }
    | { ok: false; reason: string; message: string }
  >;
}

/** 一次助手任务的入参 */
export interface AssistantRequest {
  llm: AssistantLlm | undefined;
  /** 完整 system（人设 + 名字 + 时间 + 屏幕上下文） */
  system: string;
  /** 历史（user/assistant 交替的纯文本） */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** 用户这句话 */
  userText: string;
  /** 工具上下文（工作区根 / 权限 / 授权表 / 网络开关） */
  toolCtx: ToolContext;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 日志回调（默认 console.warn） */
  log?: (level: 'info' | 'warn', message: string) => void;
}

/** 把工具参数文本安全解析成对象（模型偶尔给不合法 JSON） */
function parseArgs(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const text = (raw ?? '').trim();
  if (text === '') return { ok: true, value: {} };
  try {
    const v = JSON.parse(text) as unknown;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      return { ok: false, error: '参数必须是 JSON 对象' };
    }
    return { ok: true, value: v as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: '参数不是合法 JSON：' + (e instanceof Error ? e.message : String(e)) };
  }
}

/** 截断摘要 */
function brief(s: string, n = 300): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * 跑一次助手循环。
 *
 * 消息序列的构造（顺序很重要，OpenAI 对 tool 消息的位置有硬要求）：
 *   system → 历史(user/assistant) → 本轮 user → [assistant(tool_calls) → tool(结果)] × N → 最终 assistant
 */
export async function runAssistant(req: AssistantRequest): Promise<AssistantOutcome> {
  const log = req.log ?? ((level, msg) => (level === 'warn' ? console.warn(msg) : console.info(msg)));
  const steps: AssistantStep[] = [];
  if (!req.llm || typeof req.llm.toolTurn !== 'function') {
    return { ok: false, reason: 'provider-missing', message: '当前没有可用的模型', steps };
  }

  // 消息序列：历史 + 本轮
  const messages: Array<Record<string, unknown>> = [
    ...req.history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: req.userText },
  ];

  const defs = toolDefinitions();

  for (let step = 0; step < MAX_STEPS; step++) {
    if (req.signal?.aborted) {
      return { ok: false, reason: 'stopped', message: '用户中断了这次操作', steps };
    }
    const turn = await req.llm.toolTurn({
      system: req.system,
      messages,
      tools: defs,
      ...(req.signal ? { signal: req.signal } : {}),
    });

    if (!turn.ok) {
      // 工具不支持 → 交给上层降级成普通对话（这里明确报，别假装成功）
      if (turn.reason === 'tools-unsupported') {
        return { ok: false, reason: 'generate-error', message: turn.message, steps };
      }
      return { ok: false, reason: 'generate-error', message: turn.message, steps };
    }

    if (turn.kind === 'text') {
      // 循环出口：纯文本 = 桌宠要说的话
      return { ok: true, text: turn.text, steps };
    }

    // 有工具调用：先把它记进消息序列
    if (turn.text !== '') {
      // 「边想边做」的过程话术：只进日志，不弹给用户
      log('info', '[dsh-pet] 助手思考 pet=' + '…' + ' ' + brief(turn.text, 120));
    }
    messages.push({
      role: 'assistant',
      content: turn.text,
      toolCalls: turn.toolCalls,
    });

    for (const call of turn.toolCalls) {
      const tool = findTool(call.name);
      const parsed = parseArgs(call.arguments);
      let result: ToolResult;
      if (!tool) {
        result = { ok: false, content: `没有名为 ${call.name} 的工具。可用工具：${defs.map((d) => d.function.name).join('、')}` };
      } else if (!parsed.ok) {
        result = { ok: false, content: '工具参数解析失败：' + parsed.error };
      } else {
        try {
          result = await tool.run(req.toolCtx, parsed.value);
        } catch (e) {
          result = { ok: false, content: '工具执行异常：' + (e instanceof Error ? e.message : String(e)) };
        }
      }

      steps.push({
        name: call.name,
        args: parsed.ok ? parsed.value : { __raw: call.arguments },
        ok: result.ok,
        summary: brief(result.content),
      });
      log('info', `[dsh-pet] 助手动作 ${call.name} -> ${result.ok ? 'ok' : 'fail'}：${brief(result.content, 160)}`);

      // 权限被挡：中断循环，让 UI 去问用户（不继续瞎试）
      if (result.blocked) {
        return {
          ok: false,
          reason: 'needs-approval',
          blocked: {
            tool: result.blocked.tool,
            target: result.blocked.target,
            reason: result.blocked.reason,
            message: result.content,
          },
          steps,
        };
      }

      messages.push({ role: 'tool', toolCallId: call.id, content: result.content });
    }
  }

  // 步数用尽：明确告知（不编造一句「已完成」骗用户）
  return {
    ok: false,
    reason: 'generate-error',
    message: `这件事需要超过 ${MAX_STEPS} 步操作，已停下。可以让我分开做。`,
    steps,
  };
}

/** 导出上限供 UI 文案使用 */
export const ASSISTANT_MAX_STEPS = MAX_STEPS;
