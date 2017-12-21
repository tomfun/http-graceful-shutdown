'use strict';

import * as cluster from 'cluster';
import {cpus} from 'os';
import {GracefulShutdownManager} from './GracefulShutdownManager';
import * as http from "http";
import Signals = NodeJS.Signals;

/**
 * create_exactly - just create exactly clusterSize workers and don't do anymore
 * auto - as create_exactly, but create as much workers as processor support * clusterSizeMultiplier
 * recreate - like auto, but when worker exit a new worker will rise
 */
export type TClusterCreationMode = 'create_exactly' | 'auto' | 'recreate';

export interface IBaseClusterConstructStrictOptions {
  clusterCreationMode: TClusterCreationMode;
  onMasterSetup?: () => void;
  onMasterExit: () => void;
  onWorkerSetup: () => http.Server;
  onWorkerExit: () => void;
  gracefulShutdownSignals: Signals[];
}

export interface IBaseClusterConstructOptions {
  clusterCreationMode?: TClusterCreationMode;
  onMasterSetup?: () => void;
  onMasterExit?: () => void;
  onWorkerSetup: () => http.Server;
  onWorkerExit?: () => void;
  gracefulShutdownSignals?: Signals[];
}

export interface IFixedExactlyClusterConstructOptions extends IBaseClusterConstructOptions {
  clusterCreationMode: 'create_exactly'; // todo: implement & cover mode with tests
  clusterSize: number;
}

export interface IFixedRecreateClusterConstructOptions extends IBaseClusterConstructOptions {
  clusterCreationMode: 'recreate'; // todo: implement & cover mode with tests
  clusterSize: number;
}

export interface ICalculatedRecreateClusterConstructOptions extends IBaseClusterConstructOptions {
  clusterCreationMode: 'recreate'; // todo: implement & cover mode with tests
  clusterSizeMultiplier?: number;
}

export interface ICalculatedAutoClusterConstructOptions extends IBaseClusterConstructOptions {
  clusterCreationMode: 'auto';
  clusterSizeMultiplier?: number;
}

export type IConstructOptions =
  IFixedRecreateClusterConstructOptions
  | ICalculatedAutoClusterConstructOptions
  | IFixedExactlyClusterConstructOptions
  | ICalculatedRecreateClusterConstructOptions;

const defaultConstructOptions = {
  gracefulShutdownSignals: ['SIGINT', 'SIGTERM'] as Signals[],
  clusterCreationMode: 'auto' as 'auto',
  onMasterExit() {
    process.exit(0);
  },
  onWorkerExit() {
    process.exit(0);
  },
};

const clusterSizeMultiplier = 1.5;

export class Cluster {
  private options: IConstructOptions & IBaseClusterConstructStrictOptions;
  private server: http.Server;
  private shutdownManager?: GracefulShutdownManager;

  constructor(options: IConstructOptions) {
    this.options = {
      ...defaultConstructOptions,
      ...options,
    };

    this.up();
  }

  public get clusterSize(): number {
    return Object.keys(cluster.workers).length
  }

  public get clusterDesiredSize(): number {
    if ('clusterSize' in this.options) {
      return (<IFixedExactlyClusterConstructOptions>this.options).clusterSize;
    }
    const multiplier = (<ICalculatedAutoClusterConstructOptions>this.options).clusterSizeMultiplier || clusterSizeMultiplier;
    return multiplier * cpus().length;
  }

  private onMasterExit() {
    if (!this.clusterSize) {
      this.options.onMasterExit(); // this should really exit
    }
  }

  private onWorkerExit() {
    this.shutdownManager.terminate(this.options.onWorkerExit);
  }

  private up() {
    if (cluster.isMaster) {
      this.upMaster();
      this.setupMasterListeners();
      return;
    }
    this.upWorker();
  }
  private upMaster() {
    this.options.onMasterSetup();
    const size = this.clusterDesiredSize;
    for (let workerIndex = 0; workerIndex < size; workerIndex++) {
      cluster.fork();
    }
  }

  private setupMasterListeners() {
    cluster.on('exit', () => {
      // if all workers died, then cluster is exiting
      this.onMasterExit();
    });

    // there is OS/terminal specific: when you press ctr+c in the terminal it sends signal to all process
    // but in the production signals will not goes through all process subtree
    // we send they directly
    for (const signal of this.options.gracefulShutdownSignals) {
      process.on(signal, () =>
        Object
          .keys(cluster.workers)
          .map(k => cluster.workers[k])
          .forEach(worker => worker.process.kill(signal))
      );
    }
  }

  private upWorker() {
    this.server = this.options.onWorkerSetup();
    this.shutdownManager = new GracefulShutdownManager(this.server);

    this.options.gracefulShutdownSignals.forEach(signal =>
      process.on(signal, this.onWorkerExit.bind(this))
    );
  }
}
