'use strict';
/// <reference path="_extra.d.ts" />

import * as path from 'path';
import * as cp from 'child_process';
import * as assert from 'assert';
import * as Bluebird from 'bluebird';
import * as rp from 'request-promise';

const cpSpawn = (command: string, args: string[]): Bluebird<cp.ChildProcess> => new Bluebird((resolve, reject) => {
  const child: cp.ChildProcess = cp.spawn(command, args);
  // assume, when response is gotten server is up
  let maxTimes = 20;
  async function loop() {
    await Bluebird.delay(100);
    try {
      await rp('http://localhost:8080/quick');
      resolve(child);
    } catch (e) {
      maxTimes-- && await loop();
    }
  }
  loop();
  let wasError = false;
  child.on('error', (e) => wasError = wasError || reject(e) || true);
  // Debug
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
});


describe('test cluster mode', function() {
  let server: cp.ChildProcess;
  let isUp: boolean;
  let waitDown: Bluebird<boolean>;
  let delay: (multiplier?: number) => Bluebird<void>;
  let maxTime: number;

  beforeEach(async function() {
    maxTime = this.timeout();
    delay = (m = 1) => {
      return Bluebird.delay(m * maxTime / 10);
    };

    this.timeout(maxTime * 2);
    const binPath: string = path.resolve(__dirname, '..', 'example', 'cluster-mode');
    server = await cpSpawn('node', [
      '--require', 'ts-node/register', // for dev mode
      binPath,
    ]);
    waitDown = new Bluebird<boolean>(resolve =>
      server.on('close', () => resolve(isUp = false)))
      .timeout(maxTime / 2);

    isUp = true;
  });

  afterEach(() => {
    isUp && server.kill('SIGKILL');
  });

  it('should exit when idle', async () => {
    server.kill('SIGTERM');
    await waitDown;
    assert.equal(isUp, false);
  });

  it('should exit when idle after few requests', async () => {
    await rp('http://localhost:8080/quick');
    await rp('http://localhost:8080/quick');
    assert.equal(isUp, true);
    server.kill('SIGTERM');
    await waitDown;
    assert.equal(isUp, false);
  });

  it('should not exit while request', async () => {
    // ignore connection reset
    rp(`http://localhost:8080/slow?time=${maxTime}`).catch((): any => null);
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
    await waitDown;
    assert.equal(isUp, false, 'server should exit');
  });

  it('should not accept new connections after termination start', async () => {
    rp(`http://localhost:8080/slow?time=${maxTime / 1.5}`).catch((): any => null);
    // wait request is accepted
    await rp('http://localhost:8080/quick');
    assert.equal(isUp, true);
    server.kill('SIGTERM');
    // there is no ability to wait SIGTERM signal delivery, so just wait some time
    await rp('http://localhost:8080/quick', {timeout: maxTime / 5}).catch(() => null);
    await rp('http://localhost:8080/quick')
      .then(
        () => assert.fail(`request accepted, but it shouldn't`),
        (e) => assert.equal(
          e && e.error && (e.error.code === 'ECONNRESET' || e.error.code === 'ECONNREFUSED'),
          true,
          e
        )
      );
  });
});
