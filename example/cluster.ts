import app from './express';
import * as cluster from 'cluster';
import {GracefulShutdownManager} from '../src/index';

const PORT_NUMBER = 8080;

if (cluster.isMaster) {
  let aliveForks = 2;
  cluster.fork();
  cluster.fork();
  cluster.on('exit', function (worker, exitCode) {
    console.log('Worker %d died :(, exitCode is %d', worker.id, exitCode);
    // if all workers died, then cluster is exiting
    if (!--aliveForks) {
      process.exit()
    }
  });
  // cluster should wait
  // there is OS/terminal specific: when you press ctr+c in the terminal it sends signal to all process
  // but in the production signals will not goes throug all subtree
  function onSignal(signal: string) {
    console.log(`master ignore ${signal}, proxy to the children`);
    Object
      .keys(cluster.workers)
      .map(k => cluster.workers[k])
      .forEach(worker => worker.kill(signal));
  }
  process.on('SIGTERM', onSignal.bind(this, 'SIGTERM'));
  process.on('SIGINT', onSignal.bind(this, 'SIGINT'));
} else {
  // Configure forks as usual, but exit on terminating
  const server = app.listen(PORT_NUMBER, (error: any) => {
    if (!error) {
      console.log('Started Express server on port: %d', PORT_NUMBER);
    }
  });

  const shutdownManager = new GracefulShutdownManager(server);

  process.on('SIGTERM', () => onProcessInterrupt('SIGTERM'));
  process.on('SIGINT', () => onProcessInterrupt('SIGINT'));


  function onProcessInterrupt (signal: string) {
    console.log('Termination signal is received from OS (' + signal + '), the application will terminate');
    //noinspection JSIgnoredPromiseFromCall
    shutdownManager.terminate(() => {
      console.log('Server is terminated');
      // This is close the fork
      process.exit(0)
    });
  }
}
