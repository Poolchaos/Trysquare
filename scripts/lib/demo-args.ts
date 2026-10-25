/**
 * What a fixture demo was asked to do, read so that it never spends by
 * accident (audit finding 1, D-203).
 *
 * Windows PowerShell runs npm through npm.ps1, which swallows a bare `--`:
 * `npm run demo:fixture -- --fake` reached the script with no arguments, so
 * the free command ran a real, paid review. npm keeps a swallowed flag as an
 * npm_config_ variable, read here beside the arguments. And a real run is
 * one that was asked for, by `--real` or `--model`: a demo told nothing
 * says how to run it and stops, having spent nothing.
 */

/** The recommended model (D-184); `--model` picks another. */
export const DEFAULT_MODEL = "claude-opus-5-5";

export interface DemoOptions {
  model: string;
  fake: boolean;
  keep: boolean;
  perToken: boolean;
}

export function readDemoOptions(
  script: string,
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { options: DemoOptions } | { refusal: string } {
  const swallowed = (name: string) => env[`npm_config_${name.replaceAll("-", "_")}`];
  const flag = (name: string) => argv.includes(`--${name}`) || swallowed(name) !== undefined;

  // `--model x` as given, or, once npm has taken --model for its own, the
  // id left behind as the only bare argument (or its value, as --model=x).
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const modelAt = argv.indexOf("--model");
  const npmModel = swallowed("model");
  let model: string | undefined;
  const explained = new Set<string>();
  if (modelAt !== -1 && argv[modelAt + 1] !== undefined && !argv[modelAt + 1]!.startsWith("--")) {
    model = argv[modelAt + 1];
    explained.add(model!);
  } else if (npmModel !== undefined && npmModel !== "true" && npmModel !== "") {
    model = npmModel;
  } else if (npmModel !== undefined && positional.length === 1) {
    model = positional[0];
    explained.add(model!);
  }

  const usage =
    `Say which run you want. ${script} -- --fake runs it through the stand-in CLI and ` +
    `spends nothing; ${script} -- --real, or -- --model <id>, reviews it with a real model ` +
    `on your Claude usage.`;
  const strays = positional.filter((arg) => !explained.has(arg));
  if (strays.length > 0) {
    return { refusal: `Not understood: ${strays.join(" ")}. ${usage}` };
  }
  if ((modelAt !== -1 || npmModel !== undefined) && model === undefined) {
    return { refusal: `--model needs a model id after it. ${usage}` };
  }
  const fake = flag("fake");
  const real = flag("real") || model !== undefined;
  if (fake && real) {
    return { refusal: `Both a fake run and a real one were asked for. ${usage}` };
  }
  if (!fake && !real) return { refusal: usage };
  return {
    options: {
      model: model ?? DEFAULT_MODEL,
      fake,
      keep: flag("keep"),
      perToken: flag("per-token"),
    },
  };
}
