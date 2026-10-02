import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['legacy/**', '**/dist/**', '.vercel/**', 'docs/**', 'supabase/**', 'packages/db/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'vue/no-v-html': 'error',
      'vue/multi-word-component-names': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='toISOString']",
          message: 'Use todayIn(timezone) or formatIsoDate from @nri/core; toISOString() returns the UTC date.',
        },
      ],
    },
  },
)
