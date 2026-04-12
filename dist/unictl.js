#!/usr/bin/env bun
// @bun

// node_modules/.bun/citty@0.2.1/node_modules/citty/dist/_chunks/libs/scule.mjs
var NUMBER_CHAR_RE = /\d/;
var STR_SPLITTERS = [
  "-",
  "_",
  "/",
  "."
];
function isUppercase(char = "") {
  if (NUMBER_CHAR_RE.test(char))
    return;
  return char !== char.toLowerCase();
}
function splitByCase(str, separators) {
  const splitters = separators ?? STR_SPLITTERS;
  const parts = [];
  if (!str || typeof str !== "string")
    return parts;
  let buff = "";
  let previousUpper;
  let previousSplitter;
  for (const char of str) {
    const isSplitter = splitters.includes(char);
    if (isSplitter === true) {
      parts.push(buff);
      buff = "";
      previousUpper = undefined;
      continue;
    }
    const isUpper = isUppercase(char);
    if (previousSplitter === false) {
      if (previousUpper === false && isUpper === true) {
        parts.push(buff);
        buff = char;
        previousUpper = isUpper;
        continue;
      }
      if (previousUpper === true && isUpper === false && buff.length > 1) {
        const lastChar = buff.at(-1);
        parts.push(buff.slice(0, Math.max(0, buff.length - 1)));
        buff = lastChar + char;
        previousUpper = isUpper;
        continue;
      }
    }
    buff += char;
    previousUpper = isUpper;
    previousSplitter = isSplitter;
  }
  parts.push(buff);
  return parts;
}
function upperFirst(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : "";
}
function lowerFirst(str) {
  return str ? str[0].toLowerCase() + str.slice(1) : "";
}
function pascalCase(str, opts) {
  return str ? (Array.isArray(str) ? str : splitByCase(str)).map((p) => upperFirst(opts?.normalize ? p.toLowerCase() : p)).join("") : "";
}
function camelCase(str, opts) {
  return lowerFirst(pascalCase(str || "", opts));
}
function kebabCase(str, joiner) {
  return str ? (Array.isArray(str) ? str : splitByCase(str)).map((p) => p.toLowerCase()).join(joiner ?? "-") : "";
}

