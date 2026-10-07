const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

test('build renueva archivos y paquetes antiguos sin borrar la carpeta dist abierta', t => {
  const project = path.join(__dirname, '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tcplay-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(project, 'src'), path.join(root, 'src'), { recursive: true });
  fs.cpSync(path.join(project, 'platform'), path.join(root, 'platform'), { recursive: true });
  fs.copyFileSync(path.join(project, 'config.example.json'), path.join(root, 'config.example.json'));
  fs.writeFileSync(path.join(root, 'config.local.json'), JSON.stringify({
    apiBaseUrl: 'https://api.invalid', requestTimeoutMs: 15000, playbackTimeoutMs: 20000
  }));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(dist, 'Debug'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'Debug', 'dist.wgt'), 'old package');
  fs.writeFileSync(path.join(dist, 'core.js'), 'old code');
  fs.writeFileSync(path.join(dist, 'obsolete.js'), 'old asset');
  const guardedFs = { ...fs, rmSync(target, options) {
    // Windows may deny removing a directory used by an open editor or shell.
    if (path.resolve(target) === dist) {
      const error = new Error('EPERM: dist is open');
      error.code = 'EPERM';
      throw error;
    }
    return fs.rmSync(target, options);
  } };
  const source = fs.readFileSync(path.join(project, 'scripts/build.cjs'), 'utf8');
  function build(args = []) {
    vm.runInNewContext(source, {
      __dirname: path.join(root, 'scripts'), console: { log() {} },
      process: { argv: ['node', 'build.cjs', ...args] },
      require(name) { return name === 'node:fs' ? guardedFs : require(name); }
    });
  }
  build();
  build();
  assert.equal(fs.existsSync(path.join(dist, 'Debug')), false);
  assert.equal(fs.existsSync(path.join(dist, 'obsolete.js')), false);
  assert.equal(fs.readFileSync(path.join(dist, 'core.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'));
  assert.match(fs.readFileSync(path.join(dist, 'config.js'), 'utf8'), /https:\/\/api\.invalid/);
  assert.match(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), /\$WEBAPIS\/webapis\/webapis\.js/);
  assert.equal(fs.readFileSync(path.join(root, 'config.local.json'), 'utf8'),
    JSON.stringify({ apiBaseUrl: 'https://api.invalid', requestTimeoutMs: 15000, playbackTimeoutMs: 20000 }));
  const generated = () => JSON.parse(fs.readFileSync(path.join(dist, 'config.js'), 'utf8').replace(/^window.TCPLAY_CONFIG = /, '').trim().slice(0, -1));
  assert.equal(generated().playerEngine, 'avplay');
  build(['--player-engine=html5']);
  assert.equal(generated().playerEngine, 'html5'); assert.equal(generated().apiBaseUrl, 'https://api.invalid');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config.local.json'), 'utf8')).playerEngine, undefined);
  build(); assert.equal(generated().playerEngine, 'avplay');
  assert.throws(() => build(['--player-engine=bad']), /Usa --player-engine/);
  fs.writeFileSync(path.join(root, 'config.local.json'), JSON.stringify({ playerEngine: 'bad' }));
  assert.throws(() => build(), /playerEngine debe ser/);
});
