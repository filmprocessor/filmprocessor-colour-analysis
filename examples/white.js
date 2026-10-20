import {measureFrame,DCP_XYZ} from '../src/index.js';
console.log(measureFrame(new Int32Array([3794,3960,3890]),1,1,3,12,{space:DCP_XYZ}).referenceWhite);