// node_modules/.bun/citty@0.2.1/node_modules/citty/dist/index.mjs
import { parseArgs as parseArgs$1 } from "util";
function toArray(val) {
  if (Array.isArray(val))
    return val;
  return val === undefined ? [] : [val];
}
function formatLineColumns(lines, linePrefix = "") {
  const maxLength = [];
  for (const line of lines)
    for (const [i, element] of line.entries())
      maxLength[i] = Math.max(maxLength[i] || 0, element.length);
  return lines.map((l) => l.map((c, i) => linePrefix + c[i === 0 ? "padStart" : "padEnd"](maxLength[i])).join("  ")).join(`
`);
}
function resolveValue(input) {
  return typeof input === "function" ? input() : input;
}
var CLIError = class extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.name = "CLIError";
    this.code = code;
  }
};
function parseRawArgs(args = [], opts = {}) {
  const booleans = new Set(opts.boolean || []);
  const strings = new Set(opts.string || []);
  const aliasMap = opts.alias || {};
  const defaults = opts.default || {};
  const aliasToMain = /* @__PURE__ */ new Map;
  const mainToAliases = /* @__PURE__ */ new Map;
  for (const [key, value] of Object.entries(aliasMap)) {
    const targets = value;
    for (const target of targets) {
      aliasToMain.set(key, target);
      if (!mainToAliases.has(target))
        mainToAliases.set(target, []);
      mainToAliases.get(target).push(key);
      aliasToMain.set(target, key);
      if (!mainToAliases.has(key))
        mainToAliases.set(key, []);
      mainToAliases.get(key).push(target);
    }
  }
  const options = {};
  function getType(name) {
    if (booleans.has(name))
      return "boolean";
    const aliases = mainToAliases.get(name) || [];
    for (const alias of aliases)
      if (booleans.has(alias))
        return "boolean";
    return "string";
  }
  const allOptions = new Set([
    ...booleans,
    ...strings,
    ...Object.keys(aliasMap),
    ...Object.values(aliasMap).flat(),
    ...Object.keys(defaults)
  ]);
  for (const name of allOptions)
    if (!options[name])
      options[name] = {
        type: getType(name),
        default: defaults[name]
      };
  for (const [alias, main] of aliasToMain.entries())
    if (alias.length === 1 && options[main] && !options[main].short)
      options[main].short = alias;
  const processedArgs = [];
  const negatedFlags = {};
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      processedArgs.push(...args.slice(i));
      break;
    }
    if (arg.startsWith("--no-")) {
      const flagName = arg.slice(5);
      negatedFlags[flagName] = true;
      continue;
    }
    processedArgs.push(arg);
  }
  let parsed;
  try {
    parsed = parseArgs$1({
      args: processedArgs,
      options: Object.keys(options).length > 0 ? options : undefined,
      allowPositionals: true,
      strict: false
    });
  } catch {
    parsed = {
      values: {},
      positionals: processedArgs
    };
  }
  const out = { _: [] };
  out._ = parsed.positionals;
  for (const [key, value] of Object.entries(parsed.values))
    out[key] = value;
  for (const [name] of Object.entries(negatedFlags)) {
    out[name] = false;
    const mainName = aliasToMain.get(name);
    if (mainName)
      out[mainName] = false;
    const aliases = mainToAliases.get(name);
    if (aliases)
      for (const alias of aliases)
        out[alias] = false;
  }
  for (const [alias, main] of aliasToMain.entries()) {
    if (out[alias] !== undefined && out[main] === undefined)
      out[main] = out[alias];
    if (out[main] !== undefined && out[alias] === undefined)
      out[alias] = out[main];
  }
  return out;
}
var noColor = /* @__PURE__ */ (() => {
  const env = globalThis.process?.env ?? {};
  return env.NO_COLOR === "1" || env.TERM === "dumb" || env.TEST || env.CI;
})();
var _c = (c, r = 39) => (t) => noColor ? t : `\x1B[${c}m${t}\x1B[${r}m`;
var bold = /* @__PURE__ */ _c(1, 22);
var cyan = /* @__PURE__ */ _c(36);
var gray = /* @__PURE__ */ _c(90);
var underline = /* @__PURE__ */ _c(4, 24);
function parseArgs(rawArgs, argsDef) {
  const parseOptions = {
    boolean: [],
    string: [],
    alias: {},
    default: {}
  };
  const args = resolveArgs(argsDef);
  for (const arg of args) {
    if (arg.type === "positional")
      continue;
    if (arg.type === "string" || arg.type === "enum")
      parseOptions.string.push(arg.name);
    else if (arg.type === "boolean")
      parseOptions.boolean.push(arg.name);
    if (arg.default !== undefined)
      parseOptions.default[arg.name] = arg.default;
    if (arg.alias)
      parseOptions.alias[arg.name] = arg.alias;
    const camelName = camelCase(arg.name);
    const kebabName = kebabCase(arg.name);
    if (camelName !== arg.name || kebabName !== arg.name) {
      const existingAliases = toArray(parseOptions.alias[arg.name] || []);
      if (camelName !== arg.name && !existingAliases.includes(camelName))
        existingAliases.push(camelName);
      if (kebabName !== arg.name && !existingAliases.includes(kebabName))
        existingAliases.push(kebabName);
      if (existingAliases.length > 0)
        parseOptions.alias[arg.name] = existingAliases;
    }
  }
  const parsed = parseRawArgs(rawArgs, parseOptions);
  const [...positionalArguments] = parsed._;
  const parsedArgsProxy = new Proxy(parsed, { get(target, prop) {
    return target[prop] ?? target[camelCase(prop)] ?? target[kebabCase(prop)];
  } });
  for (const [, arg] of args.entries())
    if (arg.type === "positional") {
      const nextPositionalArgument = positionalArguments.shift();
      if (nextPositionalArgument !== undefined)
        parsedArgsProxy[arg.name] = nextPositionalArgument;
      else if (arg.default === undefined && arg.required !== false)
        throw new CLIError(`Missing required positional argument: ${arg.name.toUpperCase()}`, "EARG");
      else
        parsedArgsProxy[arg.name] = arg.default;
    } else if (arg.type === "enum") {
      const argument = parsedArgsProxy[arg.name];
      const options = arg.options || [];
      if (argument !== undefined && options.length > 0 && !options.includes(argument))
        throw new CLIError(`Invalid value for argument: ${cyan(`--${arg.name}`)} (${cyan(argument)}). Expected one of: ${options.map((o) => cyan(o)).join(", ")}.`, "EARG");
    } else if (arg.required && parsedArgsProxy[arg.name] === undefined)
      throw new CLIError(`Missing required argument: --${arg.name}`, "EARG");
  return parsedArgsProxy;
}
function resolveArgs(argsDef) {
  const args = [];
  for (const [name, argDef] of Object.entries(argsDef || {}))
    args.push({
      ...argDef,
      name,
      alias: toArray(argDef.alias)
    });
  return args;
}
function defineCommand(def) {
  return def;
}
async function runCommand(cmd, opts) {
  const cmdArgs = await resolveValue(cmd.args || {});
  const parsedArgs = parseArgs(opts.rawArgs, cmdArgs);
  const context = {
    rawArgs: opts.rawArgs,
    args: parsedArgs,
    data: opts.data,
    cmd
  };
  if (typeof cmd.setup === "function")
    await cmd.setup(context);
  let result;
  try {
    const subCommands = await resolveValue(cmd.subCommands);
    if (subCommands && Object.keys(subCommands).length > 0) {
      const subCommandArgIndex = opts.rawArgs.findIndex((arg) => !arg.startsWith("-"));
      const subCommandName = opts.rawArgs[subCommandArgIndex];
      if (subCommandName) {
        if (!subCommands[subCommandName])
          throw new CLIError(`Unknown command ${cyan(subCommandName)}`, "E_UNKNOWN_COMMAND");
        const subCommand = await resolveValue(subCommands[subCommandName]);
        if (subCommand)
          await runCommand(subCommand, { rawArgs: opts.rawArgs.slice(subCommandArgIndex + 1) });
      } else if (!cmd.run)
        throw new CLIError(`No command specified.`, "E_NO_COMMAND");
    }
    if (typeof cmd.run === "function")
      result = await cmd.run(context);
  } finally {
    if (typeof cmd.cleanup === "function")
      await cmd.cleanup(context);
  }
  return { result };
}
async function resolveSubCommand(cmd, rawArgs, parent) {
  const subCommands = await resolveValue(cmd.subCommands);
  if (subCommands && Object.keys(subCommands).length > 0) {
    const subCommandArgIndex = rawArgs.findIndex((arg) => !arg.startsWith("-"));
    const subCommandName = rawArgs[subCommandArgIndex];
    const subCommand = await resolveValue(subCommands[subCommandName]);
    if (subCommand)
      return resolveSubCommand(subCommand, rawArgs.slice(subCommandArgIndex + 1), cmd);
  }
  return [cmd, parent];
}
async function showUsage(cmd, parent) {
  try {
    console.log(await renderUsage(cmd, parent) + `
`);
  } catch (error) {
    console.error(error);
  }
}
var negativePrefixRe = /^no[-A-Z]/;
async function renderUsage(cmd, parent) {
  const cmdMeta = await resolveValue(cmd.meta || {});
  const cmdArgs = resolveArgs(await resolveValue(cmd.args || {}));
  const parentMeta = await resolveValue(parent?.meta || {});
  const commandName = `${parentMeta.name ? `${parentMeta.name} ` : ""}` + (cmdMeta.name || process.argv[1]);
  const argLines = [];
  const posLines = [];
  const commandsLines = [];
  const usageLine = [];
  for (const arg of cmdArgs)
    if (arg.type === "positional") {
      const name = arg.name.toUpperCase();
      const isRequired = arg.required !== false && arg.default === undefined;
      const defaultHint = arg.default ? `="${arg.default}"` : "";
      posLines.push([
        cyan(name + defaultHint),
        arg.description || "",
        arg.valueHint ? `<${arg.valueHint}>` : ""
      ]);
      usageLine.push(isRequired ? `<${name}>` : `[${name}]`);
    } else {
      const isRequired = arg.required === true && arg.default === undefined;
      const argStr = [...(arg.alias || []).map((a) => `-${a}`), `--${arg.name}`].join(", ") + (arg.type === "string" && (arg.valueHint || arg.default) ? `=${arg.valueHint ? `<${arg.valueHint}>` : `"${arg.default || ""}"`}` : "") + (arg.type === "enum" && arg.options ? `=<${arg.options.join("|")}>` : "");
      argLines.push([cyan(argStr + (isRequired ? " (required)" : "")), arg.description || ""]);
      if (arg.type === "boolean" && (arg.default === true || arg.negativeDescription) && !negativePrefixRe.test(arg.name)) {
        const negativeArgStr = [...(arg.alias || []).map((a) => `--no-${a}`), `--no-${arg.name}`].join(", ");
        argLines.push([cyan(negativeArgStr + (isRequired ? " (required)" : "")), arg.negativeDescription || ""]);
      }
      if (isRequired)
        usageLine.push(argStr);
    }
  if (cmd.subCommands) {
    const commandNames = [];
    const subCommands = await resolveValue(cmd.subCommands);
    for (const [name, sub] of Object.entries(subCommands)) {
      const meta = await resolveValue((await resolveValue(sub))?.meta);
      if (meta?.hidden)
        continue;
      commandsLines.push([cyan(name), meta?.description || ""]);
      commandNames.push(name);
    }
    usageLine.push(commandNames.join("|"));
  }
  const usageLines = [];
  const version = cmdMeta.version || parentMeta.version;
  usageLines.push(gray(`${cmdMeta.description} (${commandName + (version ? ` v${version}` : "")})`), "");
  const hasOptions = argLines.length > 0 || posLines.length > 0;
  usageLines.push(`${underline(bold("USAGE"))} ${cyan(`${commandName}${hasOptions ? " [OPTIONS]" : ""} ${usageLine.join(" ")}`)}`, "");
  if (posLines.length > 0) {
    usageLines.push(underline(bold("ARGUMENTS")), "");
    usageLines.push(formatLineColumns(posLines, "  "));
    usageLines.push("");
  }
  if (argLines.length > 0) {
    usageLines.push(underline(bold("OPTIONS")), "");
    usageLines.push(formatLineColumns(argLines, "  "));
    usageLines.push("");
  }
  if (commandsLines.length > 0) {
    usageLines.push(underline(bold("COMMANDS")), "");
    usageLines.push(formatLineColumns(commandsLines, "  "));
    usageLines.push("", `Use ${cyan(`${commandName} <command> --help`)} for more information about a command.`);
  }
  return usageLines.filter((l) => typeof l === "string").join(`
`);
}
async function runMain(cmd, opts = {}) {
  const rawArgs = opts.rawArgs || process.argv.slice(2);
  const showUsage$1 = opts.showUsage || showUsage;
  try {
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      await showUsage$1(...await resolveSubCommand(cmd, rawArgs));
      process.exit(0);
    } else if (rawArgs.length === 1 && rawArgs[0] === "--version") {
      const meta = typeof cmd.meta === "function" ? await cmd.meta() : await cmd.meta;
      if (!meta?.version)
        throw new CLIError("No version specified", "E_NO_VERSION");
      console.log(meta.version);
    } else
      await runCommand(cmd, { rawArgs });
  } catch (error) {
    if (error instanceof CLIError) {
      await showUsage$1(...await resolveSubCommand(cmd, rawArgs));
      console.error(error.message);
    } else
      console.error(error, `
`);
    process.exit(1);
  }
}

