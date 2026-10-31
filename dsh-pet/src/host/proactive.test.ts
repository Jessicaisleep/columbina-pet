import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PROACTIVE_SEC,
  MAX_PROACTIVE_SEC,
  MIN_PROACTIVE_SEC,
  PROACTIVE_ORIGIN,
  proactiveDecision,
  proactiveEnabled,
  proactiveInstruction,
  proactiveMessage,
  proactivePeriodSec,
  type ProactiveDecisionInput,
} from './proactive';
import type { ChatMemoryMessage } from './chat';

/** 造一条消息：默认是普通用户消息（最"不该拦"的那一种） */
function msg(role: 'user' | 'assistant', origin?: string): ChatMemoryMessage {
  return { role, content: 'x', ts: 1000, ...(origin ? { origin } : {}) };
}

/** 一个"什么都允许"的基线输入：逐个用例只改一个字段，失败时一眼看出是哪一条规则 */
function base(over: Partial<ProactiveDecisionInput> = {}): ProactiveDecisionInput {
  return {
    enabled: true,
    periodSec: 1800,
    lastAt: 0,
    now: 1800 * 1000,
    locked: false,
    aiReady: true,
    last: msg('assistant'),
    visible: true,
    ...over,
  };
}

describe('proactivePeriodSec', () => {
  it('缺键回默认 1800', () => {
    assert.equal(proactivePeriodSec({}), DEFAULT_PROACTIVE_SEC);
  });

  it('合法值原样返回（取整）', () => {
    assert.equal(proactivePeriodSec({ proactiveChatSec: 600 }), 600);
    assert.equal(proactivePeriodSec({ proactiveChatSec: 600.9 }), 600);
  });

  it('边界值本身合法', () => {
    assert.equal(proactivePeriodSec({ proactiveChatSec: MIN_PROACTIVE_SEC }), MIN_PROACTIVE_SEC);
    assert.equal(proactivePeriodSec({ proactiveChatSec: MAX_PROACTIVE_SEC }), MAX_PROACTIVE_SEC);
  });

  // 越界**回落**而不是夹紧：夹紧会让手写 10 秒的用户静默得到 120 秒，
  // 他看到的周期与自己写的不一样却毫无提示；回落至少与"没设过"一致。
  it('越界回落默认，不夹紧', () => {
    assert.equal(proactivePeriodSec({ proactiveChatSec: 119 }), DEFAULT_PROACTIVE_SEC);
    assert.equal(proactivePeriodSec({ proactiveChatSec: MAX_PROACTIVE_SEC + 1 }), DEFAULT_PROACTIVE_SEC);
    assert.equal(proactivePeriodSec({ proactiveChatSec: -5 }), DEFAULT_PROACTIVE_SEC);
  });

  it('非法类型回落默认', () => {
    assert.equal(proactivePeriodSec({ proactiveChatSec: 'abc' }), DEFAULT_PROACTIVE_SEC);
    assert.equal(proactivePeriodSec({ proactiveChatSec: NaN }), DEFAULT_PROACTIVE_SEC);
    assert.equal(proactivePeriodSec({ proactiveChatSec: Infinity }), DEFAULT_PROACTIVE_SEC);
  });
});

describe('proactiveEnabled', () => {
  it('只有严格 true 才算开', () => {
    assert.equal(proactiveEnabled({ proactiveChatEnabled: true }), true);
    assert.equal(proactiveEnabled({ proactiveChatEnabled: false }), false);
    assert.equal(proactiveEnabled({}), false);
    // 字符串 'true' 不算：配置是 JSONC，写错类型要当"没开"而不是"开了"
    assert.equal(proactiveEnabled({ proactiveChatEnabled: 'true' }), false);
    assert.equal(proactiveEnabled({ proactiveChatEnabled: 1 }), false);
  });
});

