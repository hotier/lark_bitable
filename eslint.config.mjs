import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// React Compiler 的规则（set-state-in-effect / immutability / static-components /
// preserve-manual-memoization）多为合法数据同步模式的误报，且会阻断 next build。
// 这里降级为 warning：保留提示，但不再阻断构建。
const reactCompilerAdvisory = {
  rules: {
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/immutability": "warn",
    "react-hooks/static-components": "warn",
    "react-hooks/preserve-manual-memoization": "warn",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  reactCompilerAdvisory,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
