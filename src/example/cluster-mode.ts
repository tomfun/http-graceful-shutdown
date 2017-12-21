'use strict';

import app from './express';
import {Cluster} from '../src';

const PORT_NUMBER = 8080;

const cluster = new Cluster({
  clusterCreationMode: "create_exactly",
  clusterSize: 2,
  onWorkerSetup() {
    return app.listen(PORT_NUMBER, (error: any) => {
      if (!error) {
        console.log('Started Express server on port: %d', PORT_NUMBER);
      }
    });
  },
  onMasterSetup() {
    // This is optional handler
    // Just show how to get size of workers
    // (they are created, but yet **could not be ready** to accept connection!)
    setTimeout(() => {
      console.log(
        'cluster size %d of %d',
        cluster.clusterSize,
        cluster.clusterDesiredSize,
      );
    }, 1000);
  }
});
