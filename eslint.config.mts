import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir,
      },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: { ...globals.browser, chrome: "readonly" } },
  },
  tseslint.configs.recommended,
  {
    rules: {
      // 未使用変数チェック
      "@typescript-eslint/no-unused-vars": [
        "warn", // エラーではなく警告にする
        {
          // アンダーバーだけの変数はチェックを除外
          varsIgnorePattern: "^_+$",
          argsIgnorePattern: "^_+$",
          caughtErrorsIgnorePattern: "^_+$",
          destructuredArrayIgnorePattern: "^_+$",
        },
      ],
    },
  },
]);
