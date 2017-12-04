'use strict';
/// <reference path="_extra.d.ts" />

import * as path from 'path';
import * as cp from 'child_process';
import * as assert from 'assert';
import * as Bluebird from 'bluebird';
import * as rp from 'request-promise';

let data = '';
const cpSpawn = (command: string, args: string[]): Bluebird<cp.ChildProcess> => new Bluebird((resolve, reject) => {
  const child: cp.ChildProcess = cp.spawn(command, args);
  // assume, when stdout data is came, process is up
  let called = false;
  child.stdout.on('data', (d) => {
    data += d;
    called = called || resolve(child) || true
  });
  let wasError = false;
  child.on('error', (e) => wasError = wasError || reject(e) || true);
  // Debug
  // child.stdout.pipe(process.stdout);
  // child.stderr.pipe(process.stderr);
});


describe('test cluster mode', () => {
  let server: cp.ChildProcess;
  let isUp: boolean;
  let delay: (multiplier?: number) => Bluebird<void>;

  beforeEach(async function() {
    delay = (m = 1) => {
      return Bluebird.delay(m * this.timeout() / 10);
    };

    this.timeout(this.timeout() * 2);
    const binPath: string = path.resolve(__dirname, '..', 'example', 'cluster');
    server = await cpSpawn('node', [
      '--require', 'ts-node/register', // for dev mode
      binPath,
    ]);
    server.on('close', () => isUp = false);
    isUp = true;
  });

  afterEach(() => {
    isUp && server.kill('SIGKILL');
  });

  it('should exit when idle', async () => {
    server.kill('SIGTERM');
    await delay();
    assert.equal(isUp, false);
  });

  it('should exit when idle after few requests', async () => {
    await rp('http://localhost:8080/quick');
    await rp('http://localhost:8080/quick');
    assert.equal(isUp, true);
    server.kill('SIGTERM');
    await delay();
    assert.equal(isUp, false);
  });

  it('should not exit while request', async () => {
    // ignore connection reset
    rp('http://localhost:8080/slow').catch((): any => null);
    // wait request is accepted
    await rp('http://localhost:8080/quick');
    assert.equal(isUp, true, 'server must be up and serve request');
    server.kill('SIGTERM');
    await delay();
    assert.equal(isUp, true, 'request is slow, server still must serve one');
  });

  it('should exit after long request', async () => {
    const slow = rp('http://localhost:8080/slow');
    // wait request is accepted
    await rp('http://localhost:8080/quick');
    assert.equal(isUp, true);
    server.kill('SIGTERM');
    const slowResponse = await slow;
    assert.equal(!!slowResponse.match(/slow/), true, 'response should contain "slow" word');
    await delay();
    assert.equal(isUp, false, 'server should exit');
  });
});