// packages/cli/src/cli.ts
import { readFileSync as readFileSync5 } from "fs";

// packages/cli/src/socket.ts
import { existsSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";
function findProjectRoot(from = process.cwd()) {
  let dir = resolve(from);
  const root = dirname(dir);
  while (dir !== root) {
    if (existsSync(join(dir, "ProjectSettings", "ProjectVersion.txt"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir)
      break;
    dir = parent;
  }
  if (existsSync(join(dir, "ProjectSettings", "ProjectVersion.txt"))) {
    return dir;
  }
  return null;
}
function getProjectPaths(projectPath) {
  const projectRoot = projectPath ? resolve(projectPath) : findProjectRoot();
  if (!projectRoot) {
    throw new Error(`Unity project not found (no ProjectSettings/ProjectVersion.txt in parent directories)
` + "Hint: run from project directory or use --project <path>");
  }
  const unictlDir = join(projectRoot, ".unictl");
  return {
    projectRoot,
    unictlDir,
    endpointPath: join(unictlDir, "endpoint.json"),
    legacySocketPath: join(unictlDir, "unictl.sock")
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function parseEndpointDescriptor(value, fallbackProjectRoot) {
  if (!isRecord(value))
    return null;
  const schema = value.schema;
  const transport = value.transport;
  const projectRoot = typeof value.projectRoot === "string" && value.projectRoot.length > 0 ? value.projectRoot : fallbackProjectRoot;
  const pid = typeof value.pid === "number" ? value.pid : undefined;
  if (schema !== 1)
    return null;
  if (transport === "unix" && typeof value.path === "string" && value.path.length > 0) {
    return {
      schema: 1,
      transport: "unix",
      path: value.path,
      pid,
      projectRoot
    };
  }
  if (transport === "tcp" && typeof value.host === "string" && value.host.length > 0 && typeof value.port === "number" && Number.isFinite(value.port) && typeof value.token === "string" && value.token.length > 0) {
    return {
      schema: 1,
      transport: "tcp",
      host: value.host,
      port: value.port,
      token: value.token,
      pid,
      projectRoot
    };
  }
  return null;
}
function hasEndpointFile(projectPath) {
  const { endpointPath } = getProjectPaths(projectPath);
  return existsSync(endpointPath);
}
function getDefaultUnixEndpoint(projectPath) {
  const { legacySocketPath, projectRoot } = getProjectPaths(projectPath);
  return {
    schema: 1,
    transport: "unix",
    path: legacySocketPath,
    projectRoot
  };
}
function readEndpointDescriptor(projectPath) {
  const { endpointPath, projectRoot } = getProjectPaths(projectPath);
  if (!existsSync(endpointPath))
    return null;
  try {
    const parsed = JSON.parse(readFileSync(endpointPath, "utf-8"));
    return parseEndpointDescriptor(parsed, projectRoot);
  } catch {
    return null;
  }
}
function resolveEndpointDescriptor(projectPath) {
  return readEndpointDescriptor(projectPath) ?? getDefaultUnixEndpoint(projectPath);
}
function endpointSeemsPresent(endpoint) {
  if (endpoint.transport === "unix") {
    return existsSync(endpoint.path);
  }
  return true;
}
function mergeHeaders(headers, extra) {
  const merged = new Headers(headers);
  for (const [key, value] of Object.entries(extra)) {
    merged.set(key, value);
  }
  return Object.fromEntries(merged.entries());
}
async function fetchEndpoint(endpoint, pathname, init) {
  if (endpoint.transport === "unix") {
    return fetch(`http://localhost${pathname}`, {
      ...init,
      unix: endpoint.path
    });
  }
  return fetch(`http://${endpoint.host}:${endpoint.port}${pathname}`, {
    ...init,
    headers: mergeHeaders(init?.headers, {
      "X-Unictl-Token": endpoint.token
    })
  });
}

// packages/cli/src/client.ts
function describeEndpoint(endpoint) {
  if (endpoint.transport === "unix") {
    return endpoint.path;
  }
  return `${endpoint.host}:${endpoint.port}`;
}
function createEndpointUnavailableError(projectPath, endpoint) {
  const { endpointPath } = getProjectPaths(projectPath);
  const endpointFileExists = hasEndpointFile(projectPath);
  if (!endpointSeemsPresent(endpoint)) {
    if (endpointFileExists) {
      return new Error(`Unictl endpoint is stale or unreachable (${describeEndpoint(endpoint)}). ` + `Check ${endpointPath} or run \`unictl doctor --project ${endpoint.projectRoot}\`.`);
    }
    return new Error(`Unity editor endpoint not found for project ${endpoint.projectRoot}. ` + `Run \`unictl editor open --project ${endpoint.projectRoot}\` or ` + `\`unictl doctor --project ${endpoint.projectRoot}\`.`);
  }
  return new Error(`Failed to reach unictl endpoint at ${describeEndpoint(endpoint)}. ` + `Run \`unictl doctor --project ${endpoint.projectRoot}\` for diagnostics.`);
}
async function requestJson(pathname, init, opts) {
  const endpoint = resolveEndpointDescriptor(opts?.project);
  if (!endpointSeemsPresent(endpoint)) {
    throw createEndpointUnavailableError(opts?.project, endpoint);
  }
  try {
    const res = await fetchEndpoint(endpoint, pathname, init);
    return await res.json();
  } catch {
    throw createEndpointUnavailableError(opts?.project, endpoint);
  }
}
async function command(cmd, params, opts) {
  return requestJson("/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      command: cmd,
      params: params ?? {}
    })
  }, opts);
}
async function health(opts) {
  return requestJson("/health", undefined, opts);
}

// packages/cli/src/editor.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, rmSync } from "fs";
import { join as join2 } from "path";
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function getProjectRoot(projectPath) {
  const { projectRoot } = getProjectPaths(projectPath);
  return projectRoot;
}
function readUnityVersion(projectRoot) {
  const versionFile = join2(projectRoot, "ProjectSettings", "ProjectVersion.txt");
  const content = readFileSync2(versionFile, "utf-8");
  const match = content.match(/^m_EditorVersion:\s*(.+)$/m);
  if (!match)
    throw new Error("Could not parse m_EditorVersion from ProjectVersion.txt");
  return match[1].trim();
}
function listUnityProcesses() {
  const proc = Bun.spawnSync(["ps", "-axo", "pid=,command="]);
  const out = proc.stdout.toString();
  return out.split(`
`).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.match(/^(\d+)\s+(.*)$/);
    if (!match)
      return null;
    const pid = Number.parseInt(match[1], 10);
    const command2 = match[2];
    if (Number.isNaN(pid))
      return null;
    return { pid, command: command2 };
  }).filter((proc2) => {
    if (!proc2)
      return false;
    return proc2.command.includes("/Unity.app/Contents/MacOS/Unity");
  });
}
function isBatchModeWorker(command2) {
  return command2.includes(" -batchMode ") || command2.includes("AssetImportWorker");
}
async function getUnityPid(projectPath) {
  const projectRoot = getProjectRoot(projectPath);
  const processes = listUnityProcesses();
  const matchingProject = processes.filter((proc) => proc.command.includes(`-projectPath ${projectRoot}`));
  const preferred = matchingProject.find((proc) => !isBatchModeWorker(proc.command));
  if (preferred)
    return preferred.pid;
  const fallback = processes.find((proc) => !isBatchModeWorker(proc.command));
  return fallback?.pid ?? null;
}
function endpointIsReachable(endpoint) {
  return endpointSeemsPresent(endpoint);
}
async function tryHealth(endpoint) {
  try {
    const res = await fetchEndpoint(endpoint, "/health");
    if (!res.ok)
      return null;
    return await res.json();
  } catch {
    return null;
  }
}
async function sendEditorControl(endpoint, params) {
  const res = await fetchEndpoint(endpoint, "/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      command: "editor_control",
      params
    })
  });
  return res.json();
}
function cleanBackupScenes(projectRoot) {
  const backupDir = join2(projectRoot, "Temp", "__Backupscenes");
  if (existsSync2(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }
}
async function editorStatus(opts) {
  const endpointFile = hasEndpointFile(opts?.project);
  const endpoint = resolveEndpointDescriptor(opts?.project);
  const pid = await getUnityPid(opts?.project);
  const endpointPresent = endpointIsReachable(endpoint);
  const healthData = endpointPresent ? await tryHealth(endpoint) : null;
  return {
    running: pid !== null,
    pid,
    endpoint: endpointFile,
    transport: endpoint.transport,
    socket: endpoint.transport === "unix" ? endpointPresent : false,
    health: healthData ?? null
  };
}
async function editorQuit(opts) {
  const endpoint = resolveEndpointDescriptor(opts?.project);
  if (!endpointIsReachable(endpoint)) {
    throw new Error("Unity editor endpoint not found \u2014 editor may not be running");
  }
  try {
    await sendEditorControl(endpoint, { action: "quit" });
  } catch {}
  const timeout = Date.now() + 15000;
  while (Date.now() < timeout) {
    await sleep(200);
    const nextEndpoint = readEndpointDescriptor(opts?.project) ?? endpoint;
    if (!endpointIsReachable(nextEndpoint)) {
      return { quit: true };
    }
  }
  const pid = await getUnityPid(opts?.project);
  if (pid !== null) {
    Bun.spawnSync(["kill", String(pid)]);
    await sleep(3000);
    const stillRunning = await getUnityPid(opts?.project);
    if (stillRunning !== null) {
      Bun.spawnSync(["kill", "-9", String(pid)]);
      await sleep(1000);
    }
  }
  return { quit: true };
}
async function editorOpen(opts) {
  const projectRoot = getProjectRoot(opts?.project);
  const existingPid = await getUnityPid(opts?.project);
  if (existingPid !== null) {
    throw new Error(`Unity editor is already running (pid=${existingPid})`);
  }
  cleanBackupScenes(projectRoot);
  const version = readUnityVersion(projectRoot);
  const unityBin = `/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity`;
  if (!existsSync2(unityBin)) {
    throw new Error(`Unity binary not found: ${unityBin}`);
  }
  const proc = Bun.spawn([unityBin, "-projectPath", projectRoot], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"]
  });
  const launchedPid = proc.pid;
  const timeout = Date.now() + 120000;
  while (Date.now() < timeout) {
    await sleep(500);
    const endpoint = readEndpointDescriptor(opts?.project) ?? resolveEndpointDescriptor(opts?.project);
    if (endpointIsReachable(endpoint)) {
      const healthData = await tryHealth(endpoint);
      if (healthData !== null) {
        return { opened: true, pid: launchedPid };
      }
    }
  }
  throw new Error("Timeout waiting for Unity editor to become ready (120s)");
}
async function editorRestart(opts) {
  const endpoint = resolveEndpointDescriptor(opts?.project);
  if (endpointIsReachable(endpoint)) {
    try {
      await editorQuit({ project: opts?.project, force: false });
    } catch {
      await editorQuit({ project: opts?.project, force: true });
    }
  }
  await sleep(500);
  const result = await editorOpen({ project: opts?.project });
  return { restarted: true, pid: result.pid };
}