describe('proactiveDecision', () => {
  it('基线允许开口', () => {
    assert.deepEqual(proactiveDecision(base()), { go: true });
  });

  it('记忆为空时允许开口（全新宠物第一次主动）', () => {
    assert.deepEqual(proactiveDecision(base({ last: undefined })), { go: true });
  });

  it('开关关闭 → disabled（最根本的原因优先）', () => {
    // 同时把别的条件也弄成"不该开口"，仍应报 disabled
    assert.deepEqual(proactiveDecision(base({ enabled: false, locked: true, aiReady: false, visible: false })), {
      go: false,
      reason: 'disabled',
    });
  });

  it('不可见 → hidden', () => {
    assert.deepEqual(proactiveDecision(base({ visible: false })), { go: false, reason: 'hidden' });
  });

  it('AI 不可用 → ai-unavailable', () => {
    assert.deepEqual(proactiveDecision(base({ aiReady: false })), { go: false, reason: 'ai-unavailable' });
  });

  it('占用锁 → locked', () => {
    assert.deepEqual(proactiveDecision(base({ locked: true })), { go: false, reason: 'locked' });
  });

  it('没到间隔 → not-due', () => {
    assert.deepEqual(proactiveDecision(base({ lastAt: 1799 * 1000, now: 1800 * 1000 })), {
      go: false,
      reason: 'not-due',
    });
  });

  it('刚好到间隔就放行（不是"超过"）', () => {
    assert.deepEqual(proactiveDecision(base({ lastAt: 0, now: 1800 * 1000 })), { go: true });
  });

  // 这是本功能的核心不变量：她主动说了一句，没人接，就**不能再主动说第二句**。
  // 否则用户离开十分钟回来会看到一串独白。
  it('她刚主动说过、没人接 → unanswered', () => {
    assert.deepEqual(proactiveDecision(base({ last: msg('assistant', PROACTIVE_ORIGIN) })), {
      go: false,
      reason: 'unanswered',
    });
  });

  it('她主动说过之后用户回了 → 允许再开口', () => {
    // 最后一条是 user（用户回的），但那条 user 还没被她答过 → 见下一条用例
    const afterUser = proactiveDecision(base({ last: msg('user') }));
    assert.equal(afterUser.go, false);
    // 她答过了（普通 assistant，不是 proactive）→ 允许
    assert.deepEqual(proactiveDecision(base({ last: msg('assistant') })), { go: true });
  });

  // 上一条是 user = 用户问了她，她还欠一个回复。此时另起话头会变成
  // "你问了她，她却聊别的"——那个回复由正常对话链路负责，不归这里管。
  it('上一条是用户消息（她还欠一个回复）→ not-at-boundary', () => {
    assert.deepEqual(proactiveDecision(base({ last: msg('user') })), {
      go: false,
      reason: 'not-at-boundary',
    });
  });

  it('上一条是普通的 assistant 回复（不是 proactive）→ 允许', () => {
    assert.deepEqual(proactiveDecision(base({ last: msg('assistant', 'group') })), { go: true });
  });
});

describe('proactiveInstruction', () => {
  it('单人模式不提群', () => {
    const s = proactiveInstruction();
    assert.ok(s.includes('没有人说话'));
    assert.ok(!s.includes('群里'));
  });

  it('群聊模式带上群名', () => {
    const s = proactiveInstruction('摸鱼群');
    assert.ok(s.includes('摸鱼群'));
    assert.ok(s.includes('群里'));
  });

  it('群名为空/纯空白等同于单人', () => {
    assert.equal(proactiveInstruction(''), proactiveInstruction());
    assert.equal(proactiveInstruction('   '), proactiveInstruction());
  });

  // 指令里必须明确禁止"提你是 AI"——否则模型会回一句"我是AI助手"，
  // 在"主动搭话"这个场景里格外破坏沉浸感。
  it('明确禁止自曝 AI 身份', () => {
    assert.ok(proactiveInstruction().includes('不要提你是 AI'));
  });
});

describe('proactiveMessage', () => {
  it('是 assistant 消息，带 proactive 标记', () => {
    const m = proactiveMessage('晚上好呀', 12345);
    assert.deepEqual(m, { role: 'assistant', content: '晚上好呀', ts: 12345, origin: PROACTIVE_ORIGIN });
  });

  // 不伪造 user 消息：记忆是事实记录。这条断言把"不伪造"钉在测试里，
  // 免得以后有人为了"凑成对"改成 role:'user'。
  it('绝不伪装成用户消息', () => {
    assert.equal(proactiveMessage('x', 1).role, 'assistant');
  });
});
