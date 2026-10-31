// ESLint 扁平配置（ESLint 9 flat config）
// 规则基调：js recommended + typescript-eslint recommended（未使用变量/类型相关规则）
//           + react-hooks 钩子规则（client 半侧是 React 代码）
// 忽略：构建产物 lib、发布前检查脚本 scripts、素材 assets（类型正确性交给 tsc，
//       因此 TS 文件关闭 no-undef，避免 window/fetch 等全局误报）
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // `_*.mjs`：一次性验收脚本（Playwright / fetch 探针），不是产品代码，跑完就丢；
  // 它们大量使用浏览器与 Node 全局，按产品规则 lint 只会刷一堆假错。
  { ignores: ['lib/**', 'scripts/**', 'assets/**', 'runtime/**', 'node_modules/**', '_*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // TS 文件：类型正确性由 tsc 负责，关闭 no-undef（避免 window/fetch 等全局误报）
    files: ['**/*.ts'],
    rules: {
      'no-undef': 'off',
      // 下划线前缀 = 有意不用的参数/变量（接口签名要求占位时用，如 Tool.run 的 args）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // client 半侧是 React 代码（hooks + 手写 h() 元素）：
    // rules-of-hooks 强制 hook 调用顺序稳定；exhaustive-deps 提醒 useEffect 依赖遗漏
    files: ['src/client/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // 配置文件本身用的 ESM import，无浏览器代码，no-undef 放开
    files: ['eslint.config.js'],
    rules: {
      'no-undef': 'off',
    },
  },
);
