const plugin: Deno.lint.Plugin = {
  name: "no-ignored-return",
  rules: {
    "no-ignored-return": {
      create(context): Deno.lint.LintVisitor {
        return {
          ExpressionStatement(node): void {
            if (node.expression.type === "CallExpression") {
              void context.report({
                message: "do something with the result",
                node,
              });
            }
          },
        };
      },
    },
  },
};
export default plugin;