// packages/cli/src/meta.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "fs";
import { dirname as dirname2, join as join3, resolve as resolve2 } from "path";
import { fileURLToPath } from "url";
var runtimeDir = dirname2(fileURLToPath(import.meta.url));
function readJsonFile(path) {
  return JSON.parse(readFileSync3(path, "utf-8"));
}
function findRepoRoot(from) {
  let dir = resolve2(from);
  while (true) {
    if (existsSync3(join3(dir, "package.json")) && existsSync3(join3(dir, "VERSION"))) {
      return dir;
    }
    const parent = dirname2(dir);
    if (parent === dir) {
      throw new Error(`Could not locate unictl repo root from ${from}`);
    }
    dir = parent;
  }
}
var repoRoot = findRepoRoot(runtimeDir);
var rootPackageJsonPath = join3(repoRoot, "package.json");
var embeddedEditorPackagePath = join3(repoRoot, "packages", "upm", "com.unictl.editor");
function getCliPackageMeta() {
  const pkg = readJsonFile(rootPackageJsonPath);
  return {
    ...pkg,
    packageJsonPath: rootPackageJsonPath
  };
}
function getEmbeddedEditorPackagePath() {
  return embeddedEditorPackagePath;
}
function getEmbeddedEditorPackageVersion() {
  const packagePath = join3(embeddedEditorPackagePath, "package.json");
  if (!existsSync3(packagePath))
    return null;
  const pkg = readJsonFile(packagePath);
  return pkg.version ?? null;
}

