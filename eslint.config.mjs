import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Downgrade React 19's stricter set-state-in-effect rule to a warning. It
      // flags valid dialog-state-reset patterns (`useEffect(() => { if (open) {
      // setX(...) } }, [open])`) which don't cause cascading renders — multiple
      // setStates inside one synchronous code path are batched. We still want
      // visibility into new occurrences but not a build-breaking error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CommonJS Node entrypoint — uses require() by design.
    "electron/**",
  ]),
]);

export default eslintConfig;
