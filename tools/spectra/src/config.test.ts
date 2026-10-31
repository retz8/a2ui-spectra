import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import {CONFIG_FILE, ConfigError, loadConfig, substituteVariables} from './config.js';

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, {recursive: true, force: true});
});

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'spectra-config-'));
  dirs.push(dir);
  return dir;
}

function write(dir: string, name: string, content: unknown): string {
  const file = path.join(dir, name);
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

async function configError(options: {cwd: string; path?: string}, pattern: RegExp) {
  await assert.rejects(
    loadConfig(options),
    (error: unknown) => error instanceof ConfigError && pattern.test((error as Error).message),
    `Expected ${pattern}`,
  );
}

describe('loadConfig', () => {
  it('is empty when the working directory has no config file', async () => {
    assert.deepEqual(await loadConfig({cwd: freshDir()}), {
      headers: {},
      catalogs: [],
      preview: [],
      tools: [],
      prices: {},
    });
  });

  it('reads a2ui-spectra.json from the working directory', async () => {
    const cwd = freshDir();
    const file = write(cwd, CONFIG_FILE, {
      $schema: 'http://localhost:9820/api/config.schema.json',
      agent: {
        url: 'http://localhost:10002',
        headers: {Authorization: 'Bearer ${SPECTRA_AGENT_TOKEN}'},
      },
      catalogs: ['./catalog.json', path.join(cwd, 'other', 'catalog.json')],
      preview: ['http://localhost:5174/spectra-preview'],
    });
    const config = await loadConfig({cwd});
    assert.equal(config.file, file);
    assert.equal(config.agentUrl?.href, 'http://localhost:10002/');
    assert.deepEqual(config.headers, {Authorization: 'Bearer ${SPECTRA_AGENT_TOKEN}'});
    assert.deepEqual(config.catalogs, [
      path.join(cwd, 'catalog.json'),
      path.join(cwd, 'other', 'catalog.json'),
    ]);
    assert.deepEqual(config.preview, ['http://localhost:5174/spectra-preview']);
  });

  it('reads the file --config names, its paths resolved against its own directory', async () => {
    const cwd = freshDir();
    const elsewhere = freshDir();
    mkdirSync(path.join(elsewhere, 'nested'));
    const file = write(path.join(elsewhere, 'nested'), 'spectra.json', {
      catalogs: ['../catalog.json'],
    });
    const byAbsolutePath = await loadConfig({cwd, path: file});
    assert.equal(byAbsolutePath.file, file);
    assert.deepEqual(byAbsolutePath.catalogs, [path.join(elsewhere, 'catalog.json')]);
    // A relative --config path is relative to the working directory.
    const byRelativePath = await loadConfig({cwd: elsewhere, path: 'nested/spectra.json'});
    assert.deepEqual(byRelativePath, byAbsolutePath);
  });

  it('takes an empty object, and settings left out, as the defaults', async () => {
    const cwd = freshDir();
    write(cwd, CONFIG_FILE, {agent: {url: 'https://agent.example/a2a'}});
    const config = await loadConfig({cwd});
    assert.equal(config.agentUrl?.href, 'https://agent.example/a2a');
    assert.deepEqual(config.headers, {});
    assert.deepEqual(config.catalogs, []);
    assert.deepEqual(config.preview, []);
  });

  it('stops on a file it cannot read or that holds what it does not know', async () => {
    const cwd = freshDir();
    const missing = path.join(cwd, 'missing.json');
    await configError({cwd, path: missing}, new RegExp(`${missing}.*does not exist`));
    write(cwd, 'bad.json', '{');
    await configError({cwd, path: 'bad.json'}, /bad\.json is not valid JSON/);
    write(cwd, 'list.json', '[]');
    await configError({cwd, path: 'list.json'}, /list\.json must hold a JSON object/);
    write(cwd, 'type.json', {catalogs: './catalog.json'});
    await configError({cwd, path: 'type.json'}, /type\.json: catalogs must be an array/);
    write(cwd, 'item.json', {catalogs: [1]});
    await configError({cwd, path: 'item.json'}, /item\.json: catalogs\[0\] must be a string/);
    write(cwd, 'unknown.json', {header: {}});
    await configError(
      {cwd, path: 'unknown.json'},
      /unknown\.json: 'header' is not a setting; the settings are agent, catalogs, preview, tools and prices/,
    );
    write(cwd, 'nested.json', {agent: {uri: 'http://a'}});
    await configError(
      {cwd, path: 'nested.json'},
      /nested\.json: 'agent\.uri' is not a setting; agent takes url and headers/,
    );
    write(cwd, 'url.json', {agent: {url: 'localhost:10002'}});
    await configError({cwd, path: 'url.json'}, /url\.json: agent\.url must start with http/);
    write(cwd, 'not_url.json', {agent: {url: 'not a url'}});
    await configError({cwd, path: 'not_url.json'}, /not_url\.json: agent\.url is not a URL/);
    write(cwd, 'url_type.json', {agent: {url: 1}});
    await configError({cwd, path: 'url_type.json'}, /url_type\.json: agent\.url must be a string/);
    write(cwd, 'header.json', {agent: {headers: {Authorization: 1}}});
    await configError(
      {cwd, path: 'header.json'},
      /header\.json: agent\.headers\.Authorization must be a string/,
    );
    write(cwd, 'preview.json', {preview: ['ws://x']});
    await configError(
      {cwd, path: 'preview.json'},
      /preview\.json: preview\[0\] must start with http/,
    );
  });

  it('reads the tool servers, in config order', async () => {
    const cwd = freshDir();
    write(cwd, CONFIG_FILE, {
      tools: [
        {variable: 'FLOOR_PLAN_SERVER_URL', url: 'http://127.0.0.1:8000/sse'},
        {variable: 'CIRCLECI_MCP_URL', url: 'https://mcp.circleci.com/v1/mcp'},
      ],
    });
    const config = await loadConfig({cwd});
    assert.deepEqual(
      config.tools.map(({variable, url}) => [variable, url.href]),
      [
        ['FLOOR_PLAN_SERVER_URL', 'http://127.0.0.1:8000/sse'],
        ['CIRCLECI_MCP_URL', 'https://mcp.circleci.com/v1/mcp'],
      ],
    );
  });

  it('stops on a tool server it cannot use', async () => {
    const cwd = freshDir();
    const tool = (entry: unknown) => ({tools: [entry]});
    write(cwd, 'name.json', tool({variable: '1URL', url: 'http://a'}));
    await configError(
      {cwd, path: 'name.json'},
      /name\.json: tools\[0\]\.variable must be a variable name of letters, digits and underscores/,
    );
    write(cwd, 'model.json', tool({variable: 'OPENAI_BASE_URL', url: 'http://a'}));
    await configError(
      {cwd, path: 'model.json'},
      /model\.json: tools\[0\]\.variable is OPENAI_BASE_URL, one of the model proxy's variables/,
    );
    write(cwd, 'twice.json', {
      tools: [
        {variable: 'TOOL_URL', url: 'http://a'},
        {variable: 'TOOL_URL', url: 'http://b'},
      ],
    });
    await configError(
      {cwd, path: 'twice.json'},
      /twice\.json: tools\[1\]\.variable TOOL_URL names another tool server already/,
    );
    write(cwd, 'scheme.json', tool({variable: 'TOOL_URL', url: 'ws://a'}));
    await configError(
      {cwd, path: 'scheme.json'},
      /scheme\.json: tools\[0\]\.url must start with http/,
    );
    write(cwd, 'missing.json', tool({variable: 'TOOL_URL'}));
    await configError(
      {cwd, path: 'missing.json'},
      /missing\.json: tools\[0\] must have required property 'url'/,
    );
    write(cwd, 'extra.json', tool({variable: 'TOOL_URL', url: 'http://a', name: 'x'}));
    await configError(
      {cwd, path: 'extra.json'},
      /extra\.json: 'tools\[0\]\.name' is not a setting; tools\[0\] takes variable and url/,
    );
  });

  it('reads the prices, by model id as requested, in USD per million tokens', async () => {
    const cwd = freshDir();
    const prices = {
      'gemini-3.6-flash': {input: 0.75, output: 3.75, cacheRead: 0.075},
      'my-model': {input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25},
    };
    write(cwd, CONFIG_FILE, {prices});
    assert.deepEqual((await loadConfig({cwd})).prices, prices);
  });

  it('stops on a price it cannot use', async () => {
    const cwd = freshDir();
    write(cwd, 'missing.json', {prices: {'gemini-3.6-flash': {input: 0.75}}});
    await configError(
      {cwd, path: 'missing.json'},
      /missing\.json: prices\.gemini-3\.6-flash must have required property 'output'/,
    );
    write(cwd, 'negative.json', {prices: {m: {input: -1, output: 1}}});
    await configError(
      {cwd, path: 'negative.json'},
      /negative\.json: prices\.m\.input must be >= 0/,
    );
    write(cwd, 'type.json', {prices: {m: {input: '1', output: 1}}});
    await configError({cwd, path: 'type.json'}, /type\.json: prices\.m\.input must be a number/);
    write(cwd, 'extra.json', {prices: {m: {input: 1, output: 1, reasoning: 2}}});
    await configError(
      {cwd, path: 'extra.json'},
      /extra\.json: 'prices\.m\.reasoning' is not a setting; prices\.m takes input, output, cacheRead and cacheWrite/,
    );
  });

  it('stops on a default file that does not parse, but not on one that is absent', async () => {
    const cwd = freshDir();
    await loadConfig({cwd});
    write(cwd, CONFIG_FILE, 'nope');
    await configError({cwd}, /a2ui-spectra\.json is not valid JSON/);
  });
});

describe('substituteVariables', () => {
  it('replaces each ${VAR} from the environment, leaving out a header whose variable is unset', () => {
    const {headers, unset} = substituteVariables(
      {
        Authorization: 'Bearer ${SPECTRA_AGENT_TOKEN}',
        'X-Tenant': '${TENANT}-${REGION}',
        'X-Missing': '${MISSING} and ${MISSING} and ${OTHER}',
        'X-Plain': 'as it is',
      },
      {SPECTRA_AGENT_TOKEN: 't0k3n', TENANT: 'acme', REGION: 'eu'},
    );
    assert.deepEqual(headers, {
      Authorization: 'Bearer t0k3n',
      'X-Tenant': 'acme-eu',
      'X-Plain': 'as it is',
    });
    assert.deepEqual(unset, ['MISSING', 'OTHER']);
  });

  it('takes the bare form only: $VAR, ${a-b} and ${} are left as written', () => {
    const {headers, unset} = substituteVariables(
      {'X-Odd': '$TOKEN ${a-b} ${} ${_ok1}'},
      {TOKEN: 'no', _ok1: 'yes'},
    );
    assert.deepEqual(headers, {'X-Odd': '$TOKEN ${a-b} ${} yes'});
    assert.deepEqual(unset, []);
  });

  it('treats an empty variable as set', () => {
    const {headers, unset} = substituteVariables({'X-Empty': '[${EMPTY}]'}, {EMPTY: ''});
    assert.deepEqual(headers, {'X-Empty': '[]'});
    assert.deepEqual(unset, []);
  });
});
