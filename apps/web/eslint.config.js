import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".output/**", "src/routeTree.gen.ts", "storybook-static/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: [".storybook/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "off",
      // The client needs no configuration — it calls /api on its own origin — and
      // a `VITE_`-prefixed variable is a value Vite inlines into a file the whole
      // internet can read. `scripts/scan-client-bundle.mjs` catches a leak after
      // the fact; this is the same rule where it is cheap to obey. A genuine need
      // for one is a code review, not a config edit.
      "no-restricted-syntax": [
        "error",
        {
          message:
            "VITE_ variables are inlined into the browser bundle. Serve the value from the API instead.",
          selector:
            'MemberExpression[object.object.type="MetaProperty"][property.name=/^VITE_/]',
        },
      ],
    },
  },
);
