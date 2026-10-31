/**
 * 助手循环的单测（2026-10-26）。
 *
 * 用**脚本化的假 llm** 驱动，验证三件事：
 *   ① 多步工具调用能连起来，最后返回带人设的那句话（而不是中间的过程话术）；
 *   ② 权限被挡时立刻中断并带回 blocked（不继续瞎试、不静默）；
 *   ③ 步数上限、工具不存在、参数非法这些退化路径都有明确结果。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAssistant, ASSISTANT_MAX_STEPS, type AssistantLlm } from './loop.ts';
import { GrantStore } from './permissions';
import type { ToolContext } from './tools';

function makeCtx(ws: string, permission: 'readonly' | 'workspace' | 'full' = 'workspace'): ToolContext {
  return { workspaceRoot: ws, permission, grants: new GrantStore(60_000), netTimeoutMs: 3000, networkEnabled: false };
}

type Turn = Awaited<ReturnType<AssistantLlm['toolTurn']>>;

/** 按脚本逐轮返回 */
function scripted(turns: Turn[]): AssistantLlm {
  let i = 0;
  return {
    toolTurn: async () => {
      const t = turns[Math.min(i, turns.length - 1)];
      i++;
      return t;
    },
  };
}

function withWs(fn: (ws: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-pet-loop-'));
    try {
      await fn(ws);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  };
}

test(
  '多步：先写文件再回话，返回的是最后那句（带人设），中间动作记进 steps',
  withWs(async (ws) => {
    const llm = scripted([
      {
        ok: true,
        kind: 'tools',
        text: '我先写个文件。',
        toolCalls: [{ id: 'c1', name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'hello' }) }],
      },
      { ok: true, kind: 'text', text: '主人，写好放那儿了。' },
    ]);
    const r = await runAssistant({
      llm,
      system: '你是哥伦比娅。',
      history: [],
      userText: '写个文件',
      toolCtx: makeCtx(ws),
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      // 关键：给用户的是最后那句，不是「我先写个文件」这句过程话术
      assert.equal(r.text, '主人，写好放那儿了。');
      assert.equal(r.steps.length, 1);
      assert.equal(r.steps[0].name, 'write_file');
      assert.equal(r.steps[0].ok, true);
    }
  }),
);

test(
  '权限被挡：立刻中断并带回 blocked，不重试也不假装成功',
  withWs(async (ws) => {
    const outside = join(tmpdir(), 'dsh-pet-loop-blocked.txt');
    const llm = scripted([
      {
        ok: true,
        kind: 'tools',
        text: '',
        toolCalls: [{ id: 'c1', name: 'write_file', arguments: JSON.stringify({ path: outside, content: 'x' }) }],
      },
    ]);
    const r = await runAssistant({
      llm,
      system: 's',
      history: [],
      userText: '写到外面',
      toolCtx: makeCtx(ws, 'workspace'),
    });
    assert.equal(r.ok, false);
    if (!r.ok && r.reason === 'needs-approval') {
      assert.equal(r.blocked.tool, 'write_file');
      assert.equal(r.blocked.reason, 'outside-workspace');
      assert.equal(r.steps.length, 1, '被挡的那次也要记进 steps');
    } else {
      assert.fail('应返回 needs-approval，实际：' + JSON.stringify(r));
    }
  }),
);

test(
  '工具不存在：把错误回给模型，模型下一轮仍能给出文本答案',
  withWs(async (ws) => {
    const llm = scripted([
      { ok: true, kind: 'tools', text: '', toolCalls: [{ id: 'c1', name: 'no_such_tool', arguments: '{}' }] },
      { ok: true, kind: 'text', text: '抱歉，我不会那个。' },
    ]);
    const r = await runAssistant({ llm, system: 's', history: [], userText: 'x', toolCtx: makeCtx(ws) });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.text, '抱歉，我不会那个。');
      assert.equal(r.steps[0].ok, false, '不存在的工具应记为失败');
    }
  }),
);

test(
  '参数非法 JSON：不中断，把解析错误回给模型',
  withWs(async (ws) => {
    const llm = scripted([
      { ok: true, kind: 'tools', text: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{not json' }] },
      { ok: true, kind: 'text', text: '好吧。' },
    ]);
    const r = await runAssistant({ llm, system: 's', history: [], userText: 'x', toolCtx: makeCtx(ws) });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.steps[0].ok, false);
      assert.match(r.steps[0].summary, /参数/);
    }
  }),
);

test(
  '步数上限：一直要工具就停在 MAX_STEPS，并明确告知没做完',
  withWs(async (ws) => {
    // 永远返回工具调用
    const always: AssistantLlm = {
      toolTurn: async () => ({
        ok: true as const,
        kind: 'tools' as const,
        text: '',
        toolCalls: [{ id: 'c', name: 'list_dir', arguments: '{}' }],
      }),
    };
    const r = await runAssistant({ llm: always, system: 's', history: [], userText: 'x', toolCtx: makeCtx(ws) });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.notEqual(r.reason, 'needs-approval');
      // needs-approval 那一支把说明放在 blocked.message 里、没有顶层 message，
      // assert.notEqual 不会替 TS 收窄联合类型，所以这里显式排一次
      if (r.reason !== 'needs-approval') assert.match(r.message, new RegExp(String(ASSISTANT_MAX_STEPS)));
      assert.equal(r.steps.length, ASSISTANT_MAX_STEPS, '应该正好跑满上限');
    }
  }),
);

test(
  'llm 缺失：明确 provider-missing，不崩',
  withWs(async (ws) => {
    const r = await runAssistant({ llm: undefined, system: 's', history: [], userText: 'x', toolCtx: makeCtx(ws) });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'provider-missing');
  }),
);

test(
  'llm 报 generate-error：原样带回 message',
  withWs(async (ws) => {
    const llm: AssistantLlm = {
      toolTurn: async () => ({ ok: false as const, reason: 'provider-error' as const, message: '接口 500' }),
    };
    const r = await runAssistant({ llm, system: 's', history: [], userText: 'x', toolCtx: makeCtx(ws) });
    assert.equal(r.ok, false);
    // 同上：needs-approval 那一支没有顶层 message
    if (!r.ok && r.reason !== 'needs-approval') assert.match(r.message, /500/);
  }),
);

test(
  '取消信号：已 abort 时立即返回 stopped',
  withWs(async (ws) => {
    const ac = new AbortController();
    ac.abort();
    const llm = scripted([{ ok: true, kind: 'text', text: '不该到这' }]);
    const r = await runAssistant({
      llm,
      system: 's',
      history: [],
      userText: 'x',
      toolCtx: makeCtx(ws),
      signal: ac.signal,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'stopped');
  }),
);

test(
  '历史被带进消息序列（模型能看到前文）',
  withWs(async (ws) => {
    let seen: unknown[] = [];
    const llm: AssistantLlm = {
      toolTurn: async (input) => {
        seen = input.messages;
        return { ok: true as const, kind: 'text' as const, text: 'ok' };
      },
    };
    await runAssistant({
      llm,
      system: 's',
      history: [
        { role: 'user', content: '早上好' },
        { role: 'assistant', content: '主人早。' },
      ],
      userText: '现在几点',
      toolCtx: makeCtx(ws),
    });
    assert.equal(seen.length, 3, '两条历史 + 本轮这条');
    assert.deepEqual(seen[0], { role: 'user', content: '早上好' });
    assert.deepEqual(seen[2], { role: 'user', content: '现在几点' });
  }),
);
