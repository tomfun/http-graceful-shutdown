'use strict';

import * as path from 'path';
import * as cp from 'child_process';
import * as assert from 'assert';
import * as Bluebird from 'bluebird';
import * as rp from 'request-promise';

const cpSpawn = (command: string, args: string[]): Bluebird<cp.ChildProcess> => new Bluebird((resolve, reject) => {
  const child: cp.ChildProcess = cp.spawn(command, args);
  // assume, when stdout data is came, process is up
  let called = false;
  child.stdout.on('data', () => called = called || resolve(child) || true);
  child.on('error', reject);
});


describe('test cluster mode', () => {
  let cluster: cp.ChildProcess;
  let isUp: boolean;
  beforeEach(async function() {
    this.timeout(this.timeout() * 4);
    cluster = await cpSpawn('node', [path.resolve(__dirname, '..', 'example', 'cluster')]);
    cluster.on('close', () => isUp = false);
    isUp = true;
  });

  afterEach(() => {
    isUp && cluster.kill('SIGKILL');
  });

  it('should exit when idle', async () => {
    cluster.kill('SIGTERM');
    await Bluebird.delay(100);
    assert.equal(isUp, false);
  });

  it('should exit when idle after few requests', async () => {
    await rp('http://localhost:8080/quick');
    await rp('http://localhost:8080/quick');
    assert.equal(isUp, true);
    cluster.kill('SIGTERM');
    await Bluebird.delay(100);
    assert.equal(isUp, false);
  });

  it('should not exit while request', async () => {
    await rp('http://localhost:8080/quick');
    // ignore connection reset
    rp('http://localhost:8080/slow').catch((): any => null);
    assert.equal(isUp, true);
    cluster.kill('SIGTERM');
    await Bluebird.delay(200);
    assert.equal(isUp, true);
  });

  it('should exit after long request', async () => {
    await rp('http://localhost:8080/quick');
    const slow = rp('http://localhost:8080/slow');
    await Bluebird.delay(400);
    assert.equal(isUp, true);
    cluster.kill('SIGTERM');
    const slowResponse = await slow;
    assert.equal(!!slowResponse.metch(/slow/), true);
    assert.equal(isUp, false);
  });
});
