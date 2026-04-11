import jsdoc from "eslint-plugin-jsdoc";

export default [
  {
    ignores: [
      "data/**",
      "Calendar/events.generated.js",
      "Calendar/build-events-backup-260329.zip",
      "**/*.html",
      "**/*.css",
      "config/*.json"
    ]
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    plugins: {
      jsdoc
    },
    rules: {
      // Phase 2 rollout: missing JSDoc fails lint checks.
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: false,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            MethodDefinition: true,
            FunctionExpression: false,
            ArrowFunctionExpression: false
          }
        }
      ],
      "jsdoc/require-param": "off",
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-type": "off"
    }
  }
];