// packages/cli/src/project.ts
import { existsSync as existsSync4, readFileSync as readFileSync4, writeFileSync } from "fs";
import { join as join4, resolve as resolve3 } from "path";
function getManifestPath(projectPath) {
  const { projectRoot } = getProjectPaths(projectPath);
  return join4(projectRoot, "Packages", "manifest.json");
}
function readProjectManifest(projectPath) {
  const manifestPath = getManifestPath(projectPath);
  if (!existsSync4(manifestPath)) {
    throw new Error(`Unity manifest not found: ${manifestPath}`);
  }
  return JSON.parse(readFileSync4(manifestPath, "utf-8"));
}
function writeProjectManifest(projectPath, manifest) {
  const manifestPath = getManifestPath(projectPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, "utf-8");
  return manifestPath;
}
function buildGitPackageReference(repoUrl, version) {
  const normalizedRepoUrl = repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`;
  return `${normalizedRepoUrl}?path=/packages/upm/com.unictl.editor#v${version}`;
}
function getPrototypeLocalPackageReference() {
  const packagePath = getEmbeddedEditorPackagePath();
  if (!existsSync4(join4(packagePath, "package.json")))
    return null;
  return `file:${packagePath}`;
}
function tryReadPackageVersion(packagePath) {
  const packageJsonPath = join4(packagePath, "package.json");
  if (!existsSync4(packageJsonPath))
    return null;
  try {
    const pkg = JSON.parse(readFileSync4(packageJsonPath, "utf-8"));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}
function parsePackageReference(reference, projectPath) {
  const gitTagMatch = reference.match(/#v([^#?]+)$/);
  if (gitTagMatch) {
    return {
      kind: "git-tag",
      source: reference,
      version: gitTagMatch[1]
    };
  }
  if (reference.startsWith("file:")) {
    const rawPath = reference.slice(5);
    const manifestPath = getManifestPath(projectPath);
    const resolvedPath = rawPath.startsWith("/") ? rawPath : resolve3(manifestPath, "..", rawPath);
    return {
      kind: "file",
      source: reference,
      version: tryReadPackageVersion(resolvedPath),
      resolvedPath
    };
  }
  return {
    kind: "opaque",
    source: reference,
    version: null
  };
}

// packages/cli/src/cli.ts
function output(data) {
  console.log(JSON.stringify(data));
}
function outputErrorAndExit(error) {
  const message = error instanceof Error ? error.message : String(error);
  output({ error: message });
  process.exit(1);
}
function parsePFlags(args) {
  const result = {};
  let found = false;
  for (let i = 0;i < args.length; i++) {
    if (args[i] === "-p" && i + 1 < args.length) {
      const kv = args[i + 1];
      const eq = kv.indexOf("=");
      if (eq > 0) {
        result[kv.slice(0, eq)] = kv.slice(eq + 1);
        found = true;
      }
      i++;
    }
  }
  return found ? result : null;
}
function parseFileArg(args) {
  for (const arg of args) {
    if (arg.startsWith("@")) {
      const filePath = arg.slice(1);
      const content = readFileSync5(filePath, "utf-8");
      return JSON.parse(content);
    }
  }
  return null;
}
async function readStdin() {
  if (process.stdin.isTTY)
    return null;
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  if (!text)
    return null;
  return JSON.parse(text);
}
async function resolveParams(rawArgs) {
  const pFlags = parsePFlags(rawArgs);
  if (pFlags)
    return pFlags;
  const fileParams = parseFileArg(rawArgs);
  if (fileParams)
    return fileParams;
  const stdinParams = await readStdin();
  if (stdinParams)
    return stdinParams;
  return;
}
function getVersionInfo() {
  const cliPackage = getCliPackageMeta();
  return {
    success: true,
    message: "unictl version info",
    data: {
      package_name: cliPackage.name,
      cli_version: cliPackage.version,
      package_json_path: cliPackage.packageJsonPath,
      embedded_editor_version: getEmbeddedEditorPackageVersion(),
      runtime: "bun"
    }
  };
}
function createCheck(name, ok, severity, detail, data) {
  return { name, ok, severity, detail, data };
}
function summarizeDoctorChecks(checks) {
  const failedErrors = checks.filter((check) => check.severity === "error" && !check.ok);
  const warnings = checks.filter((check) => check.severity === "warn" && !check.ok).length;
  return {
    success: failedErrors.length === 0,
    warnings
  };
}
async function runDoctor(projectPath) {
  const cliPackage = getCliPackageMeta();
  const checks = [];
  let projectRoot = null;
  try {
    projectRoot = projectPath ? projectPath : findProjectRoot();
    if (!projectRoot) {
      checks.push(createCheck("project_root", false, "error", "Unity project root could not be detected."));
    } else {
      checks.push(createCheck("project_root", true, "info", "Unity project root detected.", { project_root: projectRoot }));
    }
  } catch (error) {
    checks.push(createCheck("project_root", false, "error", error instanceof Error ? error.message : String(error)));
  }
  if (projectRoot) {
    try {
      const manifestPath = getManifestPath(projectRoot);
      const manifest = readProjectManifest(projectRoot);
      checks.push(createCheck("manifest", true, "info", "Unity manifest loaded.", { manifest_path: manifestPath }));
      const dependencyRef = manifest.dependencies?.["com.unictl.editor"];
      if (!dependencyRef) {
        checks.push(createCheck("editor_package_dependency", false, "error", "`com.unictl.editor` dependency is missing from manifest.json."));
      } else {
        const parsedReference = parsePackageReference(dependencyRef, projectRoot);
        checks.push(createCheck("editor_package_dependency", true, "info", "`com.unictl.editor` dependency is present.", parsedReference));
        if (parsedReference.version) {
          const matchesCliVersion = parsedReference.version === cliPackage.version;
          checks.push(createCheck("version_alignment", matchesCliVersion, matchesCliVersion ? "info" : "error", matchesCliVersion ? "CLI version and editor package version align." : `CLI version ${cliPackage.version} does not match editor package version ${parsedReference.version}.`, {
            cli_version: cliPackage.version,
            editor_package_version: parsedReference.version
          }));
        } else {
          checks.push(createCheck("version_alignment", false, "warn", "Editor package reference is opaque, so exact version drift could not be verified.", { reference: dependencyRef }));
        }
      }
    } catch (error) {
      checks.push(createCheck("manifest", false, "error", error instanceof Error ? error.message : String(error)));
    }
    const endpointFile = hasEndpointFile(projectRoot);
    if (!endpointFile) {
      checks.push(createCheck("endpoint_file", false, "warn", "No `.unictl/endpoint.json` file found. Editor may not be running yet."));
    } else {
      const endpoint = readEndpointDescriptor(projectRoot);
      if (!endpoint) {
        checks.push(createCheck("endpoint_descriptor", false, "error", "Endpoint file exists but could not be parsed."));
      } else {
        checks.push(createCheck("endpoint_descriptor", true, "info", "Endpoint descriptor loaded.", endpoint));
      }
    }
    const status = await editorStatus({ project: projectRoot });
    if (!status.running) {
      checks.push(createCheck("editor_status", false, "warn", "Unity editor is not running for this project."));
    } else {
      checks.push(createCheck("editor_status", true, "info", "Unity editor process is running.", { pid: status.pid }));
    }
    if (status.running && status.health == null) {
      checks.push(createCheck("health_probe", false, "error", "Editor is running but `/health` did not respond successfully.", {
        transport: status.transport,
        endpoint: status.endpoint
      }));
    } else if (status.health != null) {
      checks.push(createCheck("health_probe", true, "info", "Health probe succeeded.", status.health));
    } else {
      checks.push(createCheck("health_probe", false, "warn", "Health probe skipped because editor is not currently reachable."));
    }
  }
  const summary = summarizeDoctorChecks(checks);
  return {
    success: summary.success,
    message: summary.success ? "Doctor checks passed." : "Doctor found blocking issues.",
    data: {
      cli_version: cliPackage.version,
      warnings: summary.warnings,
      checks
    }
  };
}
function ensureDependencies(manifest) {
  if (!manifest.dependencies) {
    manifest.dependencies = {};
  }
  return manifest.dependencies;
}
function resolveInitReference(args) {
  if (args.packageRef) {
    return { reference: args.packageRef, source: "explicit-package-ref" };
  }
  if (args.repoUrl) {
    const version = args.version ?? getCliPackageMeta().version;
    return {
      reference: buildGitPackageReference(args.repoUrl, version),
      source: "repo-url"
    };
  }
  const prototypeRef = getPrototypeLocalPackageReference();
  if (prototypeRef) {
    return { reference: prototypeRef, source: "embedded-prototype" };
  }
  throw new Error("Missing package reference. Provide `--repo-url` or `--package-ref`.");
}
function runInit(args) {
  const projectRoot = args.project ? args.project : findProjectRoot();
  if (!projectRoot) {
    throw new Error("Unity project root could not be detected for init.");
  }
  const manifest = readProjectManifest(projectRoot);
  const dependencies = ensureDependencies(manifest);
  const currentReference = dependencies["com.unictl.editor"] ?? null;
  const desired = resolveInitReference(args);
  if (currentReference === desired.reference) {
    return {
      success: true,
      message: "Manifest already contains the desired `com.unictl.editor` reference.",
      data: {
        changed: false,
        dry_run: Boolean(args.dryRun),
        manifest_path: getManifestPath(projectRoot),
        reference: desired.reference,
        reference_source: desired.source
      }
    };
  }
  if (currentReference && currentReference !== desired.reference && !args.force) {
    return {
      success: false,
      message: "Existing `com.unictl.editor` reference differs. Re-run with `--force` to replace it.",
      data: {
        changed: false,
        dry_run: Boolean(args.dryRun),
        manifest_path: getManifestPath(projectRoot),
        current_reference: currentReference,
        desired_reference: desired.reference,
        reference_source: desired.source
      }
    };
  }
  const nextManifest = {
    ...manifest,
    dependencies: {
      ...dependencies,
      "com.unictl.editor": desired.reference
    }
  };
  if (!args.dryRun) {
    writeProjectManifest(projectRoot, nextManifest);
  }
  return {
    success: true,
    message: args.dryRun ? "Manifest update planned." : "Manifest updated.",
    data: {
      changed: true,
      dry_run: Boolean(args.dryRun),
      forced: Boolean(args.force),
      manifest_path: getManifestPath(projectRoot),
      previous_reference: currentReference,
      next_reference: desired.reference,
      reference_source: desired.source
    }
  };
}
function normalizeKnownFlags(args) {
  return args.map((arg) => {
    switch (arg) {
      case "--dry-run":
        return "--dryRun";
      case "--repo-url":
        return "--repoUrl";
      case "--package-ref":
        return "--packageRef";
      default:
        return arg;
    }
  });
}
var editorStatusCmd = defineCommand({
  meta: { name: "status", description: "Show Unity editor running status" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)"
    }
  },
  run: async ({ args }) => {
    try {
      output(await editorStatus({ project: args.project }));
    } catch (e) {
      output({ error: e.message });
      process.exit(1);
    }
  }
});
var editorQuitCmd = defineCommand({
  meta: { name: "quit", description: "Quit the Unity editor" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)"
    },
    force: {
      type: "boolean",
      description: "Force kill if graceful quit times out",
      default: false
    }
  },
  run: async ({ args }) => {
    try {
      output(await editorQuit({ project: args.project, force: args.force }));
    } catch (e) {
      output({ error: e.message });
      process.exit(1);
    }
  }
});
var editorOpenCmd = defineCommand({
  meta: { name: "open", description: "Open the Unity editor" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)"
    }
  },
  run: async ({ args }) => {
    try {
      output(await editorOpen({ project: args.project }));
    } catch (e) {
      output({ error: e.message });
      process.exit(1);
    }
  }
});
var editorRestartCmd = defineCommand({
  meta: { name: "restart", description: "Restart the Unity editor (quit \u2192 clean \u2192 open)" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)"
    }
  },
  run: async ({ args }) => {
    try {
      output(await editorRestart({ project: args.project }));
    } catch (e) {
      output({ error: e.message });
      process.exit(1);
    }
  }
});
var editorCmd = defineCommand({
  meta: { name: "editor", version: "0.1.0", description: "Unity editor process control" },
  subCommands: {
    status: editorStatusCmd,
    quit: editorQuitCmd,
    open: editorOpenCmd,
    restart: editorRestartCmd
  }
});
var commandCmd = defineCommand({
  meta: { name: "command", description: "Invoke a specific UnictlTool by name" },
  args: {
    tool: {
      type: "positional",
      required: true,
      description: "UnictlTool name to invoke"
    },
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)"
    }
  },
  run: async ({ args, rawArgs }) => {
    try {
      const params = await resolveParams(rawArgs);
      output(await command(String(args.tool), params, { project: args.project }));
    } catch (error) {
      outputErrorAndExit(error);
    }
  }
});
var healthCmd = defineCommand({
  meta: { name: "health", description: "Check the current unictl endpoint health" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)"
    }
  },
  run: async ({ args }) => {
    try {
      output(await health({ project: args.project }));
    } catch (error) {
      outputErrorAndExit(error);
    }
  }
});
var versionCmd = defineCommand({
  meta: { name: "version", description: "Show CLI and embedded package version metadata" },
  run: async () => {
    try {
      output(getVersionInfo());
    } catch (error) {
      outputErrorAndExit(error);
    }
  }
});
var doctorCmd = defineCommand({
  meta: { name: "doctor", description: "Run installation and endpoint diagnostics" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)"
    }
  },
  run: async ({ args }) => {
    try {
      const result = await runDoctor(args.project);
      output(result);
      if (!result.success)
        process.exit(1);
    } catch (error) {
      outputErrorAndExit(error);
    }
  }
});
var initCmd = defineCommand({
  meta: { name: "init", description: "Add or update the `com.unictl.editor` dependency in manifest.json" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)"
    },
    repoUrl: {
      type: "string",
      description: "Git repository URL for the standalone unictl repo"
    },
    packageRef: {
      type: "string",
      description: "Exact package reference to write into manifest.json"
    },
    version: {
      type: "string",
      description: "Package version tag used with --repo-url (defaults to CLI version)"
    },
    dryRun: {
      type: "boolean",
      default: false,
      description: "Show the planned manifest change without writing it"
    },
    force: {
      type: "boolean",
      default: false,
      description: "Replace an existing differing com.unictl.editor reference"
    }
  },
  run: async ({ args }) => {
    try {
      const result = runInit({
        project: args.project,
        repoUrl: args.repoUrl,
        packageRef: args.packageRef,
        version: args.version,
        dryRun: args.dryRun,
        force: args.force
      });
      output(result);
      if (!result.success)
        process.exit(1);
    } catch (error) {
      outputErrorAndExit(error);
    }
  }
});
var main = defineCommand({
  meta: {
    name: "unictl",
    version: "0.1.0",
    description: "Unity editor control CLI"
  },
  args: {
    command: {
      type: "positional",
      description: "Command to execute (e.g., list, health, ping, editor)",
      required: true
    },
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)"
    }
  },
  run: async ({ args, rawArgs }) => {
    const cmd = args.command;
    const project = args.project;
    try {
      if (cmd === "health") {
        output(await health({ project }));
        return;
      }
      const params = await resolveParams(rawArgs);
      const result = await command(cmd, params, { project });
      output(result);
    } catch (e) {
      output({ error: e.message });
      process.exit(1);
    }
  }
});
var rawArgs = normalizeKnownFlags(process.argv.slice(2));
var firstArg = rawArgs.find((a) => !a.startsWith("-"));
if (firstArg === "editor") {
  runMain(editorCmd, { rawArgs: rawArgs.slice(rawArgs.indexOf("editor") + 1) });
} else if (firstArg === "command") {
  runMain(commandCmd, { rawArgs: rawArgs.slice(rawArgs.indexOf("command") + 1) });
} else if (firstArg === "health") {
  runMain(healthCmd, { rawArgs: rawArgs.slice(rawArgs.indexOf("health") + 1) });
} else if (firstArg === "version") {
  runMain(versionCmd, { rawArgs: rawArgs.slice(rawArgs.indexOf("version") + 1) });
} else if (firstArg === "doctor") {
  runMain(doctorCmd, { rawArgs: rawArgs.slice(rawArgs.indexOf("doctor") + 1) });
} else if (firstArg === "init") {
  runMain(initCmd, { rawArgs: rawArgs.slice(rawArgs.indexOf("init") + 1) });
} else {
  runMain(main);
}
