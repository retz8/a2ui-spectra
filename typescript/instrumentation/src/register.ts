/**
 * The launch-time switch: `node --import a2ui-spectra-instrumentation/register`
 * switches the wrapper on before the agent's own code runs.
 */

import {instrument} from './index.js';

instrument();
