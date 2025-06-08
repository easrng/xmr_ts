#!/usr/bin/env -S deno -A
// deno-lint-ignore-file no-ignored-return/no-ignored-return
import {
  analyzeMetafile,
  build,
  Plugin,
  version as esbuildVersion,
} from "npm:esbuild@0.25.5";
import process from "node:process";

async function main(): Promise<void> {
  try {
    const entryPoints: (string | { in: string; out: string })[] = [];
    // deno-lint-ignore no-explicit-any
    let options: Record<string, any> = Object.create(null);

    const kebabCaseToCamelCase = (
      text: string,
    ): string => {
      if (text !== text.toLowerCase()) {
        throw new Error(
          "Invalid CLI-style flag: " + JSON.stringify("--" + text),
        );
      }
      return text.replace(/-(\w)/g, (_, x) => x.toUpperCase());
    };

    // Convert CLI-style options to JS-style options
    for (const text of Deno.args) {
      const equals = text.indexOf("=");

      if (text.startsWith("--")) {
        const colon = text.indexOf(":");

        // Array element
        if (colon >= 0 && equals < 0) {
          const key = kebabCaseToCamelCase(text.slice(2, colon));
          const value = text.slice(colon + 1);
          if (!(key in options) || !Array.isArray(options[key])) {
            options[key] = [];
          }
          options[key].push(value);
        } // Map element
        else if (colon >= 0 && colon < equals) {
          const key1 = kebabCaseToCamelCase(text.slice(2, colon));
          const key2 = text.slice(colon + 1, equals);
          const value = text.slice(equals + 1);
          if (
            !(key1 in options) || typeof options[key1] !== "object" ||
            Array.isArray(options[key1])
          ) {
            options[key1] = Object.create(null);
          }
          options[key1][key2] = value;
        } // Key value
        else if (equals >= 0) {
          const value = text.slice(equals + 1);
          options[kebabCaseToCamelCase(text.slice(2, equals))] =
            value === "true" ? true : value === "false" ? false : value;
        } // Bare boolean
        else {
          options[kebabCaseToCamelCase(text.slice(2))] = true;
        }
      } // Invalid flag
      else if (text.startsWith("-")) {
        throw new Error(
          'All CLI-style flags must start with "--"',
        );
      } // Entry point
      else {
        // Assign now to set "entryPoints" here in the property iteration order
        options["entryPoints"] = entryPoints;
        entryPoints.push(
          equals < 0
            ? text
            : { in: text.slice(equals + 1), out: text.slice(0, equals) },
        );
      }
    }

    if (entryPoints.length) options["entryPoints"] = entryPoints;

    const toRegExp = (key: string): void => {
      if (options[key] !== undefined) {
        try {
          options[key] = new RegExp(options[key] + "");
        } catch (err) {
          key = key.replace(/[A-Z]/g, (x) => "-" + x.toLowerCase());
          throw new Error(
            `Invalid regular expression for "--${key}=": ${
              Error.isError(err) ? err.message : err
            }`,
          );
        }
      }
    };

    const toNumber = (key: string): void => {
      if (options[key] !== undefined) {
        try {
          options[key] = +options[key];
        } catch (err) {
          key = key.replace(/[A-Z]/g, (x) => "-" + x.toLowerCase());
          throw new Error(
            `Invalid number for "--${key}=": ${
              Error.isError(err) ? err.message : err
            }`,
          );
        }
      }
    };

    const commaSeparatedArrays = [
      "conditions",
      "dropLabels",
      "mainFields",
      "resolveExtensions",
      "target",
    ];

    // These need to be numbers, not strings or booleans
    toNumber("logLimit");
    toNumber("lineLimit");

    // These need to be regular expressions, not strings or booleans
    toRegExp("mangleProps");
    toRegExp("reserveProps");

    // These need to be arrays, not comma-separated strings or booleans
    for (const key of commaSeparatedArrays) {
      if (options[key] !== undefined) {
        options[key] = (options[key] + "").split(",");
      }
    }

    // Map entries for "supported" must be booleans, not strings (but map
    // entries for other maps such as "define" or "banner" must be strings,
    // so only do this for "supported")
    const supported = options["supported"];
    if (typeof supported === "object" && supported !== null) {
      for (const key in supported) {
        if (supported[key] === "true") supported[key] = true;
        else if (supported[key] === "false") supported[key] = false;
      }
    }

    let analyze, sourcefile, version, metafile, plugins;
    ({ analyze, sourcefile, version, metafile, plugins, ...options } = options);
    if (version) {
      console.log(esbuildVersion);
      return;
    }
    if (metafile || analyze) {
      options.metafile = true;
    }
    if (sourcefile) {
      options.stdin = {};
      options.stdin.sourcefile = sourcefile;
    }
    options.logLevel ??= "info";
    options.nodePaths ??= Deno.env.get("NODE_PATH")?.split(":");
    const pluginInstances: Plugin[] = options.plugins = [];
    if (analyze) {
      pluginInstances.push({
        name: "analyze",
        setup(build): void {
          build.onEnd(async (result) => {
            console.error(
              "%s",
              await analyzeMetafile(result.metafile!, {
                color: options.color ?? Deno.stderr.isTerminal(),
              }),
            );
          });
        },
      });
    }
    if (Array.isArray(plugins)) {
      for (const plugin of plugins) {
        const [spec, name] = plugin.split("!");
        pluginInstances.push(...[].concat((await import(spec))[name]()));
      }
    }
    const result = await build(options as any).catch(() => {});
    if (!result) {
      process.exitCode = 1;
      return;
    }
    if (metafile) {
      await Deno.writeTextFile(metafile, JSON.stringify(result.metafile!));
    }
  } catch (err) {
    console.error("%s", String(Error.isError(err) ? err.message : err));
    process.exitCode = 1;
  }
}

await main();
